# Scar Virtuals ACP integration

Scar's Virtuals integration uses the **Agent Commerce Protocol (ACP)**, the
Virtuals-native commerce layer. It is the smallest real Virtuals-native path
that genuinely qualifies: the logical Treasury Agent acts as the ACP
buyer/client and the logical Procurement Agent acts as the ACP provider/seller
for one procurement job. No extra agents and no marketplace functionality are
created.

## Where the code lives

| File | Role |
| --- | --- |
| `server/scar/virtuals-acp.ts` | Typed `VirtualsAcpGateway` port, `AcpSettlementAdapter` (an `ExecutionAdapter`), and `VirtualsProcurementBridge`. Pure, fully unit-tested. |
| `server/scar/acp-virtuals-gateway.ts` | Real gateway over the official `@virtuals-protocol/acp-node` SDK against the Base Sepolia ACP sandbox (`baseSepoliaAcpConfig`, chain id 84532). |
| `test/backend/virtuals-acp.test.ts` | Deterministic unit proof of the authorization boundary. |
| `test/backend/virtuals-acp.integration.test.ts` | Real sandbox proof, skipped unless credentials are present. `npm run test:virtuals`. |

The `@virtuals-protocol/acp-node` SDK is a **devDependency**. Nothing in `app/`
or the production Worker bundle imports it; only the real gateway and the gated
integration test do. This mirrors how the official Sibyl client is quarantined
behind the Python sidecar.

## Authorization boundary

The ACP settlement (`payAndAcceptRequirement`) is the single real on-chain
action. `VirtualsProcurementBridge` never lets it happen outside Scar's
executor boundary:

```
ACP job initiated
  -> DeterministicActionGate.authorize({ actionId })
       BLOCK   -> payJob is never called; recorded as BLOCKED_BY_SCAR
       REVIEW  -> payJob is not called without an exact scoped approval
       ALLOW   -> ExecutionBoundary.execute(...) with AcpSettlementAdapter
                  -> adapter calls acp.payJob(jobId) once (atomic claim)
                  -> recorded as SETTLED with the settlement reference
```

The gateway holds only the whitelisted ACP signer. It has no authorization or
execution capability.

## Human setup required before `npm run test:virtuals` can pass

Sibyl-style acceptance: the integration test is skipped until every variable
below is set. The Virtuals platform requires manual registration; it cannot be
automated from this repo.

1. Register two agents at <https://app.virtuals.io/acp> — a **buyer** (Treasury)
   and a **seller** (Procurement). Give the seller at least one offering so it
   is discoverable by `browseAgents`.
2. Create the smart wallet and whitelist a development wallet
   (<https://whitepaper.virtuals.io/acp-product-resources/acp-dev-onboarding-guide/set-up-agent-profile/initialize-and-whitelist-wallet>).
3. Fund the buyer agent with Base Sepolia test USDC. Set the seller offering
   price to the smallest testable amount (for example `0.01` USDC). Gas is
   sponsored on the sandbox.

| Variable | Purpose |
| --- | --- |
| `SCAR_VIRTUALS_ACP_PRIVATE_KEY` | Whitelisted dev wallet private key, `0x`-prefixed. Server-side only. |
| `SCAR_VIRTUALS_ACP_ENTITY_ID` | Numeric session entity id from the registry. |
| `SCAR_VIRTUALS_BUYER_ADDRESS` | Treasury (buyer) agent smart-wallet address. |
| `SCAR_VIRTUALS_SELLER_ADDRESS` | Procurement (seller) agent smart-wallet address. |
| `SCAR_VIRTUALS_BUYER_ENTITY_ID` | Buyer registry entity id (recorded as evidence). |
| `SCAR_VIRTUALS_SELLER_ENTITY_ID` | Seller registry entity id (recorded as evidence). |
| `SCAR_VIRTUALS_SERVICE_QUERY` | Optional. Keyword used to discover the seller offering. |

The ACP settlement is the only on-chain action and its gas is sponsored on the
sandbox, so no separate Base signing key is needed for this proof.

## Evidence recorded for the README / demo

Each run appends a `VirtualsInteractionRecord`:
`acpJobId`, buyer/seller wallet addresses and registry entity ids, ACP phase
transitions, `scarActionId`, `scarAuthorizationId`, `scarDecision`, the ACP
settlement reference, and the outcome
(`SETTLED` / `BLOCKED_BY_SCAR` / `REVIEW_REQUIRED` / `SETTLEMENT_REJECTED` / ...).
