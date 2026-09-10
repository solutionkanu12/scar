import { describe, expect, it } from "vitest";

import { DeterministicActionGate } from "@/server/scar/action-gate";
import { AcpVirtualsGateway } from "@/server/scar/acp-virtuals-gateway";
import type { FreshSessionMemoryReader } from "@/server/scar/fresh-session-retrieval";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";
import {
  VirtualsProcurementBridge,
  type VirtualsInteractionRecord,
} from "@/server/scar/virtuals-acp";

/**
 * Real Virtuals ACP integration proof against the Base Sepolia ACP sandbox.
 *
 * Skipped unless the ACP sandbox credentials are present. Run with
 * `npm run test:virtuals`. Requires human registration at
 * https://app.virtuals.io/acp (see `services/virtuals/README.md`):
 *
 * - `SCAR_VIRTUALS_ACP_PRIVATE_KEY`   whitelisted dev wallet key (0x-prefixed)
 * - `SCAR_VIRTUALS_ACP_ENTITY_ID`     numeric session entity id
 * - `SCAR_VIRTUALS_BUYER_ADDRESS`     Treasury (buyer) agent smart-wallet
 * - `SCAR_VIRTUALS_SELLER_ADDRESS`    Procurement (seller) agent smart-wallet
 * - `SCAR_VIRTUALS_BUYER_ENTITY_ID`   buyer registry entity id
 * - `SCAR_VIRTUALS_SELLER_ENTITY_ID`  seller registry entity id
 *
 * The ACP settlement (`payAndAcceptRequirement`, sponsored gas + funded buyer
 * USDC) is the single real on-chain action; no separate Base key is needed.
 */

const required = [
  "SCAR_VIRTUALS_ACP_PRIVATE_KEY",
  "SCAR_VIRTUALS_ACP_ENTITY_ID",
  "SCAR_VIRTUALS_BUYER_ADDRESS",
  "SCAR_VIRTUALS_SELLER_ADDRESS",
  "SCAR_VIRTUALS_BUYER_ENTITY_ID",
  "SCAR_VIRTUALS_SELLER_ENTITY_ID",
];
const ready = required.every((name) => Boolean(process.env[name]));
const integration = ready ? describe : describe.skip;

const usdcAddress =
  process.env.SCAR_BASE_USDC_ADDRESS ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function cleanMemory(): FreshSessionMemoryReader {
  return {
    async findRelevantEvidence() {
      return {
        status: "AVAILABLE",
        lookupId: "lookup-clean-virtuals",
        entity: {
          id: "supplier-alpha",
          name: "Supplier Alpha",
          externalIdentifier: "supplier-alpha.example",
          type: "COUNTERPARTY",
          createdAt: "2026-09-10T08:00:00.000Z",
        },
        incidents: [],
        safeguards: [],
      };
    },
  };
}

integration("real Virtuals ACP procurement job", () => {
  it("initiates a sandbox job and settles it only after Scar returns ALLOW", async () => {
    const acp = new AcpVirtualsGateway({
      whitelistedWalletPrivateKey: process.env
        .SCAR_VIRTUALS_ACP_PRIVATE_KEY as string,
      sessionEntityKeyId: Number(process.env.SCAR_VIRTUALS_ACP_ENTITY_ID),
      buyerAgentWalletAddress: process.env.SCAR_VIRTUALS_BUYER_ADDRESS as string,
      sellerAgentWalletAddress: process.env
        .SCAR_VIRTUALS_SELLER_ADDRESS as string,
      buyerEntityId: process.env.SCAR_VIRTUALS_BUYER_ENTITY_ID as string,
      sellerEntityId: process.env.SCAR_VIRTUALS_SELLER_ENTITY_ID as string,
      priceTokenAddress: usdcAddress,
    });
    await acp.init();

    const repository = new VolatileScarRepository();
    await repository.saveAgent({
      id: "agent-procurement",
      name: "Procurement Agent",
      role: "Pays suppliers and services",
      status: "ACTIVE",
      permissions: ["USDC_TRANSFER"],
    });
    await repository.saveAction({
      id: "action-virtuals-proof-001",
      agentId: "agent-procurement",
      actionType: "USDC_TRANSFER",
      amountAtomic: "10000",
      entityId: "supplier-alpha",
      recipient: process.env.SCAR_VIRTUALS_SELLER_ADDRESS as string,
      chainId: 84532,
      proposedAt: new Date().toISOString(),
    });

    const gate = new DeterministicActionGate({
      repository,
      memory: cleanMemory(),
      policy: {
        policyVersion: "scar-policy-v1",
        maxAmountAtomic: "1000000",
        reviewAmountAtomic: "500000",
        allowedChainIds: [84532],
      },
      now: () => new Date().toISOString(),
      createAuthorizationId: () => "authorization-virtuals-proof-001",
    });

    const records: VirtualsInteractionRecord[] = [];
    const bridge = new VirtualsProcurementBridge({
      repository,
      gate,
      acp,
      constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
      recordInteraction: (record) => {
        records.push(record);
      },
    });

    const result = await bridge.runProcurement({
      actionId: "action-virtuals-proof-001",
      serviceQuery:
        process.env.SCAR_VIRTUALS_SERVICE_QUERY ?? "procurement settlement",
      requirement: { supplier: "Supplier Alpha", note: "Scar ACP proof" },
      priceAtomic: "10000",
    });

    expect(result.job?.jobId).toBeTruthy();
    expect(result.decision.decision).toBe("ALLOW");
    expect(result.outcome).toBe("SETTLED");
    expect(records[0]).toMatchObject({
      scarDecision: "ALLOW",
      outcome: "SETTLED",
      buyer: { role: "TREASURY_BUYER" },
      seller: { role: "PROCUREMENT_SELLER" },
    });
    expect(records[0]?.settlementReference).toBeTruthy();

    console.log(
      `Virtuals ACP proof: job ${records[0]?.acpJobId}, phases ${records[0]?.phases.join(" -> ")}, settlement ${records[0]?.settlementReference}`,
    );
  }, 300_000);
});
