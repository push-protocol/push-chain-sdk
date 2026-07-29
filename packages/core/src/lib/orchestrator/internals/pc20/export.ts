/**
 * Push-to-external PC20 export.
 *
 * Three things differ from the PRC20 outbound path, and all three are
 * load-bearing:
 *
 *   1. The payload carries the `PC20` selector plus the destination wrapper's
 *      metadata. The SDK builds this — unlike inbound, where the external
 *      gateway prepends the selector.
 *   2. The gas quote comes from `getPC20ExportGasAndFees`, not
 *      `getOutboundTxGasAndFees`. Only the former knows about the first-export
 *      deployment overhead.
 *   3. The source token IS approved to UGPC. This is the mirror image of
 *      inbound: an export locks the Push-native token into VaultPC20, so the
 *      gateway must be able to pull it.
 */

import {
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  http,
  type Hex,
} from 'viem';
import { CHAIN } from '../../../constants/enums';
import {
  UNIVERSAL_CORE_EVM,
  PC20_FACTORY_EVM,
  VAULT_PC20_FACTORY_EVM,
} from '../../../constants/abi';
import { CHAIN_INFO, VAULT_ADDRESSES } from '../../../constants/chain';
import type { OrchestratorContext } from '../context';
import { printLog } from '../context';
import { chainToNamespace, vmForChain } from './chain-namespace';
import {
  getUniversalCoreAddress,
  getRegisteredWrapper,
  type PC20ResolverOptions,
  type ResolvedPC20,
} from './resolver';
import { pc20Bytes32ToAddress, isZeroBytes32 } from './address-codec';
import {
  UnsupportedPC20DestinationError,
  PC20WrapperPredictionUnavailableError,
  InvalidPC20MetadataError,
} from './errors';

/** `bytes4(ascii("PC20"))`. Must match the chain's PC20 route selector. */
export const PC20_SELECTOR = '0x50433230' as const;

/**
 * Factory limits on the metadata forwarded to the destination.
 *
 * Mirrors `PC20Factory.MAX_NAME_LENGTH` / `MAX_SYMBOL_LENGTH`. Pinned by test
 * against the reference contract revision — exceeding them reverts on the
 * destination chain, long after the source token has been locked, so the SDK
 * fails fast on the Push side instead.
 */
export const MAX_PC20_NAME_BYTES = 64;
export const MAX_PC20_SYMBOL_BYTES = 32;

/**
 * Build the outbound payload:
 *
 *     PC20_SELECTOR
 *       || abi.encode(destChainNamespace, name, symbol, decimals)
 *       || rawDestinationUserData
 *
 * The user data is appended raw, not ABI-encoded into the tuple — the
 * destination settlement path strips the fixed-width prefix and forwards the
 * remainder verbatim.
 */
export function buildPC20ExportPayload(params: {
  destinationChain: CHAIN;
  name: string;
  symbol: string;
  decimals: number;
  destinationUserData?: Hex;
}): Hex {
  const namespace = chainToNamespace(params.destinationChain);
  assertMetadataFitsFactoryLimits(params.name, params.symbol);

  const metadata = encodeAbiParameters(
    [
      { name: 'destChainNamespace', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'decimals', type: 'uint8' },
    ],
    [namespace, params.name, params.symbol, params.decimals]
  );

  const userData = params.destinationUserData ?? '0x';
  return encodePacked(
    ['bytes4', 'bytes', 'bytes'],
    [PC20_SELECTOR, metadata, userData]
  );
}

/**
 * Reject metadata the destination factory would refuse.
 *
 * Byte length, not character count — a multi-byte symbol can pass a `.length`
 * check and still revert on chain.
 */
export function assertMetadataFitsFactoryLimits(
  name: string,
  symbol: string
): void {
  const nameBytes = new TextEncoder().encode(name).length;
  const symbolBytes = new TextEncoder().encode(symbol).length;

  if (nameBytes === 0 || symbolBytes === 0) {
    throw new InvalidPC20MetadataError('PC20 name and symbol must be non-empty.');
  }
  if (nameBytes > MAX_PC20_NAME_BYTES) {
    throw new InvalidPC20MetadataError(
      `PC20 name is ${nameBytes} bytes; the destination factory allows ${MAX_PC20_NAME_BYTES}.`
    );
  }
  if (symbolBytes > MAX_PC20_SYMBOL_BYTES) {
    throw new InvalidPC20MetadataError(
      `PC20 symbol is ${symbolBytes} bytes; the destination factory allows ${MAX_PC20_SYMBOL_BYTES}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Gas quote
// ---------------------------------------------------------------------------

export type PC20GasQuote = {
  gasToken: `0x${string}`;
  gasFee: bigint;
  protocolFee: bigint;
  gasPrice: bigint;
  chainNamespace: string;
  gasLimitUsed: bigint;
  isFirstExport: boolean;
  /**
   * `gasLimitUsed` plus a deployment-overhead margin — see
   * {@link quotePC20Export} for why the margin is unconditional.
   */
  gasLimitCeiling: bigint;
};

/**
 * Quote a PC20 export.
 *
 * ## Why the deployment margin is unconditional
 *
 * `isFirstExport` is read before the transaction is included, so it is a
 * time-of-check/time-of-use value. Two things can happen in between:
 *
 *   - quoted `true`, another export deploys the wrapper first → the quote
 *     over-funds. Harmless.
 *   - quoted `false`, the wrapper turns out to be absent at execution (registry
 *     rollback, factory reconfiguration, reorg) → the quote under-funds by
 *     `pc20DeploymentGasOverhead` and the transfer strands on the destination
 *     with the source token already locked.
 *
 * The second is unrecoverable without operator intervention, so the ceiling
 * always covers a deployment. `maxPCForGas` is a ceiling rather than a charge —
 * the unspent remainder is not consumed — so the only cost is a higher required
 * balance. `gasLimitUsed` itself is passed through unchanged.
 */
export async function quotePC20Export(
  ctx: OrchestratorContext,
  pushPC20: `0x${string}`,
  destinationChain: CHAIN,
  gasLimit: bigint,
  opts: PC20ResolverOptions
): Promise<PC20GasQuote> {
  const namespace = chainToNamespace(destinationChain);
  const core = await getUniversalCoreAddress(opts);

  const result = await ctx.pushClient.readContract<
    [`0x${string}`, bigint, bigint, bigint, string, bigint, boolean]
  >({
    address: core,
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'getPC20ExportGasAndFees',
    args: [namespace, gasLimit, pushPC20],
  });

  const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace, gasLimitUsed, isFirstExport] =
    result;

  const overhead = await ctx.pushClient.readContract<bigint>({
    address: core,
    abi: UNIVERSAL_CORE_EVM,
    functionName: 'pc20DeploymentGasOverhead',
    args: [namespace],
  });

  // Add the overhead even when the quote already included it. Double-counting
  // raises a ceiling that is never fully spent; under-counting strands funds.
  const gasLimitCeiling = gasLimitUsed + overhead;

  printLog(
    ctx,
    `quotePC20Export — namespace=${chainNamespace}, gasLimitUsed=${gasLimitUsed}, ` +
      `isFirstExport=${isFirstExport}, overhead=${overhead}, ceiling=${gasLimitCeiling}`
  );

  return {
    gasToken,
    gasFee,
    protocolFee,
    gasPrice,
    chainNamespace,
    gasLimitUsed,
    isFirstExport,
    gasLimitCeiling,
  };
}

/**
 * PC20 quote adapted to the shape `queryOutboundGasFee` returns, so the shared
 * R2 gas-sizing code downstream is untouched.
 *
 * `nativeValueForGas` and `sizing` are intentionally absent — the caller's
 * native-PC swap sizing consumes `gasFee`/`protocolFee`/`gasPrice` the same way
 * it does for PRC20. What differs is only where the numbers came from.
 */
export async function queryPC20OutboundGasFee(
  ctx: OrchestratorContext,
  pushPC20: `0x${string}`,
  gasLimit: bigint,
  destinationChain: CHAIN
): Promise<{
  gasToken: `0x${string}`;
  gasFee: bigint;
  protocolFee: bigint;
  gasPrice: bigint;
  gasLimitUsed: bigint;
  universalCoreAddress: `0x${string}`;
  isFirstExport: boolean;
  gasLimitCeiling: bigint;
  /**
   * Always zero. Present only for shape-compatibility with
   * `queryOutboundGasFee` — both the EVM and SVM callers size the actual
   * native value themselves (estimateNativeValueForSwap) from gasFee, and
   * never consume this field from the quote.
   */
  nativeValueForGas: bigint;
}> {
  const opts: PC20ResolverOptions = {
    network: ctx.pushNetwork,
    rpcUrls: ctx.rpcUrls as Partial<Record<CHAIN, string[]>>,
  };
  const quote = await quotePC20Export(ctx, pushPC20, destinationChain, gasLimit, opts);
  const universalCoreAddress = await getUniversalCoreAddress(opts);

  return {
    gasToken: quote.gasToken,
    gasFee: quote.gasFee,
    protocolFee: quote.protocolFee,
    gasPrice: quote.gasPrice,
    gasLimitUsed: quote.gasLimitUsed,
    universalCoreAddress,
    isFirstExport: quote.isFirstExport,
    gasLimitCeiling: quote.gasLimitCeiling,
    nativeValueForGas: BigInt(0),
  };
}

// ---------------------------------------------------------------------------
// Destination wrapper resolution
// ---------------------------------------------------------------------------

export type DestinationWrapper = {
  /** Chain-native address of the wrapper on the destination chain. */
  address: string;
  /** False when this address is a prediction for a not-yet-deployed wrapper. */
  deployed: boolean;
};

/**
 * Resolve the wrapper address the destination transfer should target.
 *
 * For a repeat export this is the registered wrapper. For a first export the
 * wrapper does not exist yet, but the destination settlement mints into the CEA
 * and then executes user data — so the SDK still needs the address in order to
 * build the transfer that delivers funds to the actual recipient.
 *
 * ## Funds-at-risk ordering
 *
 * This must run BEFORE the source-token approval. By the time the outbound is
 * submitted the token is locked in VaultPC20; a wrapper address that turns out
 * to be wrong then means a transfer to a dead address with no way back except
 * the revert path. Every failure here therefore throws rather than falling back
 * to a guess.
 *
 * The prediction is read from the live factory's own `computeWrapperAddress`,
 * which derives from its own `type(PC20Wrapper).creationCode`. That is why the
 * SDK does not mirror the CREATE2 derivation locally: a mirrored init-code hash
 * can drift from the deployed bytecode, while asking the factory cannot.
 *
 * ## Which factory to ask
 *
 * Two contracts hold a `pc20Factory` pointer, and they are not the same slot:
 *
 *   - `UniversalCore.pc20FactoryByChain(ns)` on Push — the protocol's registry
 *     mirror, and the value Tier B cross-checks against.
 *   - `Vault.pc20Factory()` on the destination chain — the contract that
 *     actually calls `deployWrapper` at settlement (`Vault.sol:327`).
 *
 * The Vault is therefore the authoritative answer to "where will the wrapper
 * land"; the registry copy can go stale without settlement noticing. The
 * registry is preferred when available so the two stay cross-checked, with the
 * Vault as fallback — which also keeps first exports working while
 * `pc20FactoryByChain` is missing from the deployed UniversalCore.
 */
export async function resolveDestinationWrapper(
  ctx: OrchestratorContext,
  pushPC20: `0x${string}`,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<DestinationWrapper> {
  const namespace = chainToNamespace(destinationChain);

  const registered = await getRegisteredWrapper(pushPC20, destinationChain, opts);
  if (registered) {
    return { address: registered.address, deployed: true };
  }

  if (vmForChain(destinationChain) !== 'EVM') {
    // SVM: the wrapper is the deterministic `pc20_mint` PDA — a pure local
    // derivation, so unlike EVM there is no factory to consult and prediction
    // cannot drift from deployment (the program derives from the same seeds,
    // state.rs:13). `deployed` is decided by whether the mint account exists.
    return resolveSvmDestinationWrapper(pushPC20, destinationChain, opts);
  }

  // First export — predict from the live factory.
  const { factory, source } = await resolveDestinationFactory(
    ctx,
    destinationChain,
    opts
  );
  printLog(ctx, `resolveDestinationWrapper — factory ${factory} (via ${source})`);

  let predicted: string;
  try {
    predicted = await readPredictedWrapper(ctx, factory, pushPC20, destinationChain, opts);
  } catch (err) {
    throw new PC20WrapperPredictionUnavailableError({
      chain: String(destinationChain),
      address: factory,
      chainNamespace: namespace,
      hint:
        'The destination factory could not be reached to compute the wrapper ' +
        'address. Aborted before approval, so no funds are locked. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
    });
  }

  return { address: getAddress(predicted), deployed: false };
}

/**
 * SVM destination wrapper: the deterministic `pc20_mint` PDA.
 *
 * Derived locally from `[b"pc20_mint", source_asset_20]` under the gateway
 * program (mirrors `pc20.rs` / validated against the deployed devnet binary,
 * which contains the same seed strings). Existence of the mint account is what
 * distinguishes a repeat export from a first one — settlement creates the mint
 * idempotently either way, so a wrong `deployed` flag here costs gas headroom,
 * not funds.
 */
async function resolveSvmDestinationWrapper(
  pushPC20: `0x${string}`,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<DestinationWrapper> {
  const { PublicKey, Connection } = await import('@solana/web3.js');
  const { SVM_GATEWAY_IDL } = await import('../../../constants/abi');
  const { predictSvmWrapperMint } = await import('./svm');

  const programId = new PublicKey((SVM_GATEWAY_IDL as { address: string }).address);
  const mint = predictSvmWrapperMint(programId, pushPC20);

  const rpc =
    opts.rpcUrls?.[destinationChain]?.[0] ??
    CHAIN_INFO[destinationChain]?.defaultRPC?.[0];
  if (!rpc) {
    throw new UnsupportedPC20DestinationError({
      chain: String(destinationChain),
      hint: 'No RPC URL configured for this chain.',
    });
  }

  let deployed = false;
  try {
    const info = await new Connection(rpc).getAccountInfo(mint);
    deployed = info !== null;
  } catch (err) {
    // The PDA derivation is still valid; only the deployed flag is unknown.
    // Downstream decisions (gas headroom, whether recipient-ATA delivery is
    // even possible) hinge on that flag, so guessing is worse than aborting —
    // and this runs pre-approval, so aborting locks nothing.
    throw new PC20WrapperPredictionUnavailableError({
      chain: String(destinationChain),
      address: mint.toBase58(),
      hint:
        'Could not query the Solana RPC to check mint existence. Aborted ' +
        `before approval, so no funds are locked. (${err instanceof Error ? err.message : String(err)})`,
    });
  }

  return { address: mint.toBase58(), deployed };
}

/**
 * Find the factory that will deploy the destination wrapper.
 *
 * Prefers UniversalCore's registry so the value stays cross-checked against the
 * protocol's own view. Falls back to the destination `Vault.pc20Factory()` —
 * the contract that actually calls `deployWrapper` — when the registry has no
 * entry or does not expose the accessor at all.
 *
 * The fallback is not a guess. The Vault is strictly closer to the truth for
 * this question: settlement reads *its* pointer, so a wrapper predicted from it
 * cannot disagree with where the wrapper is deployed, whereas a stale registry
 * mirror can.
 */
async function resolveDestinationFactory(
  ctx: OrchestratorContext,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<{ factory: `0x${string}`; source: 'registry' | 'vault' }> {
  const namespace = chainToNamespace(destinationChain);

  const core = await getUniversalCoreAddress(opts);
  const factoryRaw = await ctx.pushClient
    .readContract<Hex>({
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'pc20FactoryByChain',
      args: [namespace],
    })
    .catch(() => undefined);

  if (factoryRaw && !isZeroBytes32(factoryRaw)) {
    return {
      factory: getAddress(pc20Bytes32ToAddress(destinationChain, factoryRaw)),
      source: 'registry',
    };
  }

  const vault = VAULT_ADDRESSES[destinationChain];
  if (!vault) {
    throw new UnsupportedPC20DestinationError({
      chain: String(destinationChain),
      chainNamespace: namespace,
      hint:
        'UniversalCore has no PC20 factory registered for this chain, and no ' +
        'Vault address is configured to fall back to.',
    });
  }

  const client = destinationClient(destinationChain, opts);
  const vaultFactory = (await client
    .readContract({
      address: getAddress(vault),
      abi: VAULT_PC20_FACTORY_EVM,
      functionName: 'pc20Factory',
      args: [],
    })
    .catch(() => undefined)) as `0x${string}` | undefined;

  if (!vaultFactory || vaultFactory === '0x0000000000000000000000000000000000000000') {
    throw new UnsupportedPC20DestinationError({
      chain: String(destinationChain),
      chainNamespace: namespace,
      hint: 'Neither UniversalCore nor the destination Vault has a PC20 factory set.',
    });
  }

  return { factory: getAddress(vaultFactory), source: 'vault' };
}

/** Public client for a destination chain, honouring `rpcUrls` overrides. */
function destinationClient(chain: CHAIN, opts: PC20ResolverOptions) {
  const rpc = opts.rpcUrls?.[chain]?.[0] ?? CHAIN_INFO[chain]?.defaultRPC?.[0];
  if (!rpc) {
    throw new UnsupportedPC20DestinationError({
      chain: String(chain),
      hint: 'No RPC URL configured for this chain.',
    });
  }
  return createPublicClient({ transport: http(rpc) });
}

async function readPredictedWrapper(
  ctx: OrchestratorContext,
  factory: `0x${string}`,
  pushPC20: `0x${string}`,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<string> {
  const { createPublicClient, http } = await import('viem');
  const rpc =
    opts.rpcUrls?.[destinationChain]?.[0] ??
    (await import('../../../constants/chain')).CHAIN_INFO[destinationChain]
      ?.defaultRPC?.[0];
  if (!rpc) {
    throw new Error(`No RPC configured for ${destinationChain}`);
  }

  const client = createPublicClient({ transport: http(rpc) });
  const predicted = (await client.readContract({
    address: factory,
    abi: PC20_FACTORY_EVM,
    functionName: 'computeWrapperAddress',
    args: [pushPC20],
  })) as `0x${string}`;

  if (!predicted || predicted === '0x0000000000000000000000000000000000000000') {
    throw new Error('factory returned the zero address');
  }
  printLog(ctx, `resolveDestinationWrapper — predicted wrapper ${predicted} via factory ${factory}`);
  return predicted;
}

// ---------------------------------------------------------------------------
// Validation entry point
// ---------------------------------------------------------------------------

/**
 * Everything that must hold before a PC20 export approves or broadcasts.
 *
 * Ordered so the cheapest, most likely failures come first and nothing that
 * touches funds runs until all of them pass.
 */
export async function validatePC20Export(
  ctx: OrchestratorContext,
  resolved: ResolvedPC20,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<{ wrapper: DestinationWrapper; namespace: string }> {
  const namespace = chainToNamespace(destinationChain);

  assertMetadataFitsFactoryLimits(resolved.name, resolved.symbol);

  // The destination factory is deliberately NOT read here. A repeat export
  // targets an already-registered wrapper and never needs it, so requiring it
  // up front would fail exports that are perfectly safe. Only the first-export
  // prediction path depends on the factory, and `resolveDestinationWrapper`
  // reads it there — where a failure correctly aborts before approval.
  const wrapper = await resolveDestinationWrapper(ctx, resolved.pushAddress, destinationChain, opts);
  return { wrapper, namespace };
}
