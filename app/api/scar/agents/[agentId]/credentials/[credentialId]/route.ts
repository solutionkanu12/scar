import { withScarApi } from "../../../../runtime";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ agentId: string; credentialId: string }> },
) {
  const { agentId, credentialId } = await context.params;
  return withScarApi((api) =>
    api.revokeAgentCredential(request, agentId, credentialId),
  );
}
