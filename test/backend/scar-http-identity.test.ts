// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import {
  AgentCredentialIdentityProvider,
  AuthenticationError,
  CompositeIdentityProvider,
  createSupabaseJwtVerifier,
  hashAgentCredentialSecret,
  SupabaseJwksIdentityProvider,
} from "@/server/scar/http/identity";

describe("SupabaseJwksIdentityProvider", () => {
  it("routes only the SCAR agent credential format to the agent verifier", async () => {
    const human = {
      authenticate: vi.fn(async () => ({
        type: "HUMAN" as const,
        subject: "123e4567-e89b-12d3-a456-426614174000",
      })),
    };
    const agent = {
      authenticate: vi.fn(async () => ({
        type: "AGENT" as const,
        subject: "credential-001",
        workspaceId: "workspace-alpha",
        agentId: "agent-treasury",
        allowedOperations: ["READ_ACTION" as const],
      })),
    };
    const provider = new CompositeIdentityProvider({ human, agent });

    await provider.authenticate(
      new Request("https://scar.test", {
        headers: {
          authorization:
            "Bearer scar_agent_workspace-alpha.credential-001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      }),
    );
    expect(agent.authenticate).toHaveBeenCalledOnce();
    expect(human.authenticate).not.toHaveBeenCalled();
  });

  it("rejects a request that has no bearer credential", async () => {
    const provider = new SupabaseJwksIdentityProvider({
      issuer: "https://scar-auth.supabase.co/auth/v1",
      verifyJwt: async () => ({
        sub: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    await expect(provider.authenticate(new Request("https://scar.test/api"))).rejects
      .toBeInstanceOf(AuthenticationError);
  });

  it("returns only the verified Supabase subject", async () => {
    const provider = new SupabaseJwksIdentityProvider({
      issuer: "https://scar-auth.supabase.co/auth/v1",
      verifyJwt: async () => ({
        sub: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    await expect(
      provider.authenticate(
        new Request("https://scar.test/api", {
          headers: { authorization: "Bearer header.payload.signature" },
        }),
      ),
    ).resolves.toEqual({
      type: "HUMAN",
      subject: "123e4567-e89b-12d3-a456-426614174000",
    });
  });

  it("rejects a correctly signed token from a different issuer", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = "scar-test-key";
    publicJwk.alg = "ES256";
    const verifier = createSupabaseJwtVerifier({
      issuer: "https://scar-auth.supabase.co/auth/v1",
      jwks: createLocalJWKSet({ keys: [publicJwk] }),
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "scar-test-key" })
      .setIssuer("https://other-project.supabase.co/auth/v1")
      .setAudience("authenticated")
      .setSubject("123e4567-e89b-12d3-a456-426614174000")
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(privateKey);
    const provider = new SupabaseJwksIdentityProvider({
      issuer: "https://scar-auth.supabase.co/auth/v1",
      verifyJwt: verifier,
    });

    await expect(
      provider.authenticate(
        new Request("https://scar.test/api", {
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a revoked agent credential even when its secret matches", async () => {
    const secret = "a".repeat(43);
    const pepper = "p".repeat(32);
    const provider = new AgentCredentialIdentityProvider({
      credentialReader: {
        async findWorkspaceAgentCredential() {
          return {
            workspaceId: "workspace-alpha",
            id: "credential-001",
            agentId: "agent-treasury",
            secretHash: await hashAgentCredentialSecret(secret, pepper),
            allowedOperations: ["PROPOSE_ACTION" as const],
            status: "REVOKED" as const,
            createdAt: "2026-09-10T12:00:00.000Z",
            expiresAt: "2026-10-10T12:00:00.000Z",
            revokedAt: "2026-09-11T12:00:00.000Z",
          };
        },
      },
      pepper,
      now: () => "2026-09-12T12:00:00.000Z",
    });

    await expect(
      provider.authenticate(
        new Request("https://scar.test/api", {
          headers: {
            authorization: `Bearer scar_agent_workspace-alpha.credential-001.${secret}`,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("binds an active agent credential to its registered agent and operations", async () => {
    const secret = "b".repeat(43);
    const pepper = "p".repeat(32);
    const provider = new AgentCredentialIdentityProvider({
      credentialReader: {
        async findWorkspaceAgentCredential() {
          return {
            workspaceId: "workspace-alpha",
            id: "credential-001",
            agentId: "agent-treasury",
            secretHash: await hashAgentCredentialSecret(secret, pepper),
            allowedOperations: ["PROPOSE_ACTION" as const, "READ_ACTION" as const],
            status: "ACTIVE" as const,
            createdAt: "2026-09-10T12:00:00.000Z",
            expiresAt: "2026-10-10T12:00:00.000Z",
          };
        },
      },
      pepper,
      now: () => "2026-09-12T12:00:00.000Z",
    });

    await expect(
      provider.authenticate(
        new Request("https://scar.test/api", {
          headers: {
            authorization: `Bearer scar_agent_workspace-alpha.credential-001.${secret}`,
          },
        }),
      ),
    ).resolves.toEqual({
      type: "AGENT",
      subject: "credential-001",
      workspaceId: "workspace-alpha",
      agentId: "agent-treasury",
      allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
    });
  });
});
