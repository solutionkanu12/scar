# SCAR Authenticated API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose SCAR’s existing trusted workflows through a fail-closed, Supabase-authenticated HTTP API with D1-backed human roles, revocable agent credentials, audit records, and rate limits.

**Architecture:** Route handlers are thin adapters over a framework-neutral HTTP API module. A replaceable identity-provider port verifies Supabase asymmetric JWTs using the project JWKS; a separate D1 security store resolves human roles and agent credentials. The API builds trusted SCAR inputs and delegates policy and execution only to `ScarService`.

**Tech Stack:** Vinext/Cloudflare Workers, TypeScript, Drizzle/D1, Zod, Web Crypto, `jose`, Vitest.

**Spec:** User-approved Task 2B.3 architecture in this conversation.

## Global Constraints

- Use Supabase Auth JWTs signed with ES256 or RS256 and verify JWKS signature, issuer, `authenticated` audience, expiry, and subject server-side.
- Do not depend on or call the prototype ChatGPT authentication helper from production SCAR code.
- Human role and agent credential authorization live in D1; request JSON never supplies a principal, role, approver, or provenance actor.
- Agent credentials are revocable, expiry-bounded, hashed, restricted to their registered agent, and can never approve or administer.
- Preserve gate, approval, execution, and immutable Sibyl retry invariants; no route may bypass `ScarService` or `ExecutionBoundary`.
- Keep secrets, policy, D1 binding, JWKS configuration, and adapters server-only. Do not modify frontend/demo flow, commit, or push.

## Review Focus

- A valid JWT from a different Supabase issuer or with an `anon` audience must be rejected before role lookup.
- A revoked or expired agent credential must not obtain access even if its secret is otherwise correct.
- A credential for Agent A must not read, evaluate, execute, or propose work for Agent B.
- Replaying an incident retry after a Sibyl failure must send the original D1 envelope, not reconstruct request evidence.
- A transport failure after blockchain broadcast must return the durable execution state without declaring the action safe to retry.

---

### Task 1: Identity and D1 security state

**Files:**
- Create: `server/scar/http/contracts.ts`, `server/scar/http/identity.ts`, `server/scar/http/security-repository.ts`
- Modify: `db/schema.ts`, `cloudflare-env.d.ts`
- Create: `test/backend/scar-http-identity.test.ts`, `test/backend/scar-security-repository.test.ts`

**Interfaces:**
- Produces `IdentityProvider`, verified human/agent principals, `D1ScarSecurityRepository`, role lookup, credential lookup, audit append, and atomic rate-limit claim.

- [ ] Write failing tests for issuer/audience/expiry/signature rejection, D1 role lookup, credential revocation/expiry, and atomic rate-limit denial.
- [ ] Run focused tests and observe missing-module failures.
- [ ] Add only the `jose` dependency, schemas/migration, identity verifier, and D1 security repository needed to pass.
- [ ] Run focused tests green.

### Task 2: Server-only runtime and immutable incident retry

**Files:**
- Create: `server/scar/http/runtime.ts`
- Modify: `server/scar/scar-service.ts`
- Create: `test/backend/scar-http-runtime.test.ts`
- Modify: `test/backend/scar-service.test.ts`

**Interfaces:**
- Consumes Task 1 security contracts and existing `createProductionScarService`.
- Produces validated server-only runtime dependencies and `ScarService.retryIncident(incidentId)`.

- [ ] Write failing tests for missing production configuration, no import-time secret construction, and retrying the saved memory bundle.
- [ ] Run focused tests and observe expected failures.
- [ ] Implement the runtime factory and retry workflow without changing gate or execution policy.
- [ ] Run focused tests green.

### Task 3: Framework-neutral authenticated API

**Files:**
- Create: `server/scar/http/api.ts`, `server/scar/http/request.ts`
- Create: `test/backend/scar-http-api.test.ts`

**Interfaces:**
- Consumes Task 1 principal/security store and Task 2 service runtime.
- Produces request handlers for agents, actions, evaluation, approval, execution, incidents/outcomes, retry, lifecycle, credential issue, and credential revoke.

- [ ] Write failing behavior tests for role matrix, stripped approval/provenance fields, agent action isolation, body/origin limits, replay, and `ScarMemoryPersistenceError` handling.
- [ ] Run focused tests and observe expected failures.
- [ ] Implement strict DTO parsing, same-origin mutation checks, D1 audit/rate gates, trusted input construction, and stable public errors.
- [ ] Run focused tests green.

### Task 4: App route adapters and verification

**Files:**
- Create: `app/api/scar/**/route.ts`
- Create: `test/backend/scar-api-routes.test.ts`
- Modify: `README.md` only for required production configuration and credential lifecycle.

**Interfaces:**
- Consumes Task 3 API handlers and Task 2 runtime factory.
- Produces thin server-only HTTP route adapters with no frontend changes.

- [ ] Write failing route-adapter tests for parameter forwarding and no-cache responses.
- [ ] Run focused tests and observe expected failures.
- [ ] Add route adapters and operational documentation.
- [ ] Run focused tests, the complete normal suite, real Sibyl sidecar suite, `git diff --check`, and production build.
