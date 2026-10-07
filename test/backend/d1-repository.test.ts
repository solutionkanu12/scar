import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { D1ScarRepository } from "@/server/scar/d1-repository";
import { D1ScarSecurityRepository } from "@/server/scar/http/security-repository";

const timestamp = "2026-09-10T12:00:00.000Z";
const workspaceId = "workspace-alpha";
const ownerUserId = "123e4567-e89b-12d3-a456-426614174000";

interface D1MockPreparedStatement {
  bind(...values: unknown[]): D1MockPreparedStatement;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }>;
  run<T = unknown>(): Promise<{ success: boolean; meta: Record<string, unknown> }>;
  raw<T = unknown>(): Promise<T[]>;
  first<T = unknown>(colName?: string): Promise<T | null>;
}

function createD1Mock(sqliteDb?: DatabaseSync): D1Database {
  const db = sqliteDb ?? new DatabaseSync(":memory:");

  return {
    prepare(query: string): D1MockPreparedStatement {
      let boundValues: unknown[] = [];
      const stmtObj: D1MockPreparedStatement = {
        bind(...values: unknown[]) {
          boundValues = values.map((v) => (v === undefined ? null : v));
          return stmtObj;
        },
        async all<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...(boundValues as never[])) as T[];
          return {
            results,
            success: true,
            meta: {},
          };
        },
        async run<T = unknown>() {
          const stmt = db.prepare(query);
          stmt.run(...(boundValues as never[]));
          return {
            success: true,
            meta: {},
          };
        },
        async raw<T = unknown>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...(boundValues as never[])) as Record<string, unknown>[];
          return results.map((row) => Object.values(row)) as T[];
        },
        async first<T = unknown>(colName?: string) {
          const stmt = db.prepare(query);
          const row = stmt.get(...(boundValues as never[])) as Record<string, unknown> | undefined;
          if (!row) return null;
          if (colName) return (row[colName] as T) ?? null;
          return row as T;
        },
      };
      return stmtObj;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    async batch<T = unknown>(statements: D1MockPreparedStatement[]) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.all<T>());
      }
      return results;
    },
    async exec(query: string) {
      db.exec(query);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}

function initDatabase(sqliteDb?: DatabaseSync) {
  const sqlite = sqliteDb ?? new DatabaseSync(":memory:");
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  for (const file of readdirSync(migrationDirectory)
    .filter((entry) => /^\d{4}_.+\.sql$/.test(entry))
    .sort()) {
    applyMigration(sqlite, file);
  }

  const d1 = createD1Mock(sqlite);
  return { sqlite, d1, repository: new D1ScarRepository(d1, workspaceId) };
}

function applyMigration(sqlite: DatabaseSync, file: string) {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const statements = readFileSync(resolve(migrationDirectory, file), "utf-8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) sqlite.exec(statement);
}

describe("D1ScarRepository", () => {
  it("migrates valid legacy executions that share an execution ID", () => {
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
    const insert = sqlite.prepare(
      "INSERT INTO executions (action_id, id, authorization_id, status, started_at) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run(
      "action-legacy-one",
      "execution-legacy-duplicate",
      "authorization-legacy-one",
      "PENDING",
      timestamp,
    );
    insert.run(
      "action-legacy-two",
      "execution-legacy-duplicate",
      "authorization-legacy-two",
      "PENDING",
      timestamp,
    );

    applyMigration(sqlite, "0005_workspace_scope.sql");

    const executions = sqlite
      .prepare(
        "SELECT workspace_id, action_id, id FROM executions ORDER BY action_id",
      )
      .all();
    expect(executions).toEqual([
      {
        workspace_id: "workspace:legacy",
        action_id: "action-legacy-one",
        id: "execution-legacy-duplicate",
      },
      {
        workspace_id: "workspace:legacy",
        action_id: "action-legacy-two",
        id: "execution-legacy-duplicate",
      },
    ]);
  });

  it("atomically creates a workspace, its OWNER membership, and disabled execution configuration", async () => {
    const { d1 } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);

    const created = await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId,
      createdAt: timestamp,
    });

    expect(created.workspace).toEqual({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      status: "ACTIVE",
      createdAt: timestamp,
    });
    await expect(
      security.findActiveWorkspaceMembership(workspaceId, ownerUserId),
    ).resolves.toMatchObject({ membership: "OWNER", status: "ACTIVE" });
    await expect(
      security.findWorkspaceExecutionConfiguration(workspaceId),
    ).resolves.toMatchObject({ status: "DISABLED" });
    await expect(
      security.findActiveHumanRoles(workspaceId, ownerUserId),
    ).resolves.toEqual([]);

    await expect(
      security.createWorkspaceForOwner({
        id: workspaceId,
        name: "Another name",
        kind: "PERSONAL",
        ownerUserId,
        createdAt: timestamp,
      }),
    ).rejects.toThrow("Workspace workspace-alpha already exists");
  });

  it("fails closed for members when their workspace is suspended", async () => {
    const { d1, sqlite } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);
    await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId,
      createdAt: timestamp,
    });
    sqlite
      .prepare("UPDATE scar_workspaces SET status = 'SUSPENDED' WHERE id = ?")
      .run(workspaceId);

    await expect(
      security.findActiveWorkspaceMembership(workspaceId, ownerUserId),
    ).resolves.toBeNull();
  });

  it("fails closed for an active agent credential when its workspace is suspended", async () => {
    const { d1, sqlite } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);
    await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId,
      createdAt: timestamp,
    });
    await security.saveAgentCredential({
      workspaceId,
      id: "credential-suspended-workspace",
      agentId: "agent-treasury",
      secretHash: "a".repeat(64),
      allowedOperations: ["READ_ACTION"],
      status: "ACTIVE",
      createdAt: timestamp,
      expiresAt: "2026-12-10T12:00:00.000Z",
    });
    sqlite
      .prepare("UPDATE scar_workspaces SET status = 'SUSPENDED' WHERE id = ?")
      .run(workspaceId);

    await expect(
      security.findWorkspaceAgentCredential(
        workspaceId,
        "credential-suspended-workspace",
      ),
    ).resolves.toBeNull();
  });

  it("records each workspace role assignment and revocation in an append-only audit", async () => {
    const { d1 } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);
    const memberUserId = "123e4567-e89b-12d3-a456-426614174001";
    await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId,
      createdAt: timestamp,
    });
    await security.addWorkspaceMember({
      workspaceId,
      userId: memberUserId,
      membership: "MEMBER",
      addedBy: ownerUserId,
      createdAt: timestamp,
    });

    await security.assignWorkspaceRole({
      id: "role-audit-001",
      workspaceId,
      userId: memberUserId,
      role: "APPROVER",
      assignedBy: ownerUserId,
      occurredAt: timestamp,
    });
    await expect(
      security.findActiveHumanRoles(workspaceId, memberUserId),
    ).resolves.toEqual(["APPROVER"]);

    await security.revokeWorkspaceRole({
      id: "role-audit-002",
      workspaceId,
      userId: memberUserId,
      role: "APPROVER",
      revokedBy: ownerUserId,
      occurredAt: "2026-09-10T12:01:00.000Z",
    });
    await expect(
      security.findActiveHumanRoles(workspaceId, memberUserId),
    ).resolves.toEqual([]);
    await expect(security.listWorkspaceRoleAudit(workspaceId, memberUserId)).resolves.toEqual([
      expect.objectContaining({
        id: "role-audit-001",
        change: "ASSIGNED",
        actorUserId: ownerUserId,
      }),
      expect.objectContaining({
        id: "role-audit-002",
        change: "REVOKED",
        actorUserId: ownerUserId,
      }),
    ]);
  });

  it("revokes a MEMBER atomically and removes every operational authorization path", async () => {
    const { d1 } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);
    const memberUserId = "123e4567-e89b-12d3-a456-426614174001";
    await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId,
      createdAt: timestamp,
    });
    await security.addWorkspaceMember({
      workspaceId,
      userId: memberUserId,
      membership: "MEMBER",
      addedBy: ownerUserId,
      createdAt: timestamp,
    });
    await security.assignWorkspaceRole({
      id: "role-audit-member-revoke-001",
      workspaceId,
      userId: memberUserId,
      role: "OPERATOR",
      assignedBy: ownerUserId,
      occurredAt: timestamp,
    });

    await expect(
      security.revokeWorkspaceMember({
        workspaceId,
        userId: memberUserId,
        revokedBy: ownerUserId,
        revokedAt: "2026-09-10T12:02:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "REVOKED" });
    await expect(
      security.findActiveWorkspaceMembership(workspaceId, memberUserId),
    ).resolves.toBeNull();
    await expect(
      security.findActiveHumanRoles(workspaceId, memberUserId),
    ).resolves.toEqual([]);
    await expect(
      security.revokeWorkspaceMember({
        workspaceId,
        userId: memberUserId,
        revokedBy: ownerUserId,
        revokedAt: "2026-09-10T12:03:00.000Z",
      }),
    ).rejects.toThrow("Active member");
  });

  it("isolates same operational identifiers across workspace-scoped repositories", async () => {
    const { d1 } = initDatabase();
    const alpha = new D1ScarRepository(d1, "workspace-alpha");
    const beta = new D1ScarRepository(d1, "workspace-beta");

    await alpha.saveAgent(validAgent());
    await beta.saveAgent(validAgent());
    await alpha.saveAction(validAction());
    await beta.saveAction(validAction());
    await alpha.appendIncident(validIncident());
    await beta.appendIncident(validIncident());
    await alpha.appendIncidentMemoryBundle(validMemoryBundle());
    await beta.appendIncidentMemoryBundle(validMemoryBundle());
    await alpha.saveAuthorization(validAuthorization());
    await beta.saveAuthorization(validAuthorization());
    await alpha.saveApproval(validApproval());
    await beta.saveApproval(validApproval());

    await expect(
      alpha.claimExecution({
        id: "execution-001",
        actionId: "action-001",
        authorizationId: "authorization-001",
        status: "PENDING",
        startedAt: timestamp,
      }),
    ).resolves.toMatchObject({ id: "execution-001" });
    await expect(
      beta.claimExecution({
        id: "execution-001",
        actionId: "action-001",
        authorizationId: "authorization-001",
        status: "PENDING",
        startedAt: timestamp,
      }),
    ).resolves.toMatchObject({ id: "execution-001" });

    await expect(alpha.findActionById("action-001")).resolves.toEqual(
      validAction(),
    );
    await expect(beta.findActionById("action-001")).resolves.toEqual(
      validAction(),
    );
    await expect(alpha.findIncidentsForAction("action-001")).resolves.toEqual([
      validIncident(),
    ]);
    await expect(beta.findIncidentsForAction("action-001")).resolves.toEqual([
      validIncident(),
    ]);
  });

  it("reports durability as DURABLE", () => {
    const { repository } = initDatabase();
    expect(repository.durability).toBe("DURABLE");
  });

  it("durably scopes roles, agent credentials, rate limits, and HTTP audits to a workspace", async () => {
    const { d1 } = initDatabase();
    const security = new D1ScarSecurityRepository(d1);
    const userId = "123e4567-e89b-12d3-a456-426614174000";

    await security.createWorkspaceForOwner({
      id: workspaceId,
      name: "Alpha Treasury",
      kind: "ORGANIZATION",
      ownerUserId: userId,
      createdAt: timestamp,
    });
    await security.assignWorkspaceRole({
      id: "role-audit-durable-001",
      workspaceId,
      userId,
      role: "APPROVER",
      assignedBy: userId,
      occurredAt: timestamp,
    });
    await expect(security.findActiveHumanRoles(workspaceId, userId)).resolves.toEqual([
      "APPROVER",
    ]);

    await security.saveAgentCredential({
      workspaceId,
      id: "credential-001",
      agentId: "agent-treasury",
      secretHash: "a".repeat(64),
      allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
      status: "ACTIVE",
      createdAt: timestamp,
      expiresAt: "2026-10-10T12:00:00.000Z",
    });
    await security.revokeWorkspaceAgentCredential(
      workspaceId,
      "credential-001",
      "2026-09-11T12:00:00.000Z",
    );
    await expect(
      security.findWorkspaceAgentCredential(workspaceId, "credential-001"),
    ).resolves.toMatchObject({ status: "REVOKED" });

    const rateInput = {
      workspaceId,
      principalId: userId,
      operation: "ACTION_PROPOSAL",
      windowStartedAt: timestamp,
      limit: 2,
    } as const;
    await expect(security.claimRateLimit(rateInput)).resolves.toBe(true);
    await expect(security.claimRateLimit(rateInput)).resolves.toBe(true);
    await expect(security.claimRateLimit(rateInput)).resolves.toBe(false);

    await expect(
      security.appendHttpAudit({
        id: "audit-http-001",
        workspaceId,
        requestId: "request-001",
        principalType: "HUMAN",
        principalId: userId,
        operation: "ACTION_APPROVAL",
        outcome: "ACCEPTED",
        statusCode: 201,
        occurredAt: timestamp,
      }),
    ).resolves.toMatchObject({ id: "audit-http-001", statusCode: 201 });
  });

  it("stores and retrieves validated agent and action records", async () => {
    const { repository } = initDatabase();

    const agent = await repository.saveAgent(validAgent());
    const action = await repository.saveAction(validAction());

    expect(agent).toEqual(validAgent());
    expect(action).toEqual(validAction());

    await expect(repository.findAgentById("agent-treasury")).resolves.toEqual(
      validAgent(),
    );
    await expect(repository.findActionById("action-001")).resolves.toEqual(
      validAction(),
    );
  });

  it("rejects invalid records at the boundary using domain schemas", async () => {
    const { repository } = initDatabase();

    await expect(
      repository.saveAction(validAction({ recipient: "not-an-address" })),
    ).rejects.toThrow();
    await expect(repository.findActionById("action-001")).resolves.toBeNull();

    await expect(
      repository.saveAgent(validAgent({ permissions: ["INVALID_ACTION_TYPE"] })),
    ).rejects.toThrow();
    await expect(repository.findAgentById("agent-treasury")).resolves.toBeNull();
  });

  it("enforces duplicate protection for agents, actions, and approvals", async () => {
    const { repository } = initDatabase();

    await repository.saveAgent(validAgent());
    await expect(repository.saveAgent(validAgent())).rejects.toThrow(
      "Agent agent-treasury already exists",
    );

    await repository.saveAction(validAction());
    await expect(repository.saveAction(validAction())).rejects.toThrow(
      "Action action-001 already exists",
    );

    await repository.saveApproval(validApproval());
    await expect(repository.saveApproval(validApproval())).rejects.toThrow(
      "Approval approval-001 already exists",
    );
  });

  it("rejects a second logical approval for the same action and authorization", async () => {
    const { repository } = initDatabase();
    await repository.saveApproval(validApproval());

    await expect(
      repository.saveApproval(
        validApproval({ id: "approval-002", approvedBy: "operator-002" }),
      ),
    ).rejects.toThrow("already exists");
  });

  it("enforces incident persistence, duplicate prevention, and scoped query", async () => {
    const { repository } = initDatabase();

    const incident = await repository.appendIncident(validIncident());
    expect(incident).toEqual(validIncident());

    await expect(repository.appendIncident(validIncident())).rejects.toThrow(
      "Incident scar-001 already exists",
    );

    await repository.appendIncident(
      validIncident({
        id: "scar-002",
        entityId: "supplier-beta",
        relatedActionId: "action-002",
      }),
    );

    const alphaIncidents = await repository.findIncidents({
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER",
    });
    expect(alphaIncidents.map((i) => i.id)).toEqual(["scar-001"]);

    const allIncidents = await repository.findIncidents({});
    expect(allIncidents.map((i) => i.id)).toEqual(["scar-001", "scar-002"]);
  });

  it("persists one immutable Sibyl delivery bundle per incident", async () => {
    const { repository } = initDatabase();
    const bundle = validMemoryBundle();

    await expect(repository.appendIncidentMemoryBundle(bundle)).resolves.toEqual(
      bundle,
    );
    await expect(
      repository.findIncidentMemoryBundle(bundle.incident.id),
    ).resolves.toEqual(bundle);

    await expect(repository.appendIncidentMemoryBundle(bundle)).rejects.toThrow(
      "already exists",
    );
  });

  it("enforces authorization uniqueness per action and authorization ID", async () => {
    const { repository } = initDatabase();

    const auth = await repository.saveAuthorization(validAuthorization());
    expect(auth).toEqual(validAuthorization());

    // Duplicate actionId
    await expect(
      repository.saveAuthorization(
        validAuthorization({ id: "authorization-002" }),
      ),
    ).rejects.toThrow(
      "Authorization for action action-001 already exists",
    );

    // Duplicate authorization id
    await expect(
      repository.saveAuthorization(
        validAuthorization({ actionId: "action-002" }),
      ),
    ).rejects.toThrow(
      "Authorization for action action-002 already exists",
    );

    await expect(
      repository.findAuthorizationForAction("action-001"),
    ).resolves.toEqual(validAuthorization());
  });

  it("atomically handles execution claims and rejects duplicate claims", async () => {
    const { repository } = initDatabase();

    const claim1 = await repository.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });
    expect(claim1).toEqual({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    // Second claim on same actionId must return null
    const claim2 = await repository.claimExecution({
      id: "execution-002",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });
    expect(claim2).toBeNull();
  });

  it("atomically resolves concurrent execution claims so exactly one succeeds", async () => {
    const sqlite = new DatabaseSync(":memory:");
    initDatabase(sqlite);

    const repo1 = new D1ScarRepository(createD1Mock(sqlite), workspaceId);
    const repo2 = new D1ScarRepository(createD1Mock(sqlite), workspaceId);

    const claim1Promise = repo1.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });
    const claim2Promise = repo2.claimExecution({
      id: "execution-002",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    const [res1, res2] = await Promise.all([claim1Promise, claim2Promise]);

    const successCount = [res1, res2].filter((r) => r !== null).length;
    const nullCount = [res1, res2].filter((r) => r === null).length;

    expect(successCount).toBe(1);
    expect(nullCount).toBe(1);

    const winner = res1 ?? res2;
    expect(winner?.status).toBe("PENDING");
    await expect(repo1.findExecutionForAction("action-001")).resolves.toEqual(winner);
  });

  it("atomically resolves concurrent completions so exactly one succeeds and the other rejects", async () => {
    const sqlite = new DatabaseSync(":memory:");
    initDatabase(sqlite);

    const repo1 = new D1ScarRepository(createD1Mock(sqlite), workspaceId);
    const repo2 = new D1ScarRepository(createD1Mock(sqlite), workspaceId);

    await repo1.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    const completion1Promise = repo1.completeExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });

    const completion2Promise = repo2.completeExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "FAILED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:02.000Z",
      errorCode: "REVERTED_ON_CHAIN",
    });

    const results = await Promise.allSettled([
      completion1Promise,
      completion2Promise,
    ]);

    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<unknown>[];
    const rejected = results.filter(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason.message).toContain(
      "Execution execution-001 is not the active pending execution",
    );

    const persisted = await repo1.findExecutionForAction("action-001");
    expect(persisted).toEqual(fulfilled[0].value);
  });

  it("throws on unexpected database errors rather than swallowing as duplicate", async () => {
    const brokenD1 = {
      prepare() {
        throw new Error("D1 connection failed");
      },
    } as unknown as D1Database;

    const brokenRepo = new D1ScarRepository(brokenD1, workspaceId);
    await expect(
      brokenRepo.claimExecution({
        id: "execution-001",
        actionId: "action-001",
        authorizationId: "authorization-001",
        status: "PENDING",
        startedAt: timestamp,
      }),
    ).rejects.toThrow("D1 connection failed");
  });

  it("rejects invalid execution completions", async () => {
    const { repository } = initDatabase();

    await repository.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    // Mismatched execution ID
    await expect(
      repository.completeExecution({
        id: "execution-wrong",
        actionId: "action-001",
        authorizationId: "authorization-001",
        status: "SUCCEEDED",
        startedAt: timestamp,
        completedAt: "2026-09-10T12:00:01.000Z",
        externalReference: "tx-reference-001",
      }),
    ).rejects.toThrow(
      "Execution execution-wrong is not the active pending execution",
    );

    // Mismatched authorization ID
    await expect(
      repository.completeExecution({
        id: "execution-001",
        actionId: "action-001",
        authorizationId: "authorization-wrong",
        status: "SUCCEEDED",
        startedAt: timestamp,
        completedAt: "2026-09-10T12:00:01.000Z",
        externalReference: "tx-reference-001",
      }),
    ).rejects.toThrow(
      "Execution execution-001 is not the active pending execution",
    );

    // Non-existent actionId
    await expect(
      repository.completeExecution({
        id: "execution-001",
        actionId: "action-unclaimed",
        authorizationId: "authorization-001",
        status: "SUCCEEDED",
        startedAt: timestamp,
        completedAt: "2026-09-10T12:00:01.000Z",
        externalReference: "tx-reference-001",
      }),
    ).rejects.toThrow(
      "Execution execution-001 is not the active pending execution",
    );
  });

  it("successfully transitions PENDING -> SUCCEEDED and rejects re-completion", async () => {
    const { repository } = initDatabase();

    await repository.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    const completed = await repository.completeExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });

    expect(completed).toEqual({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });

    await expect(
      repository.findExecutionForAction("action-001"),
    ).resolves.toEqual(completed);

    // Re-completing already SUCCEEDED execution must fail
    await expect(
      repository.completeExecution({
        id: "execution-001",
        actionId: "action-001",
        authorizationId: "authorization-001",
        status: "SUCCEEDED",
        startedAt: timestamp,
        completedAt: "2026-09-10T12:00:02.000Z",
        externalReference: "tx-reference-002",
      }),
    ).rejects.toThrow(
      "Execution execution-001 is not the active pending execution",
    );
  });

  it("successfully transitions PENDING -> FAILED", async () => {
    const { repository } = initDatabase();

    await repository.claimExecution({
      id: "execution-002",
      actionId: "action-002",
      authorizationId: "authorization-002",
      status: "PENDING",
      startedAt: timestamp,
    });

    const failed = await repository.completeExecution({
      id: "execution-002",
      actionId: "action-002",
      authorizationId: "authorization-002",
      status: "FAILED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      errorCode: "REVERTED_ON_CHAIN",
    });

    expect(failed).toEqual({
      id: "execution-002",
      actionId: "action-002",
      authorizationId: "authorization-002",
      status: "FAILED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      errorCode: "REVERTED_ON_CHAIN",
    });

    await expect(
      repository.findExecutionForAction("action-002"),
    ).resolves.toEqual(failed);
  });

  it("persists records across different repository instances using the same database", async () => {
    const sqlite = new DatabaseSync(":memory:");
    const { d1: d1Instance1 } = initDatabase(sqlite);
    const repo1 = new D1ScarRepository(d1Instance1, workspaceId);

    await repo1.saveAgent(validAgent());
    await repo1.saveAction(validAction());
    await repo1.appendIncident(validIncident());
    await repo1.saveAuthorization(validAuthorization());
    await repo1.saveApproval(validApproval());
    await repo1.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });
    await repo1.completeExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });

    // Create a brand new D1ScarRepository instance connected to the same underlying SQLite
    const d1Instance2 = createD1Mock(sqlite);
    const repo2 = new D1ScarRepository(d1Instance2, workspaceId);

    await expect(repo2.findAgentById("agent-treasury")).resolves.toEqual(
      validAgent(),
    );
    await expect(repo2.findActionById("action-001")).resolves.toEqual(
      validAction(),
    );
    await expect(repo2.findIncidentById("scar-001")).resolves.toEqual(
      validIncident(),
    );
    await expect(
      repo2.findAuthorizationForAction("action-001"),
    ).resolves.toEqual(validAuthorization());
    await expect(repo2.findApprovalById("approval-001")).resolves.toEqual(
      validApproval(),
    );
    await expect(repo2.findExecutionForAction("action-001")).resolves.toEqual({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });
  });

  it("stores and retrieves Base execution receipts", async () => {
    const { repository } = initDatabase();

    const receipt = {
      actionId: "action-001",
      agentId: "agent-treasury",
      authorizationId: "authorization-001",
      network: "BASE_SEPOLIA" as const,
      chainId: 84532 as const,
      tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      recipient: "0x1111111111111111111111111111111111111111",
      amountAtomic: "1000000",
      transactionHash:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      blockNumber: "12345678",
      outcome: "CONFIRMED" as const,
      submittedAt: timestamp,
      resolvedAt: "2026-09-10T12:00:05.000Z",
    };

    const saved = await repository.saveBaseExecutionReceipt(receipt);
    expect(saved).toEqual(receipt);

    const retrieved =
      await repository.findBaseExecutionReceiptForAction("action-001");
    expect(retrieved).toEqual(receipt);
  });
});

function validAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-treasury",
    name: "Treasury Agent",
    role: "Moves approved company funds",
    status: "ACTIVE" as const,
    permissions: ["USDC_TRANSFER" as const],
    ...overrides,
  };
}

function validAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-001",
    agentId: "agent-treasury",
    actionType: "USDC_TRANSFER" as const,
    amountAtomic: "1000000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
    ...overrides,
  };
}

function validIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: "scar-001",
    sourceAgentId: "agent-treasury",
    relatedActionId: "action-001",
    entityId: "supplier-alpha",
    actionType: "USDC_TRANSFER" as const,
    context: "Supplier Alpha requested a transfer.",
    outcome: "The transfer reached an unverified recipient.",
    severity: "CRITICAL" as const,
    reason: "Recipient mismatch",
    mitigation: "Block related transfers pending review.",
    evidence: [
      {
        kind: "TRANSACTION" as const,
        reference: "tx-reference-001",
        observedAt: timestamp,
      },
    ],
    provenance: {
      source: "OPERATOR_REPORT" as const,
      recordedBy: "operator-001",
      observedAt: timestamp,
    },
    createdAt: timestamp,
    ...overrides,
  };
}

function validAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    id: "authorization-001",
    actionId: "action-001",
    decision: "REVIEW" as const,
    reasonCode: "RELEVANT_INCIDENT_REQUIRES_REVIEW",
    rationale: "A related incident requires explicit human approval.",
    evidence: [
      {
        kind: "SYSTEM_EVENT" as const,
        reference: "scar-001",
        observedAt: timestamp,
      },
    ],
    provenance: {
      engine: "SCAR_DETERMINISTIC_POLICY" as const,
      policyVersion: "policy-v1",
      evaluatedAt: timestamp,
    },
    ...overrides,
  };
}

function validMemoryBundle() {
  return {
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha-external",
      type: "COUNTERPARTY" as const,
      createdAt: timestamp,
    },
    incident: validIncident(),
    safeguard: {
      id: "safeguard-001",
      sourceIncidentId: "scar-001",
      trigger: {
        entityId: "supplier-alpha",
        actionType: "USDC_TRANSFER" as const,
      },
      scope: { agentIds: ["agent-treasury"] },
      requiredResponse: "BLOCK" as const,
      reason: "Block related transfers pending review.",
      createdAt: timestamp,
    },
    auditEvent: {
      id: "audit-001",
      eventType: "SCAR_RECORDED" as const,
      actorId: "operator-001",
      incidentId: "scar-001",
      entityId: "supplier-alpha",
      safeguardId: "safeguard-001",
      occurredAt: timestamp,
    },
  };
}

function validApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-001",
    actionId: "action-001",
    authorizationId: "authorization-001",
    approvedBy: "operator-001",
    approvedAt: timestamp,
    ...overrides,
  };
}
