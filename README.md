# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## SCAR production API authentication

SCAR's production API is independent of ChatGPT authentication and hosting. The
prototype helper in `app/chatgpt-auth.ts` remains unmodified for the starter,
but no SCAR server module imports it. The SCAR routes use a dedicated Supabase
Auth project for human identity and separate revocable credentials for agents.
There is deliberately no login UI in this milestone.

### Required external configuration

1. Create a dedicated Supabase Auth project for SCAR. Enable self-service email
   OTP sign-up (do not enable anonymous users), and configure an asymmetric
   ES256 or RS256 signing key. SCAR validates `iss`, `aud=authenticated`,
   `exp`, `sub`, the signature, and the trusted project JWKS. It does not need
   a Supabase service-role key or browser client key.
2. Apply migrations `0000_sturdy_sunspot.sql` through
   `0005_workspace_scope.sql` to production D1 in order. Existing pre-workspace
   records are retained in a sealed, suspended `workspace:legacy` scope with no
   membership, so they cannot become public tenant data.

   Any verified human can create a personal or organizational workspace. The
   creation batch atomically creates one `OWNER` membership and a `DISABLED`
   execution configuration. OWNER is not an operational or safety role. The
   owner must explicitly grant `ADMIN`, `OPERATOR`, `APPROVER`, or
   `SAFETY_OFFICER`, including to themselves; each grant, regrant, and
   revocation has an append-only D1 role-audit record.
3. Configure these Worker bindings as server secrets/configuration only:

   ```text
   SCAR_PUBLIC_ORIGIN
   SCAR_MULTI_WORKSPACE_OPERATIONS_ENABLED=false
   SCAR_SUPABASE_AUTH_ISSUER=https://<project-ref>.supabase.co/auth/v1
   SCAR_AGENT_CREDENTIAL_PEPPER=<at-least-32-random-characters>
   SCAR_SIBYL_BASE_URL
   SCAR_SIBYL_TOKEN
   SCAR_SIBYL_TENANT_SIGNING_KEY=<at-least-32-random-characters>
   SCAR_POLICY_VERSION
   SCAR_POLICY_MAX_AMOUNT_ATOMIC
   SCAR_POLICY_REVIEW_AMOUNT_ATOMIC
   SCAR_POLICY_ALLOWED_CHAIN_IDS=84532
   SCAR_BASE_SEPOLIA_RPC_URL
   SCAR_BASE_EXECUTOR_PRIVATE_KEY
   SCAR_BASE_EXECUTOR_KEY_REFERENCE=<opaque-runtime-key-reference>
   SCAR_BASE_USDC_ADDRESS
   ```

   The JWKS endpoint must be reachable by the Worker. Never expose the Sibyl
   bearer token, tenant-signing key, credential pepper, or Base private key to
   a browser, agent, log, or API response. Keep
   `SCAR_MULTI_WORKSPACE_OPERATIONS_ENABLED=false` until the tenant-aware
   Sibyl sidecar is deployed and the real two-workspace test has passed.

### API boundary

All responses are `Cache-Control: no-store`; browser requests with an `Origin`
header must use `SCAR_PUBLIC_ORIGIN`, and no permissive CORS header is emitted.
Non-browser agents may omit `Origin` and authenticate with their own revocable
workspace-scoped bearer credential. Requests are byte-limited, strictly
parsed, rate-limited through atomic D1 counters, and accepted operations receive
a durable D1 audit record. The workspace path is validated, but the authority
to use it comes only from D1 membership or the verified credential scope.

| Route | Principal allowed |
| --- | --- |
| `POST /api/scar/workspaces` | Any verified human; creates OWNER only |
| `POST /api/scar/workspaces/:workspaceId/members` | OWNER |
| `DELETE /api/scar/workspaces/:workspaceId/members/:userId` | OWNER; MEMBER only |
| `POST/DELETE /api/scar/workspaces/:workspaceId/members/:userId/roles/:role` | OWNER |
| `POST /api/scar/workspaces/:workspaceId/agents` | OWNER or explicit Admin |
| `POST/DELETE .../agents/:agentId/credentials` | OWNER or explicit Admin |
| `POST .../actions`, `evaluate`, `execute` | explicit Admin, Operator, or owning scoped agent |
| `POST .../approvals` | explicit Admin or Approver; human JWT only |
| `POST .../incidents`, `outcomes`, `retry` | explicit Admin or Safety Officer; human JWT only |
| `GET .../actions/:actionId` | an explicit operational/safety role or owning scoped read credential |

Agent credentials are minted by an OWNER or explicit Admin once, returned
exactly once as `scar_agent_<workspace-id>.<credential-id>.<secret>`, and
stored only as a SHA-256 hash with a server-side pepper. They are restricted to
their workspace, registered agent, and `PROPOSE_ACTION`,
`EVALUATE_ACTION`, `EXECUTE_ACTION`, and/or `READ_ACTION`; they can never
approve, administer, or report incidents. Store the one-time plaintext token in
an agent secret manager, rotate by issuing a replacement, and revoke the old
credential through the workspace route. Revocation is checked from D1 on every
request.

The human approval record is an exact human approval for a persisted REVIEW
authorization. It is not described as independent approval: SCAR has no
two-person approval claim until a separate second-person workflow is added.
New workspace execution is disabled. Only a server-administered D1 execution
configuration whose opaque key reference, chain, and token all match the
private Worker runtime configuration can enable the adapter; no HTTP request
accepts a private key or enables a signer.

Action proposal and incident recording require an `Idempotency-Key` of 16–96
safe characters. A reused action key returns only the same original proposal;
a different proposal is rejected. For incidents, SCAR derives immutable IDs
from the key. If D1 persisted an incident but Sibyl sharing fails, the API
returns `503 MEMORY_PERSISTENCE_PENDING` with `memoryShared: false`; a retry
uses the durable original bundle and cannot replace caller evidence. A failed
or unconfirmed Base transaction is never represented as safe to replay:
`ExecutionBoundary` retains the one-time execution claim, so another execute
request cannot invoke the adapter again.

## Sites Lifecycle

The Sites initializer copies the shared starter with the explicit `--execution-profile portable` or `--execution-profile managed-linux` argument from the plugin's setup instructions. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Whenever reopening or moving a checkout, follow the plugin's instructions to run `configure-execution-profile.mjs --execution-profile <portable|managed-linux>` before project commands. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

On managed Linux, use `sites-preview start` only for requested browser QA. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
