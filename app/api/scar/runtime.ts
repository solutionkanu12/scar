import { getProductionScarHttpApi } from "@/server/scar/http/runtime";
import { identifierSchema } from "@/server/scar/domain";

/** Keep deployment configuration failures opaque to HTTP callers. */
export async function withScarApi(
  handler: (api: ReturnType<typeof getProductionScarHttpApi>) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(getProductionScarHttpApi());
  } catch {
    return Response.json(
      { error: { code: "CONFIGURATION_INVALID" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

/** Parses an untrusted route segment before the server builds a scoped service. */
export async function withWorkspaceScarApi(
  workspaceId: string,
  handler: (
    api: ReturnType<
      ReturnType<typeof getProductionScarHttpApi>["forWorkspace"]
    >,
  ) => Promise<Response>,
): Promise<Response> {
  const parsed = identifierSchema.safeParse(workspaceId);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_WORKSPACE" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  return withScarApi(async (api) => {
    if (!api.multiWorkspaceOperationsEnabled) return multiWorkspaceDisabled();
    return handler(api.forWorkspace(parsed.data));
  });
}

/** Public tenant routes remain off until the tenant-aware sidecar is verified. */
export async function withMultiWorkspaceScarApi(
  handler: (api: ReturnType<typeof getProductionScarHttpApi>) => Promise<Response>,
): Promise<Response> {
  return withScarApi(async (api) =>
    api.multiWorkspaceOperationsEnabled ? handler(api) : multiWorkspaceDisabled(),
  );
}

function multiWorkspaceDisabled(): Response {
  return Response.json(
    { error: { code: "MULTI_WORKSPACE_OPERATIONS_DISABLED" } },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}
