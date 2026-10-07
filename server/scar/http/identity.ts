import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";

import type { AgentCredentialRecord, AgentOperation } from "./contracts";

const supabaseSubjectSchema = z.string().uuid();

export interface HumanPrincipal {
  type: "HUMAN";
  subject: string;
}

export interface AgentPrincipal {
  type: "AGENT";
  subject: string;
  workspaceId: string;
  agentId: string;
  allowedOperations: AgentOperation[];
}

export type AuthenticatedPrincipal = HumanPrincipal | AgentPrincipal;

export interface IdentityProvider {
  authenticate(request: Request): Promise<AuthenticatedPrincipal>;
}

/**
 * Selects a credential family from the credential's untrusted *format* only;
 * each selected provider still performs its own verification. This keeps human
 * JWTs and revocable agent credentials independently replaceable.
 */
export class CompositeIdentityProvider implements IdentityProvider {
  constructor(
    private readonly providers: {
      human: IdentityProvider;
      agent: IdentityProvider;
    },
  ) {}

  authenticate(request: Request): Promise<AuthenticatedPrincipal> {
    return request.headers
      .get("authorization")
      ?.startsWith("Bearer scar_agent_")
      ? this.providers.agent.authenticate(request)
      : this.providers.human.authenticate(request);
  }
}

export type JwtVerifier = (token: string) => Promise<JWTPayload>;

export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class SupabaseJwksIdentityProvider implements IdentityProvider {
  private readonly verifyJwt: JwtVerifier;

  constructor(input: { issuer: string; verifyJwt: JwtVerifier }) {
    validateIssuer(input.issuer);
    this.verifyJwt = input.verifyJwt;
  }

  async authenticate(request: Request): Promise<HumanPrincipal> {
    const token = extractBearerToken(request.headers.get("authorization"));
    try {
      const claims = await this.verifyJwt(token);
      return {
        type: "HUMAN",
        subject: supabaseSubjectSchema.parse(claims.sub),
      };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError("The access token could not be verified.");
    }
  }
}

export interface AgentCredentialReader {
  findWorkspaceAgentCredential(
    workspaceId: string,
    id: string,
  ): Promise<AgentCredentialRecord | null>;
}

export class AgentCredentialIdentityProvider implements IdentityProvider {
  private readonly now: () => string;

  constructor(
    private readonly dependencies: {
      credentialReader: AgentCredentialReader;
      pepper: string;
      now?: () => string;
    },
  ) {
    if (dependencies.pepper.length < 32) {
      throw new Error("Agent credential pepper must be at least 32 characters.");
    }
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async authenticate(request: Request): Promise<AgentPrincipal> {
    const token = extractAgentCredential(request.headers.get("authorization"));
    const credential = await this.dependencies.credentialReader.findWorkspaceAgentCredential(
      token.workspaceId,
      token.credentialId,
    );
    if (
      !credential ||
      credential.workspaceId !== token.workspaceId ||
      credential.status !== "ACTIVE" ||
      Date.parse(credential.expiresAt) <= Date.parse(this.now())
    ) {
      throw new AuthenticationError("The agent credential is unavailable.");
    }

    const candidateHash = await hashAgentCredentialSecret(
      token.secret,
      this.dependencies.pepper,
    );
    if (!constantTimeEqual(credential.secretHash, candidateHash)) {
      throw new AuthenticationError("The agent credential could not be verified.");
    }

    return {
      type: "AGENT",
      subject: credential.id,
      workspaceId: credential.workspaceId,
      agentId: credential.agentId,
      allowedOperations: [...credential.allowedOperations],
    };
  }
}

export function createSupabaseJwtVerifier(input: {
  issuer: string;
  jwks?: JWTVerifyGetKey;
}): JwtVerifier {
  const issuer = validateIssuer(input.issuer);
  const jwks =
    input.jwks ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 600_000,
    });

  return async (token: string) => {
    const verified = await jwtVerify(token, jwks, {
      issuer,
      audience: "authenticated",
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "iss", "aud", "exp"],
    });
    return verified.payload;
  };
}

function extractBearerToken(header: string | null): string {
  if (!header) throw new AuthenticationError();
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    header,
  );
  if (!match || match[1].length > 8_192) {
    throw new AuthenticationError();
  }
  return match[1];
}

function extractAgentCredential(header: string | null): {
  workspaceId: string;
  credentialId: string;
  secret: string;
} {
  if (!header) throw new AuthenticationError();
  const match = /^Bearer scar_agent_([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\.([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\.([A-Za-z0-9_-]{43,128})$/.exec(
    header,
  );
  if (!match) throw new AuthenticationError();
  return { workspaceId: match[1], credentialId: match[2], secret: match[3] };
}

export async function hashAgentCredentialSecret(
  secret: string,
  pepper: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function validateIssuer(value: string): string {
  const parsed = new URL(z.string().url().parse(value));
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.pathname.endsWith("/auth/v1")
  ) {
    throw new Error("Supabase issuer must be an HTTPS Auth v1 URL.");
  }
  return parsed.toString().replace(/\/$/, "");
}
