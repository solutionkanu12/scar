import { describe, expect, it, vi } from "vitest";

import {
  createAgentCredentialSecret,
  ScarApiClient,
} from "@/features/scar/scar-api";

describe("browser agent credential provisioning", () => {
  it("creates exactly 64 URL-safe secret characters from local Web Crypto", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    const secret = createAgentCredentialSecret();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect((spy.mock.calls[0]?.[0] as Uint8Array).byteLength).toBe(48);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(secret.includes("=")).toBe(false);
    spy.mockRestore();
  });

  it("sends the local secret once and assembles the bearer token without receiving one", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          credential: {
            id: "credential:browser-001",
            workspaceId: "workspace:alpha",
            agentId: "agent:treasury",
            allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
            status: "ACTIVE",
            createdAt: "2026-10-08T12:00:00.000Z",
            expiresAt: "2026-10-09T12:00:00.000Z",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    const api = new ScarApiClient(() => "human-access-token", undefined, request);

    const provisioned = await api.issueAgentCredential(
      "workspace:alpha",
      "agent:treasury",
      {
        allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
        expiresAt: "2026-10-09T12:00:00.000Z",
      },
    );

    const [, init] = (request as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
      expiresAt: "2026-10-09T12:00:00.000Z",
    });
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get("authorization")).toBe("Bearer human-access-token");
    expect(provisioned.token).toBe(
      `Bearer scar_agent_workspace:alpha.credential:browser-001.${body.secret}`,
    );
    expect(provisioned.credential).not.toHaveProperty("secret");
    expect(provisioned.credential).not.toHaveProperty("token");
  });
});
