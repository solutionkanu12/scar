"""Authenticated Scar sidecar backed by the official Sibyl Memory SDK."""

from __future__ import annotations

import hmac
import json
import os
import re
import signal
import sys
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from pathlib import Path
from typing import Any

from sibyl_memory_client import MemoryClient
from sibyl_memory_client.exceptions import NotFoundError


MAX_REQUEST_BYTES = 1_048_576
MAX_RECORDS = 1_000
INCIDENT_CATEGORY = "scar.incident"
ENTITY_CATEGORY = "scar.entity"
SAFEGUARD_CATEGORY = "scar.safeguard"
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, message: str) -> None:
        super().__init__(message)
        self.status = status


class ScarSibylStore:
    def __init__(self, db_path: Path, tenant_id: str) -> None:
        self.memory = MemoryClient.local(db_path, tenant_id=tenant_id)

    def persist_bundle(self, raw: Any) -> dict[str, str]:
        bundle = validate_bundle(raw)
        entity = bundle["entity"]
        incident = bundle["incident"]
        safeguard = bundle["safeguard"]
        audit_event = bundle["auditEvent"]

        self._assert_immutable(INCIDENT_CATEGORY, incident["id"], incident)
        self._assert_immutable(SAFEGUARD_CATEGORY, safeguard["id"], safeguard)

        entity_row = self.memory.set_entity(
            ENTITY_CATEGORY, entity["id"], entity, status="active"
        )
        safeguard_row = self.memory.set_entity(
            SAFEGUARD_CATEGORY, safeguard["id"], safeguard, status="active"
        )
        incident_row = self.memory.set_entity(
            INCIDENT_CATEGORY, incident["id"], incident, status="active"
        )

        existing_event = self._find_audit_event(audit_event["id"])
        if existing_event:
            if existing_event["event"] != audit_event:
                raise RequestError(
                    HTTPStatus.CONFLICT,
                    f"audit event {audit_event['id']} already exists",
                )
            audit_memory_id = existing_event["memoryId"]
        else:
            audit_memory_id = self.memory.write_event(
                acted=["scar incident persisted"],
                extra={"scarAuditEvent": audit_event},
                ts=audit_event["occurredAt"],
            )

        return {
            "entityMemoryId": entity_row["id"],
            "incidentMemoryId": incident_row["id"],
            "safeguardMemoryId": safeguard_row["id"],
            "auditMemoryId": audit_memory_id,
        }

    def relevant_evidence(self, raw: Any) -> dict[str, Any]:
        request = validate_relevant_request(raw)
        entity = self._get_body(ENTITY_CATEGORY, request["entityId"])
        incidents = [
            row["body"]
            for row in self.memory.list_entities(
                INCIDENT_CATEGORY, status="active", limit=MAX_RECORDS
            )
            if row["body"].get("entityId") == request["entityId"]
            and row["body"].get("actionType") == request["actionType"]
        ]
        safeguards = [
            row["body"]
            for row in self.memory.list_entities(
                SAFEGUARD_CATEGORY, status="active", limit=MAX_RECORDS
            )
            if row["body"].get("trigger", {}).get("entityId")
            == request["entityId"]
            and row["body"].get("trigger", {}).get("actionType")
            == request["actionType"]
            and request["agentId"]
            in row["body"].get("scope", {}).get("agentIds", [])
        ]
        lookup_event = {
            "id": str(uuid.uuid4()),
            "eventType": "MEMORY_LOOKUP",
            "agentId": request["agentId"],
            "actionId": request["actionId"],
            "entityId": request["entityId"],
            "actionType": request["actionType"],
            "resultIncidentIds": [item["id"] for item in incidents],
            "resultSafeguardIds": [item["id"] for item in safeguards],
            "occurredAt": utc_now(),
        }
        lookup_id = self.memory.write_event(
            evaluated=["scar memory evidence lookup"],
            extra={"scarAuditEvent": lookup_event},
            ts=lookup_event["occurredAt"],
        )
        return {
            "status": "AVAILABLE",
            "lookupId": lookup_id,
            "entity": entity,
            "incidents": incidents,
            "safeguards": safeguards,
        }

    def audit_history(self, raw: Any) -> dict[str, Any]:
        request = require_exact_object(raw, {"limit"}, "audit history request")
        limit = request["limit"]
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RECORDS:
            raise RequestError(HTTPStatus.BAD_REQUEST, "limit must be from 1 to 1000")
        events = []
        for row in self.memory.read_events(limit=limit):
            extra = row.get("extra")
            event = extra.get("scarAuditEvent") if isinstance(extra, dict) else None
            if isinstance(event, dict):
                events.append({"memoryId": row["id"], "event": event})
        return {"events": events}

    def _assert_immutable(self, category: str, name: str, body: dict[str, Any]) -> None:
        existing = self._get_body(category, name)
        if existing is not None and existing != body:
            raise RequestError(
                HTTPStatus.CONFLICT, f"{category} {name} already exists"
            )

    def _get_body(self, category: str, name: str) -> dict[str, Any] | None:
        try:
            return self.memory.get_entity(category, name)["body"]
        except NotFoundError:
            return None

    def _find_audit_event(self, event_id: str) -> dict[str, Any] | None:
        for row in self.memory.read_events(limit=10_000):
            extra = row.get("extra")
            event = extra.get("scarAuditEvent") if isinstance(extra, dict) else None
            if isinstance(event, dict) and event.get("id") == event_id:
                return {"memoryId": row["id"], "event": event}
        return None


class ScarSibylHandler(BaseHTTPRequestHandler):
    server: "ScarSibylServer"

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "implementation": "sibyl-memory-client",
                    "version": version("sibyl-memory-client"),
                },
            )
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        try:
            self.require_authorization()
            body = self.read_json()
            if self.path == "/v1/scar-memory":
                result = self.server.store.persist_bundle(body)
            elif self.path == "/v1/relevant-evidence":
                result = self.server.store.relevant_evidence(body)
            elif self.path == "/v1/audit-history":
                result = self.server.store.audit_history(body)
            else:
                raise RequestError(HTTPStatus.NOT_FOUND, "not found")
            self.send_json(HTTPStatus.OK, result)
        except RequestError as error:
            self.send_json(error.status, {"error": str(error)})
        except Exception:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "sibyl unavailable"})

    def require_authorization(self) -> None:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.token}"
        if not hmac.compare_digest(supplied, expected):
            raise RequestError(HTTPStatus.UNAUTHORIZED, "unauthorized")

    def read_json(self) -> Any:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid content length") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "invalid request size")
        try:
            return json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid JSON") from error

    def send_json(self, status: HTTPStatus, body: Any) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class ScarSibylServer(ThreadingHTTPServer):
    daemon_threads = False

    def __init__(
        self,
        address: tuple[str, int],
        store: ScarSibylStore,
        token: str,
    ) -> None:
        super().__init__(address, ScarSibylHandler)
        self.store = store
        self.token = token


def validate_bundle(raw: Any) -> dict[str, Any]:
    bundle = require_exact_object(
        raw, {"entity", "incident", "safeguard", "auditEvent"}, "Scar bundle"
    )
    entity = validate_entity(bundle["entity"])
    incident = validate_incident(bundle["incident"])
    safeguard = validate_safeguard(bundle["safeguard"])
    audit = validate_scar_recorded_event(bundle["auditEvent"])
    trigger = safeguard["trigger"]

    if incident["entityId"] != entity["id"]:
        raise RequestError(HTTPStatus.BAD_REQUEST, "incident entity mismatch")
    if safeguard["sourceIncidentId"] != incident["id"]:
        raise RequestError(HTTPStatus.BAD_REQUEST, "safeguard incident mismatch")
    if trigger.get("entityId") != entity["id"]:
        raise RequestError(HTTPStatus.BAD_REQUEST, "safeguard entity mismatch")
    if trigger.get("actionType") != incident.get("actionType"):
        raise RequestError(HTTPStatus.BAD_REQUEST, "safeguard action mismatch")
    if (
        audit.get("incidentId") != incident["id"]
        or audit.get("entityId") != entity["id"]
        or audit.get("safeguardId") != safeguard["id"]
    ):
        raise RequestError(HTTPStatus.BAD_REQUEST, "audit reference mismatch")
    return bundle


def validate_entity(raw: Any) -> dict[str, Any]:
    entity = require_exact_object(
        raw,
        {"id", "name", "externalIdentifier", "type", "createdAt"},
        "entity",
    )
    require_identifier(entity["id"], "entity.id")
    require_text(entity["name"], "entity.name", 240)
    require_text(entity["externalIdentifier"], "entity.externalIdentifier", 512)
    require_enum(
        entity["type"],
        "entity.type",
        {"COUNTERPARTY", "SERVICE", "TOOL"},
    )
    require_timestamp(entity["createdAt"], "entity.createdAt")
    return entity


def validate_incident(raw: Any) -> dict[str, Any]:
    incident = require_exact_object(
        raw,
        {
            "id",
            "sourceAgentId",
            "relatedActionId",
            "entityId",
            "actionType",
            "context",
            "outcome",
            "severity",
            "reason",
            "mitigation",
            "evidence",
            "provenance",
            "createdAt",
        },
        "incident",
    )
    for field in ("id", "sourceAgentId", "relatedActionId", "entityId"):
        require_identifier(incident[field], f"incident.{field}")
    require_enum(incident["actionType"], "incident.actionType", {"USDC_TRANSFER"})
    require_text(incident["context"], "incident.context", 4_000)
    require_text(incident["outcome"], "incident.outcome", 4_000)
    require_enum(
        incident["severity"],
        "incident.severity",
        {"LOW", "MEDIUM", "HIGH", "CRITICAL"},
    )
    require_text(incident["reason"], "incident.reason", 2_000)
    require_text(incident["mitigation"], "incident.mitigation", 2_000)
    evidence = require_list(incident["evidence"], "incident.evidence", 1, 64)
    for index, raw_reference in enumerate(evidence):
        reference = require_exact_object(
            raw_reference,
            {"kind", "reference", "observedAt"},
            f"incident.evidence[{index}]",
        )
        require_enum(
            reference["kind"],
            f"incident.evidence[{index}].kind",
            {"TRANSACTION", "OPERATOR_NOTE", "SYSTEM_EVENT"},
        )
        require_text(
            reference["reference"],
            f"incident.evidence[{index}].reference",
            512,
        )
        require_timestamp(
            reference["observedAt"],
            f"incident.evidence[{index}].observedAt",
        )
    provenance = require_exact_object(
        incident["provenance"],
        {"source", "recordedBy", "observedAt"},
        "incident.provenance",
    )
    require_enum(
        provenance["source"],
        "incident.provenance.source",
        {"OPERATOR_REPORT", "EXECUTION_OUTCOME"},
    )
    require_identifier(provenance["recordedBy"], "incident.provenance.recordedBy")
    require_timestamp(provenance["observedAt"], "incident.provenance.observedAt")
    require_timestamp(incident["createdAt"], "incident.createdAt")
    return incident


def validate_safeguard(raw: Any) -> dict[str, Any]:
    safeguard = require_exact_object(
        raw,
        {
            "id",
            "sourceIncidentId",
            "trigger",
            "scope",
            "requiredResponse",
            "reason",
            "createdAt",
        },
        "safeguard",
    )
    require_identifier(safeguard["id"], "safeguard.id")
    require_identifier(
        safeguard["sourceIncidentId"], "safeguard.sourceIncidentId"
    )
    trigger = require_exact_object(
        safeguard["trigger"],
        {"entityId", "actionType"},
        "safeguard.trigger",
    )
    require_identifier(trigger["entityId"], "safeguard.trigger.entityId")
    require_enum(
        trigger["actionType"],
        "safeguard.trigger.actionType",
        {"USDC_TRANSFER"},
    )
    scope = require_exact_object(
        safeguard["scope"], {"agentIds"}, "safeguard.scope"
    )
    agent_ids = require_list(
        scope["agentIds"], "safeguard.scope.agentIds", 1, 128
    )
    for index, agent_id in enumerate(agent_ids):
        require_identifier(agent_id, f"safeguard.scope.agentIds[{index}]")
    require_enum(
        safeguard["requiredResponse"],
        "safeguard.requiredResponse",
        {"REVIEW", "BLOCK"},
    )
    require_text(safeguard["reason"], "safeguard.reason", 2_000)
    require_timestamp(safeguard["createdAt"], "safeguard.createdAt")
    return safeguard


def validate_scar_recorded_event(raw: Any) -> dict[str, Any]:
    event = require_exact_object(
        raw,
        {
            "id",
            "eventType",
            "actorId",
            "incidentId",
            "entityId",
            "safeguardId",
            "occurredAt",
        },
        "auditEvent",
    )
    for field in ("id", "actorId", "incidentId", "entityId", "safeguardId"):
        require_identifier(event[field], f"auditEvent.{field}")
    require_enum(event["eventType"], "auditEvent.eventType", {"SCAR_RECORDED"})
    require_timestamp(event["occurredAt"], "auditEvent.occurredAt")
    return event


def validate_relevant_request(raw: Any) -> dict[str, Any]:
    request = require_exact_object(
        raw, {"actionId", "agentId", "entityId", "actionType"}, "evidence request"
    )
    for field in ("actionId", "agentId", "entityId"):
        require_identifier(request[field], field)
    if request["actionType"] != "USDC_TRANSFER":
        raise RequestError(HTTPStatus.BAD_REQUEST, "unsupported action type")
    return request


def require_exact_object(raw: Any, keys: set[str], name: str) -> dict[str, Any]:
    value = require_object(raw, name)
    if set(value) != keys:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name} fields")
    return value


def require_object(raw: Any, name: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RequestError(HTTPStatus.BAD_REQUEST, f"{name} must be an object")
    return raw


def require_identifier(raw: Any, name: str) -> str:
    if not isinstance(raw, str) or not IDENTIFIER.fullmatch(raw):
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    return raw


def require_text(raw: Any, name: str, maximum: int) -> str:
    if (
        not isinstance(raw, str)
        or raw != raw.strip()
        or not 1 <= len(raw) <= maximum
    ):
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    return raw


def require_enum(raw: Any, name: str, values: set[str]) -> str:
    if not isinstance(raw, str) or raw not in values:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    return raw


def require_list(
    raw: Any, name: str, minimum: int, maximum: int
) -> list[Any]:
    if not isinstance(raw, list) or not minimum <= len(raw) <= maximum:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    return raw


def require_timestamp(raw: Any, name: str) -> str:
    if not isinstance(raw, str):
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}") from error
    if parsed.tzinfo is None:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"invalid {name}")
    return raw


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def required_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> None:
    db_path = Path(required_environment("SIBYL_DB_PATH")).expanduser().resolve()
    tenant_id = require_identifier(required_environment("SIBYL_TENANT_ID"), "tenant")
    token = required_environment("SIBYL_SIDECAR_TOKEN")
    if len(token) < 16:
        raise RuntimeError("SIBYL_SIDECAR_TOKEN must contain at least 16 characters")
    host = os.environ.get("SIBYL_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("SIBYL_SIDECAR_PORT", "7331"))
    store = ScarSibylStore(db_path, tenant_id)
    server = ScarSibylServer((host, port), store, token)
    signal.signal(
        signal.SIGTERM,
        lambda *_args: threading.Thread(
            target=server.shutdown,
            daemon=True,
        ).start(),
    )
    print(
        json.dumps(
            {
                "status": "ready",
                "port": server.server_address[1],
                "implementation": "sibyl-memory-client",
                "version": version("sibyl-memory-client"),
            }
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Sibyl sidecar failed to start: {error}", file=sys.stderr)
        raise
