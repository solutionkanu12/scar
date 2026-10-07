import { env } from "cloudflare:workers";
import { z } from "zod";

import { BaseExecutionAdapter } from "../base-execution";
import { createProductionScarService } from "../composition";
import { D1ScarRepository } from "../d1-repository";
import { ViemBaseChainGateway } from "../viem-base-chain-gateway";
import { createScarHttpApi } from "./api";
import {
  AgentCredentialIdentityProvider,
  CompositeIdentityProvider,
  createSupabaseJwtVerifier,
  SupabaseJwksIdentityProvider,
} from "./identity";
import { D1ScarSecurityRepository } from "./security-repository";
import { createWorkspaceApi } from "./workspace-api";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const privateKeyPattern = /^(?:0x)?[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

export interface ScarProductionBindings {
  DB: D1Database;
  SCAR_PUBLIC_ORIGIN: string;
  /** Set only after sidecar tenant-isolation deployment is independently verified. */
  SCAR_MULTI_WORKSPACE_OPERATIONS_ENABLED?: string;
  SCAR_SUPABASE_AUTH_ISSUER: string;
  SCAR_AGENT_CREDENTIAL_PEPPER: string;
  SCAR_SIBYL_BASE_URL: string;
  SCAR_SIBYL_TOKEN: string;
  SCAR_SIBYL_TENANT_SIGNING_KEY: string;
  SCAR_POLICY_VERSION: string;
  SCAR_POLICY_MAX_AMOUNT_ATOMIC: string;
  SCAR_POLICY_REVIEW_AMOUNT_ATOMIC: string;
  SCAR_POLICY_ALLOWED_CHAIN_IDS: string;
  SCAR_BASE_SEPOLIA_RPC_URL: string;
  SCAR_BASE_EXECUTOR_PRIVATE_KEY: string;
  /** Opaque runtime mapping key, never a signing key itself. */
  SCAR_BASE_EXECUTOR_KEY_REFERENCE: string;
  SCAR_BASE_USDC_ADDRESS: string;
}

interface ScarProductionConfiguration {
  multiWorkspaceOperationsEnabled: boolean;
  publicOrigin: string;
  supabaseIssuer: string;
  agentCredentialPepper: string;
  sibylBaseUrl: string;
  sibylToken: string;
  sibylTenantSigningKey: string;
  policy: {
    policyVersion: string;
    maxAmountAtomic: string;
    reviewAmountAtomic: string;
    allowedChainIds: number[];
  };
  base: {
    rpcUrl: string;
    privateKey: string;
    executorKeyReference: string;
    usdcAddress: string;
  };
}

export interface ProductionScarHttpApi {
  multiWorkspaceOperationsEnabled: boolean;
  workspaces: ReturnType<typeof createWorkspaceApi>;
  forWorkspace(workspaceId: string): ReturnType<typeof createScarHttpApi>;
  /** Legacy singleton routes are deliberately fail-closed. */
  registerAgent(...args: unknown[]): Promise<Response>;
  issueAgentCredential(...args: unknown[]): Promise<Response>;
  revokeAgentCredential(...args: unknown[]): Promise<Response>;
  proposeAction(...args: unknown[]): Promise<Response>;
  evaluateAction(...args: unknown[]): Promise<Response>;
  approveAction(...args: unknown[]): Promise<Response>;
  executeAction(...args: unknown[]): Promise<Response>;
  recordIncident(...args: unknown[]): Promise<Response>;
  recordOutcome(...args: unknown[]): Promise<Response>;
  retryIncident(...args: unknown[]): Promise<Response>;
  getActionState(...args: unknown[]): Promise<Response>;
}

let productionApi: ProductionScarHttpApi | null = null;

/**
 * Request-time-only production composition. Each workspace API gets a newly
 * scoped D1 repository and Sibyl client. Signer configuration is never read at
 * module import, and a disabled/mismatched workspace configuration cannot
 * reach an execution adapter.
 */
export function createProductionScarHttpApi(
  bindings: ScarProductionBindings,
): ProductionScarHttpApi {
  const config = parseProductionConfiguration(bindings);
  const security = new D1ScarSecurityRepository(bindings.DB);
  const human = new SupabaseJwksIdentityProvider({
    issuer: config.supabaseIssuer,
    verifyJwt: createSupabaseJwtVerifier({ issuer: config.supabaseIssuer }),
  });
  const agent = new AgentCredentialIdentityProvider({
    credentialReader: security,
    pepper: config.agentCredentialPepper,
  });
  const identityProvider = new CompositeIdentityProvider({ human, agent });

  const forWorkspace = (workspaceId: string) => {
    const receiptRepository = new D1ScarRepository(bindings.DB, workspaceId);
    const gateway = new ViemBaseChainGateway({
      rpcUrl: config.base.rpcUrl,
      privateKey: config.base.privateKey,
    });
    const adapter = new BaseExecutionAdapter({
      gateway,
      tokenAddress: config.base.usdcAddress,
      recordReceipt: async (receipt) => {
        await receiptRepository.saveBaseExecutionReceipt(receipt);
      },
    });
    const service = createProductionScarService({
      database: bindings.DB,
      workspaceId,
      sibyl: {
        baseUrl: config.sibylBaseUrl,
        token: config.sibylToken,
        tenantSigningKey: config.sibylTenantSigningKey,
      },
      policy: config.policy,
      execution: {
        adapter,
        constraints: {
          maxAmountAtomic: config.policy.maxAmountAtomic,
          allowedChainIds: config.policy.allowedChainIds,
        },
      },
    });
    return createScarHttpApi({
      identityProvider,
      security,
      service,
      workspaceId,
      publicOrigin: config.publicOrigin,
      agentCredentialPepper: config.agentCredentialPepper,
      executionConfigurationAllows: ({ configuration }) =>
        configuration?.status === "ENABLED" &&
        configuration.executorKeyReference === config.base.executorKeyReference &&
        configuration.chainId !== null &&
        configuration.chainId !== undefined &&
        config.policy.allowedChainIds.includes(configuration.chainId) &&
        configuration.tokenAddress?.toLowerCase() ===
          config.base.usdcAddress.toLowerCase(),
    });
  };

  return {
    multiWorkspaceOperationsEnabled: config.multiWorkspaceOperationsEnabled,
    workspaces: createWorkspaceApi({
      identityProvider,
      security,
      publicOrigin: config.publicOrigin,
    }),
    forWorkspace,
    registerAgent: retiredSingletonRoute,
    issueAgentCredential: retiredSingletonRoute,
    revokeAgentCredential: retiredSingletonRoute,
    proposeAction: retiredSingletonRoute,
    evaluateAction: retiredSingletonRoute,
    approveAction: retiredSingletonRoute,
    executeAction: retiredSingletonRoute,
    recordIncident: retiredSingletonRoute,
    recordOutcome: retiredSingletonRoute,
    retryIncident: retiredSingletonRoute,
    getActionState: retiredSingletonRoute,
  };
}

/** Lazy composition keeps all secret access out of module import. */
export function getProductionScarHttpApi(): ProductionScarHttpApi {
  if (!productionApi) {
    productionApi = createProductionScarHttpApi(env as ScarProductionBindings);
  }
  return productionApi;
}

export function parseProductionConfiguration(
  input: Omit<ScarProductionBindings, "DB">,
): ScarProductionConfiguration {
  const policyVersion = requiredIdentifier(input.SCAR_POLICY_VERSION, "policy version");
  const multiWorkspaceFlag = input.SCAR_MULTI_WORKSPACE_OPERATIONS_ENABLED ?? "false";
  if (multiWorkspaceFlag !== "true" && multiWorkspaceFlag !== "false") {
    throw new Error("SCAR multi-workspace operations flag must be true or false.");
  }
  const multiWorkspaceOperationsEnabled = multiWorkspaceFlag === "true";
  const publicOrigin = requiredHttpsOrigin(input.SCAR_PUBLIC_ORIGIN, "public origin");
  const supabaseIssuer = requiredSupabaseIssuer(input.SCAR_SUPABASE_AUTH_ISSUER);
  const sibylBaseUrl = requiredHttpUrl(input.SCAR_SIBYL_BASE_URL, "Sibyl URL");
  const rpcUrl = requiredHttpUrl(input.SCAR_BASE_SEPOLIA_RPC_URL, "Base RPC URL");
  const agentCredentialPepper = z.string().min(32).parse(input.SCAR_AGENT_CREDENTIAL_PEPPER);
  const sibylToken = z.string().min(16).max(512).parse(input.SCAR_SIBYL_TOKEN);
  const sibylTenantSigningKey = z
    .string()
    .min(32)
    .max(512)
    .parse(input.SCAR_SIBYL_TENANT_SIGNING_KEY);
  const maxAmountAtomic = uintString(input.SCAR_POLICY_MAX_AMOUNT_ATOMIC, "policy maximum");
  const reviewAmountAtomic = uintString(
    input.SCAR_POLICY_REVIEW_AMOUNT_ATOMIC,
    "policy review threshold",
  );
  if (BigInt(reviewAmountAtomic) > BigInt(maxAmountAtomic)) {
    throw new Error("SCAR review threshold cannot exceed policy maximum.");
  }
  const allowedChainIds = parseChainIds(input.SCAR_POLICY_ALLOWED_CHAIN_IDS);
  const privateKey = z.string().regex(privateKeyPattern).parse(
    input.SCAR_BASE_EXECUTOR_PRIVATE_KEY,
  );
  const usdcAddress = z.string().regex(addressPattern).parse(input.SCAR_BASE_USDC_ADDRESS);
  const executorKeyReference = requiredIdentifier(
    input.SCAR_BASE_EXECUTOR_KEY_REFERENCE,
    "Base executor key reference",
  );

  return {
    multiWorkspaceOperationsEnabled,
    publicOrigin,
    supabaseIssuer,
    agentCredentialPepper,
    sibylBaseUrl,
    sibylToken,
    sibylTenantSigningKey,
    policy: {
      policyVersion,
      maxAmountAtomic,
      reviewAmountAtomic,
      allowedChainIds,
    },
    base: { rpcUrl, privateKey, executorKeyReference, usdcAddress },
  };
}

async function retiredSingletonRoute(..._args: unknown[]): Promise<Response> {
  return Response.json(
    { error: { code: "WORKSPACE_ROUTE_REQUIRED" } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function requiredIdentifier(value: string, name: string): string {
  if (!value || !identifierPattern.test(value) || value.length > 128) {
    throw new Error(`SCAR ${name} is invalid.`);
  }
  return value;
}

function uintString(value: string, name: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error(`SCAR ${name} must be a positive integer string.`);
  }
  return value;
}

function parseChainIds(value: string): number[] {
  const parsed = value
    .split(",")
    .map((part) => Number(part.trim()));
  if (
    parsed.length === 0 ||
    parsed.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error("SCAR allowed chain IDs are invalid.");
  }
  return parsed;
}

function requiredHttpsOrigin(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`SCAR ${name} must be an HTTPS origin.`);
  }
  return url.origin;
}

function requiredSupabaseIssuer(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/auth/v1")
  ) {
    throw new Error("SCAR Supabase issuer must be an HTTPS Auth v1 URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function requiredHttpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error(`SCAR ${name} must be an HTTP(S) URL without credentials.`);
  }
  return url.toString().replace(/\/$/, "");
}
