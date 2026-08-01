/**
 * Pure utility functions extracted from Orchestrator.
 *
 * These have minimal dependencies and are used across multiple submodules.
 */

import { Connection } from '@solana/web3.js';
import { CHAIN_INFO, VM_NAMESPACE, SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import { getOriginEvmClient } from './context';
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import type {
  ChainTarget,
  ExecuteParams,
  UniversalExecuteParams,
} from '../orchestrator.types';
import { EvmClient } from '../../vm-client/evm-client';
import type { OrchestratorContext } from './context';

/** Chains that support gateway operations (multicall, funds bridging, etc.) */
export const SUPPORTED_GATEWAY_CHAINS: CHAIN[] = [
  CHAIN.ETHEREUM_SEPOLIA,
  CHAIN.ARBITRUM_SEPOLIA,
  CHAIN.BASE_SEPOLIA,
  CHAIN.BNB_TESTNET,
  CHAIN.SOLANA_DEVNET,
];

// ============================================================================
// Chain Helpers
// ============================================================================

export function isPushChain(chain: CHAIN): boolean {
  return (
    chain === CHAIN.PUSH_MAINNET ||
    chain === CHAIN.PUSH_TESTNET_DONUT ||
    chain === CHAIN.PUSH_LOCALNET
  );
}

// `toExternalTxHashDisplay` moved to ../../utils/external-tx-hash so the
// detector module can use it without back-importing from orchestrator/internals
// (inbound-tracker.ts already imports universal-tx-detector — a back-import
// from detector would create a cross-layer tangle). Re-exported here so
// existing call sites (outbound-sync.ts / response-builder.ts / cascade.ts)
// keep their current import path unchanged.
export { toExternalTxHashDisplay } from '../../utils/external-tx-hash';

export function getPushChainForNetwork(pushNetwork: PUSH_NETWORK): CHAIN {
  if (pushNetwork === PUSH_NETWORK.MAINNET) {
    return CHAIN.PUSH_MAINNET;
  } else if (
    pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
    pushNetwork === PUSH_NETWORK.TESTNET
  ) {
    return CHAIN.PUSH_TESTNET_DONUT;
  } else {
    return CHAIN.PUSH_LOCALNET;
  }
}

export function getChainNamespace(chain: CHAIN): string {
  const { vm, chainId } = CHAIN_INFO[chain];
  const namespace = VM_NAMESPACE[vm];
  return `${namespace}:${chainId}`;
}

// Moved to ../../utils/external-tx-hash alongside `toExternalTxHashDisplay`
// so both the orchestrator and the detector module share one implementation.
export { chainFromNamespace } from '../../utils/external-tx-hash';

export function getNativePRC20ForChain(
  targetChain: CHAIN,
  pushNetwork: PUSH_NETWORK
): `0x${string}` {
  const synthetics = SYNTHETIC_PUSH_ERC20[pushNetwork];

  switch (targetChain) {
    case CHAIN.ETHEREUM_SEPOLIA:
    case CHAIN.ETHEREUM_MAINNET:
      return synthetics.pETH;
    case CHAIN.ARBITRUM_SEPOLIA:
      return synthetics.pETH_ARB;
    case CHAIN.BASE_SEPOLIA:
      return synthetics.pETH_BASE;
    case CHAIN.BNB_TESTNET:
      return synthetics.pBNB;
    case CHAIN.SOLANA_DEVNET:
    case CHAIN.SOLANA_TESTNET:
    case CHAIN.SOLANA_MAINNET:
      return synthetics.pSOL;
    default:
      throw new Error(
        `No native PRC-20 token mapping for chain ${targetChain}. ` +
          `Use 'funds' parameter to specify the token explicitly.`
      );
  }
}

// ============================================================================
// Address / Contract Helpers
// ============================================================================

export function getUniversalGatewayPCAddress(): `0x${string}` {
  // UniversalGatewayPC is a precompile at a fixed address on Push Chain
  return '0x00000000000000000000000000000000000000C1';
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that a feeLockTxHash is a well-formed transaction hash.
 * EVM: must be 0x-prefixed 64-hex-char string (66 chars total).
 * SVM (Base58): must be at least 32 chars.
 */
export function validateFeeLockTxHash(feeLockTxHash: string): void {
  if (feeLockTxHash.startsWith('0x')) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(feeLockTxHash)) {
      throw new Error(
        `Invalid feeLockTxHash: expected 0x-prefixed 64-character hex string, got "${feeLockTxHash}"`
      );
    }
  } else {
    if (feeLockTxHash.length < 32) {
      throw new Error(
        `Invalid feeLockTxHash: expected Base58 transaction hash (>=32 chars), got "${feeLockTxHash}"`
      );
    }
  }
}

export function validateMainnetConnection(
  chain: CHAIN,
  pushChainId: string
): void {
  const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
    chain
  );
  if (
    isMainnet &&
    pushChainId !== CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
  ) {
    throw new Error('Mainnet chains can only interact with Push Mainnet');
  }
}

// ============================================================================
// Serialization
// ============================================================================

export function bigintReplacer(_key: string, value: any): any {
  return typeof value === 'bigint' ? value.toString() : value;
}

// ============================================================================
// Params Conversion
// ============================================================================

export function toExecuteParams(params: UniversalExecuteParams): ExecuteParams {
  // Post-route-detector, ChainTarget.address has already been normalized to
  // 0x-prefixed hex for SVM targets (see route-detector.ts), so the cast is safe.
  const to =
    typeof params.to === 'string'
      ? params.to
      : ((params.to as ChainTarget).address as `0x${string}`);

  return {
    to,
    value: params.value,
    data: params.data,
    funds: params.funds,
    // Internal PC20 descriptor must survive param transformation — the payload
    // builders branch on it, and losing it here silently reroutes a resolved
    // PC20 through the static synthetic-token lookup (which throws).
    ...(('_pc20' in params)
      ? { _pc20: (params as { _pc20?: unknown })._pc20 }
      : {}),
    gasLimit: params.gasLimit,
    maxPCForGas: params.maxPCForGas,
    maxFeePerGas: params.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas,
    deadline: params.deadline,
    options: params.options,
    payGasWith: params.payGasWith,
    feeLockTxHash: params.feeLockTxHash,
  };
}

// ============================================================================
// Origin Chain Transaction for Progress
// ============================================================================

export async function fetchOriginChainTransactionForProgress(
  ctx: OrchestratorContext,
  chain: CHAIN,
  txHashHex: string,
  txHashDisplay: string
): Promise<object | undefined> {
  const { vm, defaultRPC } = CHAIN_INFO[chain];
  const rpcUrls = ctx.rpcUrls[chain] || defaultRPC;

  try {
    if (vm === VM.EVM) {
      if (!txHashHex.startsWith('0x')) {
        throw new Error('EVM transaction hash must be 0x-prefixed');
      }
      const evmClient = getOriginEvmClient(ctx);
      const tx = await evmClient.publicClient.getTransaction({
        hash: txHashHex as `0x${string}`,
      });
      return tx ?? undefined;
    }

    if (vm === VM.SVM) {
      const connection = new Connection(rpcUrls[0], 'confirmed');
      const tx = await connection.getTransaction(txHashDisplay, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      } as any);
      return tx ?? undefined;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
