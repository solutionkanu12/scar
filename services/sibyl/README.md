# Scar Sibyl sidecar

This service is Scar's isolated persistence adapter for the official
[`sibyl-memory-client`](https://github.com/Sibyl-Labs/Sibyl-Memory/tree/main/sibyl-memory-client).
The dependency is locked to `0.8.0` in `pyproject.toml` and `uv.lock`.

The sidecar stores entities, incidents, and learned safeguards as Sibyl WARM
entities. It stores Scar audit events in Sibyl's append-only COLD journal. It
returns typed evidence and has no policy, authorization, approval, execution,
Base, or Virtuals capability.

## Runtime contract

- Production runs on Linux.
- `SIBYL_DB_PATH` must point into a durable, writable disk mount. Do not place
  the database on an ephemeral container filesystem.
- Keep the default loopback bind when Scar and the sidecar share a host. If the
  sidecar crosses a network boundary, put it on a private network behind TLS;
  the TypeScript client rejects non-loopback plaintext HTTP.
- `SIBYL_SIDECAR_TOKEN` is a server-side service credential. Use at least 16
  characters and never expose it to the browser or logs.
- Keep `SIBYL_TENANT_ID` stable across restarts. It defines the Sibyl tenant
  namespace used by this Scar deployment.

Required environment variables:

| Variable | Purpose |
| --- | --- |
| `SIBYL_DB_PATH` | Absolute or service-relative path to the durable SQLite file |
| `SIBYL_TENANT_ID` | Stable Sibyl tenant identifier |
| `SIBYL_SIDECAR_TOKEN` | Shared bearer credential for the Scar server |

Optional environment variables are `SIBYL_SIDECAR_HOST` (default
`127.0.0.1`) and `SIBYL_SIDECAR_PORT` (default `7331`).

## Local development

Sibyl does not officially support native Windows. Running it there with `uv`
is development and acceptance testing only; it does not change the Linux
production requirement.

```powershell
uv sync --project services/sibyl --frozen --python 3.12
$env:SIBYL_DB_PATH = "services/sibyl/development.db"
$env:SIBYL_TENANT_ID = "scar-development"
$env:SIBYL_SIDECAR_TOKEN = "replace-with-a-local-secret"
uv run --project services/sibyl --frozen --python 3.12 -- python services/sibyl/service.py
```

Run the real restart-persistence suite with:

```powershell
npm.cmd run test:sibyl
```

The ordinary TypeScript test suite skips the sidecar integration file unless
it is running inside the `uv` environment. `test:sibyl` is therefore required
for this adapter's acceptance verification.
