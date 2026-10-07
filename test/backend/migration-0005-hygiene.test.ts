import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "drizzle");
const preflightPath = resolve(
  migrationsDirectory,
  "0005_workspace_scope.preflight.sql",
);

function applyMigration(sqlite: DatabaseSync, file: string) {
  const statements = readFileSync(resolve(migrationsDirectory, file), "utf-8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) sqlite.exec(statement);
}

function legacyDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of [
    "0000_sturdy_sunspot.sql",
    "0001_furry_magma.sql",
    "0002_salty_aqueduct.sql",
    "0003_cultured_lady_ursula.sql",
    "0004_flimsy_supernaut.sql",
  ]) {
    applyMigration(sqlite, file);
  }
  return sqlite;
}

function runPreflight(sqlite: DatabaseSync) {
  return sqlite.prepare(readFileSync(preflightPath, "utf-8")).all() as Array<{
    result: "PASS" | "FAIL";
    check_name: string;
    detail: string;
    affected_rows: number;
  }>;
}

function preflightSql() {
  return readFileSync(preflightPath, "utf-8");
}

describe("0005 workspace migration hygiene", () => {
  it("records the workspace-scoped final schema in the 0005 snapshot", () => {
    const snapshot = JSON.parse(
      readFileSync(
        resolve(migrationsDirectory, "meta", "0005_snapshot.json"),
        "utf-8",
      ),
    ) as {
      tables: Record<
        string,
        {
          columns: Record<string, { notNull: boolean; primaryKey: boolean }>;
          compositePrimaryKeys: Record<string, { columns: string[] }>;
          indexes: Record<string, { columns: string[]; isUnique: boolean }>;
        }
      >;
    };

    expect(snapshot.tables.agents.columns.workspace_id).toMatchObject({
      notNull: true,
      primaryKey: false,
    });
    expect(
      Object.values(snapshot.tables.agents.compositePrimaryKeys),
    ).toContainEqual(
      expect.objectContaining({ columns: ["workspace_id", "id"] }),
    );
    expect(
      Object.values(snapshot.tables.approvals.indexes),
    ).toContainEqual(
      expect.objectContaining({
        columns: ["workspace_id", "action_id", "authorization_id"],
        isUnique: true,
      }),
    );
    expect(
      Object.values(snapshot.tables.executions.compositePrimaryKeys),
    ).toContainEqual(
      expect.objectContaining({ columns: ["workspace_id", "action_id"] }),
    );
  });

  it("reports PASS for a valid pre-0005 legacy database", () => {
    const rows = runPreflight(legacyDatabase());
    expect(rows).toEqual([
      {
        result: "PASS",
        check_name: "0005_workspace_scope_preflight",
        detail: "all checks passed",
        affected_rows: 0,
      },
    ]);
  });

  it("reports the exact rate-limit collision created by legacy workspace assignment", () => {
    const sqlite = legacyDatabase();
    const insert = sqlite.prepare(
      "INSERT INTO scar_http_rate_limit_buckets (organization_id, principal_id, operation, window_started_at, count) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("organization:one", "user:one", "ACTION_READ", "2026-10-03T13:00:00.000Z", 1);
    insert.run("organization:two", "user:one", "ACTION_READ", "2026-10-03T13:00:00.000Z", 1);

    expect(runPreflight(sqlite)).toEqual([
      {
        result: "FAIL",
        check_name: "0005_workspace_scope_preflight",
        detail: "one or more checks failed",
        affected_rows: 1,
      },
      {
        result: "FAIL",
        check_name: "rate_limit_workspace_legacy_collision",
        detail:
          "principal_id=user:one; operation=ACTION_READ; window_started_at=2026-10-03T13:00:00.000Z",
        affected_rows: 1,
      },
    ]);
  });

  it("fails closed for a pre-existing legacy workspace namespace", () => {
    const sqlite = legacyDatabase();
    sqlite
      .prepare(
        "INSERT INTO scar_workspaces (id, name, kind, status, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "workspace:legacy",
        "Unexpected legacy namespace",
        "ORGANIZATION",
        "ACTIVE",
        "2026-10-03T13:00:00.000Z",
      );

    expect(runPreflight(sqlite)).toEqual([
      {
        result: "FAIL",
        check_name: "0005_workspace_scope_preflight",
        detail: "one or more checks failed",
        affected_rows: 1,
      },
      {
        result: "FAIL",
        check_name: "legacy_workspace_namespace_already_present",
        detail: "workspace:legacy exists in scar_workspaces",
        affected_rows: 1,
      },
    ]);
  });

  it("fails closed for legacy values that cannot satisfy the final required fields", () => {
    const sqlite = legacyDatabase();
    sqlite
      .prepare(
        "INSERT INTO agents (id, name, role, status, permissions) VALUES (?, ?, ?, ?, ?)",
      )
      .run("", "Malformed agent", "OPERATOR", "ACTIVE", "[]");

    expect(runPreflight(sqlite)).toEqual([
      {
        result: "FAIL",
        check_name: "0005_workspace_scope_preflight",
        detail: "one or more checks failed",
        affected_rows: 1,
      },
      {
        result: "FAIL",
        check_name: "agents_required_value_invalid",
        detail: "one or more required values are NULL or empty",
        affected_rows: 1,
      },
    ]);
  });

  it("documents every duplicate logical record check required by the final workspace keys", () => {
    const sql = preflightSql();
    for (const check of [
      "rate_limit_workspace_legacy_collision",
      "agent_credentials_workspace_legacy_id_collision",
      "agent_credentials_workspace_legacy_secret_hash_collision",
      "approvals_workspace_legacy_id_collision",
      "approvals_workspace_legacy_logical_collision",
      "executions_workspace_legacy_action_collision",
    ]) {
      expect(sql).toContain(check);
    }
  });
});
