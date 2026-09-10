import type AcpClientType from "@virtuals-protocol/acp-node";
import type { AcpContractConfig } from "@virtuals-protocol/acp-node";

import {
  acpJobRefSchema,
  virtualsAgentRefSchema,
  type AcpJobRef,
  type AcpSettlement,
  type VirtualsAcpGateway,
  type VirtualsAgentRef,
} from "./virtuals-acp";

/**
 * Real {@link VirtualsAcpGateway} backed by the official
 * `@virtuals-protocol/acp-node` SDK against the Base Sepolia ACP sandbox
 * (`baseSepoliaAcpConfig`, chain id 84532).
 *
 * The SDK is loaded with a dynamic import inside {@link init} so that merely
 * importing this module (for example when Vitest evaluates the skipped
 * integration test) does not pull the heavy SDK dependency tree.
 *
 * This class is the only place the whitelisted ACP signing key is held. It is
 * exercised by `npm run test:virtuals`, which is skipped unless the
 * `SCAR_VIRTUALS_ACP_*` credentials are present (mirroring the Sibyl sidecar
 * acceptance gate). It has no authorization or execution capability;
 * consequential settlement is owned by `VirtualsProcurementBridge` through
 * Scar's deterministic gate and executor.
 */

type AcpSdk = typeof import("@virtuals-protocol/acp-node");

export interface AcpVirtualsGatewayConfig {
  /** Whitelisted developer wallet private key (0x-prefixed), server-side only. */
  whitelistedWalletPrivateKey: string;
  /** Numeric session entity id from the ACP registry. */
  sessionEntityKeyId: number;
  /** Treasury (buyer) agent smart-wallet address. */
  buyerAgentWalletAddress: string;
  /** Procurement (seller) agent smart-wallet address. */
  sellerAgentWalletAddress: string;
  /** Registry entity id for the buyer, recorded as interaction evidence. */
  buyerEntityId: string;
  /** Registry entity id for the seller, recorded as interaction evidence. */
  sellerEntityId: string;
  /** ERC-20 used to price the procurement job (Base Sepolia test USDC). */
  priceTokenAddress: string;
  config?: AcpContractConfig;
}

export class AcpVirtualsGateway implements VirtualsAcpGateway {
  readonly buyer: VirtualsAgentRef;

  private client: AcpClientType | null = null;
  private sdk: AcpSdk | null = null;
  private acpConfig: AcpContractConfig | null = null;
  private readonly options: AcpVirtualsGatewayConfig;
  private readonly seller: VirtualsAgentRef;

  constructor(options: AcpVirtualsGatewayConfig) {
    this.options = options;
    this.buyer = virtualsAgentRefSchema.parse({
      label: "Treasury Agent",
      role: "TREASURY_BUYER",
      walletAddress: options.buyerAgentWalletAddress,
      entityId: options.buyerEntityId,
    });
    this.seller = virtualsAgentRefSchema.parse({
      label: "Procurement Agent",
      role: "PROCUREMENT_SELLER",
      walletAddress: options.sellerAgentWalletAddress,
      entityId: options.sellerEntityId,
    });
  }

  async init(): Promise<void> {
    const sdk = await import("@virtuals-protocol/acp-node");
    this.sdk = sdk;
    this.acpConfig = this.options.config ?? sdk.baseSepoliaAcpConfig;

    const acpContractClient = await sdk.AcpContractClientV2.build(
      this.options.whitelistedWalletPrivateKey as `0x${string}`,
      this.options.sessionEntityKeyId,
      this.options.buyerAgentWalletAddress as `0x${string}`,
      this.acpConfig,
    );
    this.client = new sdk.default({ acpContractClient });
    await this.client.init();
  }

  async browseProviders(serviceQuery: string): Promise<VirtualsAgentRef[]> {
    const client = this.assertReady();
    const agents = await client.browseAgents(serviceQuery);
    const matched = agents.some(
      (agent) =>
        agent.walletAddress.toLowerCase() ===
        this.options.sellerAgentWalletAddress.toLowerCase(),
    );
    return matched ? [this.seller] : [];
  }

  async initiateJob(input: {
    provider: VirtualsAgentRef;
    serviceQuery: string;
    requirement: Record<string, unknown>;
    priceAtomic: string;
  }): Promise<AcpJobRef> {
    const client = this.assertReady();
    const sdk = this.assertSdk();
    const fareAmount = await sdk.FareAmount.fromContractAddress(
      BigInt(input.priceAtomic),
      this.options.priceTokenAddress as `0x${string}`,
      this.acpConfig ?? undefined,
    );
    const jobId = await client.initiateJob(
      input.provider.walletAddress as `0x${string}`,
      input.requirement,
      fareAmount,
    );
    return this.getJob(String(jobId));
  }

  async payJob(jobId: string): Promise<AcpSettlement> {
    const client = this.assertReady();
    const job = await client.getJobById(Number(jobId));
    if (!job) throw new Error(`ACP job ${jobId} was not found`);
    const settlement = await job.payAndAcceptRequirement(
      "Scar deterministic gate returned ALLOW",
    );
    if (!settlement?.txnHash) {
      throw new Error(`ACP job ${jobId} settlement returned no transaction`);
    }
    return { job: await this.getJob(jobId), transactionHash: settlement.txnHash };
  }

  async getJob(jobId: string): Promise<AcpJobRef> {
    const client = this.assertReady();
    const sdk = this.assertSdk();
    const job = await client.getJobById(Number(jobId));
    if (!job) throw new Error(`ACP job ${jobId} was not found`);
    const phaseNames = sdk.AcpJobPhases as unknown as Record<number, string>;
    return acpJobRefSchema.parse({
      jobId: String(job.id),
      phase: phaseNames[job.phase] ?? String(job.phase),
      clientAddress: job.clientAddress,
      providerAddress: job.providerAddress,
      priceAtomic: BigInt(Math.trunc(job.price)).toString(),
    });
  }

  private assertReady(): AcpClientType {
    if (!this.client) {
      throw new Error("AcpVirtualsGateway.init() has not completed");
    }
    return this.client;
  }

  private assertSdk(): AcpSdk {
    if (!this.sdk) {
      throw new Error("AcpVirtualsGateway.init() has not completed");
    }
    return this.sdk;
  }
}
