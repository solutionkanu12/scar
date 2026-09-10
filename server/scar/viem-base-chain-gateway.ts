import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { BASE_SEPOLIA_CHAIN_ID, type BaseChainGateway } from "./base-execution";

interface ViemBaseChainGatewayOptions {
  /** Base Sepolia RPC endpoint. */
  rpcUrl: string;
  /**
   * Server-side signing key for the execution wallet. Read from the environment
   * at composition time and never forwarded to the adapter, logs, or clients.
   */
  privateKey: string;
  /** Confirmations to wait for before treating an outcome as final. */
  confirmations?: number;
  pollingIntervalMs?: number;
}

/**
 * Real {@link BaseChainGateway} backed by viem against Base Sepolia (84532).
 * This is the only place a signing key is held. It performs genuine
 * `eth_sendRawTransaction` broadcasts and reports the on-chain receipt status
 * verbatim; it never synthesises a success.
 */
export class ViemBaseChainGateway implements BaseChainGateway {
  readonly chainId = BASE_SEPOLIA_CHAIN_ID;
  readonly signerAddress: string | null;

  private readonly account: ReturnType<typeof privateKeyToAccount> | null;
  private readonly walletClient;
  private readonly publicClient;
  private readonly confirmations: number;

  constructor(options: ViemBaseChainGatewayOptions) {
    const key = normalizePrivateKey(options.privateKey);
    this.account = key ? privateKeyToAccount(key) : null;
    this.signerAddress = this.account?.address ?? null;
    this.confirmations = Math.max(1, options.confirmations ?? 1);

    const transport = http(options.rpcUrl, {
      timeout: 30_000,
      retryCount: 2,
    });
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport,
      pollingInterval: options.pollingIntervalMs ?? 2_000,
    });
    this.walletClient = this.account
      ? createWalletClient({
          account: this.account,
          chain: baseSepolia,
          transport,
        })
      : null;
  }

  async transferErc20(input: {
    tokenAddress: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: bigint;
  }): Promise<{ transactionHash: `0x${string}` }> {
    if (!this.walletClient || !this.account) {
      throw new Error("Base signer is not configured");
    }

    const remoteChainId = await this.publicClient.getChainId();
    if (remoteChainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new Error(
        `Base RPC reported chain ${remoteChainId}, expected ${BASE_SEPOLIA_CHAIN_ID}`,
      );
    }

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: input.tokenAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [input.recipient, input.amountAtomic],
    });

    const transactionHash = await this.walletClient.writeContract(request);
    return { transactionHash };
  }

  async waitForOutcome(transactionHash: `0x${string}`): Promise<{
    status: "CONFIRMED" | "REVERTED";
    blockNumber: bigint;
  }> {
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: this.confirmations,
      timeout: 120_000,
    });
    return {
      status: receipt.status === "success" ? "CONFIRMED" : "REVERTED",
      blockNumber: receipt.blockNumber,
    };
  }
}

function normalizePrivateKey(value: string | undefined): Hex | null {
  if (!value) return null;
  const trimmed = value.trim();
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return /^0x[0-9a-fA-F]{64}$/.test(prefixed) ? (prefixed as Hex) : null;
}
