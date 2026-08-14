/**
 * PC20 registry resolver — the one module that reads PC20 state.
 *
 * Used by `sendTransaction`, `prepareTransaction`, cascade construction,
 * `getPC20Address`, and the outbound tracking fallback.
 * Nothing else may read the registry directly; a second reader is how the
 * validation tiers and the cache policy drift apart.
 *
 * ## Read budget
 *
 * Validation is tiered so a send does not pay for the full identity sweep:
 *
 *   Tier A (every send)  — `getPC20Source` then `getPC20Wrapper`. Forward and
 *                          reverse agreement proves the address is registered
 *                          for that exact namespace, which is what defeats a
 *                          wrapper address copied onto the wrong chain.
 *   Tier B (prepare-time, first use per session, or strict mode) — live gateway
 *                          factory identity, `isPC20Wrapper`, `wrapperToSource`,
 *                          `SOURCE_ASSET`, deployed bytecode. Largely redundant
 *                          once Tier A holds, but it is what catches a
 *                          misconfigured deployment where the gateway would not
 *                          take the PC20 burn path at all.
 *
 * Each tier is one multicall against one chain. Budget: at most 2 sequential
 * round trips warm, 4 cold. `__readCount` exists so tests can assert that.
 *
 * ## Cache policy
 *
 * Positive results are cached for the client's lifetime, keyed by
 * `(pushNetwork, chain, address)`. Registered mappings are immutable in
 * practice — a factory reconfiguration is a redeploy-level event.
 *
 * Negative results are NEVER cached. The first successful export creates a
 * mapping that did not previously exist, and a cached "not registered" would
 * make the SDK permanently wrong about a token that now works.
 */

import {
  createPublicClient,
  http,
  getAddress,
  type Hex,
  type PublicClient,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../../../constants/enums';
import {
  CHAIN_INFO,
  UNIVERSAL_GATEWAY_ADDRESSES,
  VAULT_ADDRESSES,
} from '../../../constants/chain';
import {
  UNIVERSAL_CORE_EVM,
  UNIVERSAL_GATEWAY_PC,
  ERC20_EVM,
  PC20_FACTORY_EVM,
  PC20_WRAPPER_EVM,
  EXTERNAL_GATEWAY_PC20_EVM,
  VAULT_PC20_FACTORY_EVM,
} from '../../../constants/abi';
import { getPushChainForNetwork, getUniversalGatewayPCAddress } from '../helpers';
import {
  chainToNamespace,
  isPushChain,
  vmForChain,
  allExternalChains,
} from './chain-namespace';
import {
  pc20AddressToBytes32,
  pc20Bytes32ToAddress,
  isZeroBytes32,
} from './address-codec';
import {
  InvalidPC20MetadataError,
  PC20AmbiguousAddressError,
  PC20ExpectedButPRC20Error,
  PC20FactoryMismatchError,
  PC20RegistryMismatchError,
  PC20WrapperNotRegisteredError,
  UnsupportedPC20DestinationError,
} from './errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Standard ERC-20 metadata forwarded when exporting a Push-native PC20. */
export type PC20Metadata = {
  name: string;
  symbol: string;
  decimals: number;
};

/** A confirmed wrapper deployment on one external chain. */
export type PC20DeploymentInfo = {
  chain: CHAIN;
  chainNamespace: string;
  vm: VM;
  /** Chain-native form: checksummed hex (EVM) or base58 (SVM). */
  address: string;
  /** Registry form, as stored in UniversalCore. */
  rawAddress: Hex;
};

/** Everything the execution path needs about a resolved funds token. */
export type ResolvedPC20 = {
  direction: 'import' | 'export';
  /** Chain the token the caller named lives on. */
  originChain: CHAIN;
  /** Chain-native address of the token the caller named. */
  originAddress: string;
  /** Canonical Push-native PC20. */
  pushAddress: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  /** External wrapper, when one is registered. Absent before a first export. */
  wrapperAddress?: string;
  /** Namespace of the external side (origin for import, destination for export). */
  chainNamespace?: string;
};

export type PC20ResolverOptions = {
  network: PUSH_NETWORK;
  /** Per-chain RPC overrides. Falls back to `CHAIN_INFO[chain].defaultRPC`. */
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  /** Run Tier B factory-identity checks even on a warm path. */
  strict?: boolean;
  /** Re-read the wrapper/source registry even when a positive cache entry exists. */
  bypassCache?: boolean;
};

// ---------------------------------------------------------------------------
// Client plumbing
// ---------------------------------------------------------------------------

/**
 * Instrumentation for the round-trip budget assertion. Incremented once per
 * network round trip (a batch counts as one, which is the whole point).
 */
export const __readCount = { n: 0 };

const clientCache = new Map<string, PublicClient>();

/**
 * Why JSON-RPC batching rather than Multicall3.
 *
 * Every PC20 registry read targets UniversalCore on Push Chain, so batching is
 * what keeps `getPC20Address` at one round trip instead of one per chain. The
 * obvious tool is `client.multicall()` — but **Multicall3 is not deployed on
 * Push Chain**, so that path fails outright with "multicallAddress is
 * required". Verified against Donut: no code at
 * `0xcA11bde05977b3631167028862bE2a173976CA11`.
 *
 * viem's transport-level `batch` option achieves the same thing a layer lower:
 * concurrent `eth_call`s issued in the same tick are coalesced into a single
 * JSON-RPC batch request over one HTTP round trip. No contract required, and it
 * works identically on chains that do have Multicall3.
 */
const BATCH_TRANSPORT_OPTS = { batch: { wait: 0 } } as const;

function rpcFor(chain: CHAIN, opts: PC20ResolverOptions): string {
  const override = opts.rpcUrls?.[chain]?.[0];
  const fallback = CHAIN_INFO[chain]?.defaultRPC?.[0];
  const url = override ?? fallback;
  if (!url) {
    throw new UnsupportedPC20DestinationError({
      chain: String(chain),
      hint: 'No RPC URL configured for this chain. Pass one via `rpcUrls`.',
    });
  }
  return url;
}

function clientFor(chain: CHAIN, opts: PC20ResolverOptions): PublicClient {
  const url = rpcFor(chain, opts);
  const key = `${chain}:${url}`;
  let client = clientCache.get(key);
  if (!client) {
    client = createPublicClient({
      transport: http(url, BATCH_TRANSPORT_OPTS),
    }) as PublicClient;
    clientCache.set(key, client);
  }
  return client;
}

/**
 * Read several contract calls in one network round trip.
 *
 * Individual `readContract` calls issued together in the same tick are coalesced
 * by the batching transport (see {@link BATCH_TRANSPORT_OPTS}). `Promise.all`
 * dispatches them synchronously, which is what puts them in the same batch
 * window — awaiting them one at a time would silently become N round trips.
 *
 * Failures are captured per call rather than thrown, because optional identity
 * probes such as `CHAIN_NAMESPACE()` are expected to revert on ordinary ERC-20s.
 * Callers interpret each result individually via {@link unwrap}.
 */
async function batchRead(
  client: PublicClient,
  contracts: readonly unknown[]
): Promise<Array<{ status: 'success' | 'failure'; result?: unknown; error?: unknown }>> {
  __readCount.n += 1;
  return Promise.all(
    contracts.map((c) =>
      client
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .readContract(c as any)
        .then((result) => ({ status: 'success' as const, result }))
        .catch((error) => ({ status: 'failure' as const, error }))
    )
  );
}

function unwrap<T>(
  entry: { status: 'success' | 'failure'; result?: unknown } | undefined
): T | undefined {
  return entry?.status === 'success' ? (entry.result as T) : undefined;
}

// ---------------------------------------------------------------------------
// UniversalCore address
// ---------------------------------------------------------------------------

const universalCoreCache = new Map<PUSH_NETWORK, `0x${string}`>();

/**
 * Resolve UniversalCore through the UGPC precompile, matching how
 * `gas-calculator.queryOutboundGasFee` does it. Cached per network — the
 * precompile's `universalCore` pointer does not move within a session.
 */
export async function getUniversalCoreAddress(
  opts: PC20ResolverOptions
): Promise<`0x${string}`> {
  const cached = universalCoreCache.get(opts.network);
  if (cached) return cached;

  const pushChain = getPushChainForNetwork(opts.network);
  const client = clientFor(pushChain, opts);
  __readCount.n += 1;
  const address = (await client.readContract({
    address: getUniversalGatewayPCAddress(),
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'universalCore',
    args: [],
  })) as `0x${string}`;

  universalCoreCache.set(opts.network, address);
  return address;
}

// ---------------------------------------------------------------------------
// Positive-only caches
// ---------------------------------------------------------------------------

/** wrapper → Push source. Positive entries only; see the cache policy above. */
const wrapperToSourceCache = new Map<string, `0x${string}`>();
/** Push token → validated metadata. Positive entries only. */
const metadataCache = new Map<string, PC20Metadata>();
/** `(network, chain, address)` pairs that have passed Tier B this session. */
const tierBVerified = new Set<string>();

const cacheKey = (network: PUSH_NETWORK, chain: CHAIN, address: string) =>
  `${network}:${chain}:${address.toLowerCase()}`;

/** Test seam. Never call from product code — it would drop verified Tier B state. */
export function __clearPC20Caches(): void {
  wrapperToSourceCache.clear();
  metadataCache.clear();
  tierBVerified.clear();
  universalCoreCache.clear();
  clientCache.clear();
  __readCount.n = 0;
}

// ---------------------------------------------------------------------------
// Tier A — registry forward/reverse agreement
// ---------------------------------------------------------------------------

/**
 * Resolve an external wrapper to its canonical Push-native source.
 *
 * One multicall: `getPC20Source(wrapper, ns)` and, in the same batch, the
 * reverse `getPC20Wrapper` cannot be issued because it depends on the source.
 * The reverse read is therefore a second round trip — this is the "2 sequential
 * round trips" in the budget, and it is not collapsible: the registry has no
 * combined accessor.
 *
 * @throws {PC20WrapperNotRegisteredError} when the wrapper is unknown.
 * @throws {PC20RegistryMismatchError} when forward and reverse disagree.
 */
export async function resolveWrapperToSource(
  chain: CHAIN,
  address: string,
  opts: PC20ResolverOptions
): Promise<{ pushAddress: `0x${string}`; chainNamespace: string; rawWrapper: Hex }> {
  const namespace = chainToNamespace(chain);
  const rawWrapper = pc20AddressToBytes32(chain, address);
  const key = cacheKey(opts.network, chain, address);

  const cached = wrapperToSourceCache.get(key);
  if (cached && !opts.bypassCache) {
    return { pushAddress: cached, chainNamespace: namespace, rawWrapper };
  }

  const core = await getUniversalCoreAddress(opts);
  const pushClient = clientFor(getPushChainForNetwork(opts.network), opts);

  const [sourceEntry] = await batchRead(pushClient, [
    {
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getPC20Source',
      args: [rawWrapper, namespace],
    },
  ]);

  const source = unwrap<[`0x${string}`, boolean]>(sourceEntry);
  if (!source || !source[1] || source[0] === '0x0000000000000000000000000000000000000000') {
    throw new PC20WrapperNotRegisteredError({
      chain: String(chain),
      address,
      chainNamespace: namespace,
    });
  }
  const pushAddress = getAddress(source[0]) as `0x${string}`;

  // Reverse check. A stale or half-written entry would otherwise unlock the
  // wrong Push token on burn.
  const [wrapperEntry] = await batchRead(pushClient, [
    {
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getPC20Wrapper',
      args: [pushAddress, namespace],
    },
  ]);
  const reverse = unwrap<[Hex, boolean]>(wrapperEntry);
  if (!reverse || isZeroBytes32(reverse[0]) || reverse[0].toLowerCase() !== rawWrapper.toLowerCase()) {
    throw new PC20RegistryMismatchError({
      chain: String(chain),
      address,
      chainNamespace: namespace,
      resolvedWrapper: reverse && !isZeroBytes32(reverse[0])
        ? pc20Bytes32ToAddress(chain, reverse[0])
        : undefined,
    });
  }

  wrapperToSourceCache.set(key, pushAddress);
  return { pushAddress, chainNamespace: namespace, rawWrapper };
}

// ---------------------------------------------------------------------------
// Tier B — live factory identity (EVM)
// ---------------------------------------------------------------------------

/**
 * Verify the live external gateway will actually take the PC20 burn path for
 * this wrapper, and that its factory is the one UniversalCore knows about.
 *
 * Two multicalls: the gateway's factory pointer must be read before the
 * factory-scoped calls can be addressed.
 *
 * @throws {PC20FactoryMismatchError} on any identity disagreement.
 */
export async function verifyEvmWrapperIdentity(
  chain: CHAIN,
  address: string,
  pushAddress: `0x${string}`,
  opts: PC20ResolverOptions
): Promise<void> {
  const key = cacheKey(opts.network, chain, address);
  if (!opts.strict && tierBVerified.has(key)) return;

  const namespace = chainToNamespace(chain);
  const gateway = UNIVERSAL_GATEWAY_ADDRESSES[chain];
  if (!gateway) {
    throw new UnsupportedPC20DestinationError({
      chain: String(chain),
      chainNamespace: namespace,
      hint: 'No universal gateway address is configured for this chain.',
    });
  }

  const core = await getUniversalCoreAddress(opts);
  const pushClient = clientFor(getPushChainForNetwork(opts.network), opts);
  const extClient = clientFor(chain, opts);

  // Reference factory to compare the gateway against. The deployed
  // UniversalCore does not expose `pc20FactoryByChain` (chain-team decision:
  // the token mappings are the supported registry surface), so the standing
  // reference is the destination Vault's own pointer — the Vault is what
  // deploys and mints wrappers (`Vault.sol:327`), so gateway-vs-Vault
  // agreement is the identity that actually matters at settlement. The
  // registry read stays first, failure-tolerant, for forward compatibility
  // should a future upgrade add the accessor.
  const [registryFactoryEntry] = await batchRead(pushClient, [
    {
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'pc20FactoryByChain',
      args: [namespace],
    },
  ]);
  const registryFactoryRaw = unwrap<Hex>(registryFactoryEntry);
  let referenceFactory: string | undefined =
    registryFactoryRaw && !isZeroBytes32(registryFactoryRaw)
      ? pc20Bytes32ToAddress(chain, registryFactoryRaw)
      : undefined;

  if (!referenceFactory) {
    const vault = VAULT_ADDRESSES[chain];
    if (vault) {
      const [vaultFactoryEntry] = await batchRead(extClient, [
        {
          address: getAddress(vault),
          abi: VAULT_PC20_FACTORY_EVM,
          functionName: 'pc20Factory',
          args: [],
        },
      ]);
      const vaultFactory = unwrap<`0x${string}`>(vaultFactoryEntry);
      if (vaultFactory && vaultFactory !== '0x0000000000000000000000000000000000000000') {
        referenceFactory = getAddress(vaultFactory);
      }
    }
  }

  if (!referenceFactory) {
    throw new UnsupportedPC20DestinationError({
      chain: String(chain),
      chainNamespace: namespace,
      hint:
        'Neither UniversalCore nor the destination Vault has a PC20 factory ' +
        'registered for this chain.',
    });
  }

  const [gatewayFactoryEntry, codeEntry] = await Promise.all([
    batchRead(extClient, [
      { address: gateway, abi: EXTERNAL_GATEWAY_PC20_EVM, functionName: 'pc20Factory', args: [] },
    ]).then((r) => r[0]),
    (async () => {
      __readCount.n += 1;
      const code = await extClient.getCode({ address: getAddress(address) });
      return { status: 'success' as const, result: code };
    })(),
  ]);

  const gatewayFactory = unwrap<`0x${string}`>(gatewayFactoryEntry);
  if (!gatewayFactory || getAddress(gatewayFactory) !== getAddress(referenceFactory)) {
    throw new PC20FactoryMismatchError({
      chain: String(chain),
      address,
      chainNamespace: namespace,
      gatewayFactory,
      registryFactory: referenceFactory,
    });
  }

  const code = unwrap<string>(codeEntry);
  if (!code || code === '0x') {
    throw new PC20FactoryMismatchError({
      chain: String(chain),
      address,
      chainNamespace: namespace,
      hint: 'No contract is deployed at this wrapper address.',
    });
  }

  // Factory-scoped identity, batched into one round trip.
  const factory = getAddress(gatewayFactory);
  const wrapper = getAddress(address);
  const [isWrapperEntry, wrapperSourceEntry, sourceAssetEntry] = await batchRead(extClient, [
    { address: factory, abi: PC20_FACTORY_EVM, functionName: 'isPC20Wrapper', args: [wrapper] },
    { address: factory, abi: PC20_FACTORY_EVM, functionName: 'wrapperToSource', args: [wrapper] },
    { address: wrapper, abi: PC20_WRAPPER_EVM, functionName: 'SOURCE_ASSET', args: [] },
  ]);

  if (unwrap<boolean>(isWrapperEntry) !== true) {
    throw new PC20FactoryMismatchError({
      chain: String(chain),
      address,
      chainNamespace: namespace,
      hint: 'The live factory does not recognize this address as a PC20 wrapper.',
    });
  }

  const factorySource = unwrap<`0x${string}`>(wrapperSourceEntry);
  const immutableSource = unwrap<`0x${string}`>(sourceAssetEntry);
  for (const [label, value] of [
    ['factory.wrapperToSource', factorySource],
    ['wrapper.SOURCE_ASSET', immutableSource],
  ] as const) {
    if (!value || getAddress(value) !== getAddress(pushAddress)) {
      throw new PC20FactoryMismatchError({
        chain: String(chain),
        address,
        chainNamespace: namespace,
        hint: `${label} does not match the Push source UniversalCore returned.`,
      });
    }
  }

  tierBVerified.add(key);
}

// ---------------------------------------------------------------------------
// Push-native metadata
// ---------------------------------------------------------------------------

/**
 * Read and validate standard ERC-20 metadata on a Push-native token.
 *
 * Every metadata-compatible ERC-20 born on Push Chain is eligible for PC20
 * export. Synthetic PRC20s expose `CHAIN_NAMESPACE()` and are rejected even
 * though they also implement the standard metadata functions.
 */
export async function readPushPC20Metadata(
  pushAddress: `0x${string}`,
  opts: PC20ResolverOptions
): Promise<PC20Metadata> {
  const pushChain = getPushChainForNetwork(opts.network);
  const key = cacheKey(opts.network, pushChain, pushAddress);
  const cached = metadataCache.get(key);
  if (cached) return cached;

  const client = clientFor(pushChain, opts);
  const [metadataEntries, codeEntry] = await Promise.all([
    batchRead(client, [
      { address: pushAddress, abi: ERC20_EVM, functionName: 'name', args: [] },
      { address: pushAddress, abi: ERC20_EVM, functionName: 'symbol', args: [] },
      { address: pushAddress, abi: ERC20_EVM, functionName: 'decimals', args: [] },
      {
        address: pushAddress,
        abi: [
          {
            type: 'function',
            name: 'CHAIN_NAMESPACE',
            inputs: [],
            outputs: [{ name: '', type: 'string' }],
            stateMutability: 'view',
          },
        ] as const,
        functionName: 'CHAIN_NAMESPACE',
        args: [],
      },
    ]),
    (async () => {
      __readCount.n += 1;
      return { status: 'success' as const, result: await client.getCode({ address: pushAddress }) };
    })(),
  ]);

  const code = unwrap<string>(codeEntry);
  if (!code || code === '0x') {
    throw new InvalidPC20MetadataError('No contract is deployed at this address.', {
      chain: String(pushChain),
      address: pushAddress,
    });
  }

  const prc20Namespace = unwrap<string>(metadataEntries[3]);
  if (typeof prc20Namespace === 'string') {
    throw new PC20ExpectedButPRC20Error({
      chain: String(pushChain),
      address: pushAddress,
      chainNamespace: prc20Namespace,
    });
  }

  const name = unwrap<string>(metadataEntries[0]);
  const symbol = unwrap<string>(metadataEntries[1]);
  const decimals = unwrap<number>(metadataEntries[2]);
  if (name === undefined || symbol === undefined || decimals === undefined) {
    throw new InvalidPC20MetadataError(
      'Token must implement the ERC-20 metadata functions name(), symbol(), and decimals().',
      { chain: String(pushChain), address: pushAddress }
    );
  }

  if (!name || !symbol) {
    throw new InvalidPC20MetadataError('PC20 name and symbol must be non-empty.', {
      chain: String(pushChain),
      address: pushAddress,
    });
  }
  const normalizedDecimals = Number(decimals);
  if (!Number.isInteger(normalizedDecimals) || normalizedDecimals < 0 || normalizedDecimals > 255) {
    throw new InvalidPC20MetadataError('PC20 decimals must be a valid uint8 value.', {
      chain: String(pushChain),
      address: pushAddress,
    });
  }

  const validated: PC20Metadata = {
    name,
    symbol,
    decimals: normalizedDecimals,
  };
  metadataCache.set(key, validated);
  return validated;
}

// ---------------------------------------------------------------------------
// Destination-side lookups
// ---------------------------------------------------------------------------

/**
 * Confirmed wrapper deployments for a Push-native PC20.
 *
 * One multicall regardless of chain count — every `getPC20Wrapper` read targets
 * UniversalCore on Push Chain, so fanning out per chain would be N round trips
 * to the same endpoint for no reason.
 *
 * Returns confirmed deployments only. A predicted first-export address is the
 * outbound builder's concern, not discovery's.
 */
export async function listPC20Deployments(
  pushAddress: `0x${string}`,
  opts: PC20ResolverOptions & { chains?: CHAIN[] }
): Promise<PC20DeploymentInfo[]> {
  const targets = (opts.chains ?? allExternalChains()).filter((c) => !isPushChain(c));
  if (targets.length === 0) return [];

  const core = await getUniversalCoreAddress(opts);
  const client = clientFor(getPushChainForNetwork(opts.network), opts);

  const namespaces = targets.map((chain) => chainToNamespace(chain));
  const results = await batchRead(
    client,
    targets.map((_, i) => ({
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getPC20Wrapper',
      args: [pushAddress, namespaces[i]],
    }))
  );

  const deployments: PC20DeploymentInfo[] = [];
  targets.forEach((chain, i) => {
    const value = unwrap<[Hex, boolean]>(results[i]);
    if (!value) return;
    const [rawAddress, deployed] = value;
    if (!deployed || isZeroBytes32(rawAddress)) return;
    deployments.push({
      chain,
      chainNamespace: namespaces[i],
      vm: vmForChain(chain),
      address: pc20Bytes32ToAddress(chain, rawAddress),
      rawAddress,
    });
  });
  return deployments;
}

/**
 * Registered wrapper for a Push PC20 on one destination chain.
 *
 * `undefined` means not yet deployed — a legitimate state before a first
 * export, not an error. Callers that need an address for a first export must go
 * through the prediction path, which verifies against the live factory.
 */
export async function getRegisteredWrapper(
  pushAddress: `0x${string}`,
  destinationChain: CHAIN,
  opts: PC20ResolverOptions
): Promise<PC20DeploymentInfo | undefined> {
  const [found] = await listPC20Deployments(pushAddress, {
    ...opts,
    chains: [destinationChain],
  });
  return found;
}

// ---------------------------------------------------------------------------
// Chain discovery (lookup utility only)
// ---------------------------------------------------------------------------

/**
 * Work out which chain an address belongs to, when the caller did not say.
 *
 * Used ONLY by the read-only `getPC20Address` utility. The transaction path
 * never calls this — `funds.token` requires an explicit `chain`, and
 * `gate.ts` rejects one that disagrees with where the funds actually are. A
 * wrapper address copied from the wrong chain still fails on send; it merely
 * resolves informationally on lookup.
 *
 * Order is cheapest-first:
 *   1. narrow candidates by address format (local, free);
 *   2. try Push-native, which short-circuits with no registry read at all;
 *   3. probe every remaining namespace in one multicall.
 *
 * @throws {PC20AmbiguousAddressError} when several chains claim the address
 * with different Push sources.
 */
export async function discoverPC20Chain(
  address: string,
  opts: PC20ResolverOptions
): Promise<{ chain: CHAIN; pushAddress: `0x${string}` } | null> {
  const pushChain = getPushChainForNetwork(opts.network);
  const looksEvm = /^0x[0-9a-fA-F]{40}$/.test(address);

  // 2. Push-native short-circuit. Only an EVM-shaped address can be one.
  if (looksEvm) {
    try {
      const pushAddress = getAddress(address) as `0x${string}`;
      await readPushPC20Metadata(pushAddress, opts);
      return { chain: pushChain, pushAddress };
    } catch {
      // Not a Push-native PC20 — fall through to the external probe.
    }
  }

  // 1. Format narrowing. A hex address cannot be a Solana mint and vice versa,
  // so probing the other VM's namespaces would be pure waste.
  const candidates = allExternalChains().filter((chain) =>
    looksEvm ? vmForChain(chain) === VM.EVM : vmForChain(chain) === VM.SVM
  );
  if (candidates.length === 0) return null;

  // 3. One multicall across every candidate namespace — all these reads hit
  // UniversalCore on Push, so chain count costs nothing.
  const core = await getUniversalCoreAddress(opts);
  const client = clientFor(pushChain, opts);

  const probes = candidates.flatMap((chain) => {
    try {
      return [
        {
          chain,
          namespace: chainToNamespace(chain),
          raw: pc20AddressToBytes32(chain, address),
        },
      ];
    } catch {
      // Address is malformed for this chain's VM — not a candidate.
      return [];
    }
  });
  if (probes.length === 0) return null;

  const results = await batchRead(
    client,
    probes.map((p) => ({
      address: core,
      abi: UNIVERSAL_CORE_EVM,
      functionName: 'getPC20Source',
      args: [p.raw, p.namespace],
    }))
  );

  const matches: Array<{ chain: CHAIN; pushAddress: `0x${string}` }> = [];
  probes.forEach((p, i) => {
    const value = unwrap<[`0x${string}`, boolean]>(results[i]);
    if (!value) return;
    const [source, known] = value;
    if (!known || source === '0x0000000000000000000000000000000000000000') return;
    matches.push({ chain: p.chain, pushAddress: getAddress(source) as `0x${string}` });
  });

  if (matches.length === 0) return null;

  // Several chains can legitimately hold the same wrapper address only if they
  // resolve to the same token. Different sources means we cannot answer.
  const distinct = new Set(matches.map((m) => m.pushAddress.toLowerCase()));
  if (distinct.size > 1) {
    throw new PC20AmbiguousAddressError(
      address,
      matches.map((m) => ({ chain: String(m.chain), pushAddress: m.pushAddress }))
    );
  }

  return matches[0];
}

// ---------------------------------------------------------------------------
// Top-level resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a `{ chain, address }` PC20 reference into everything the execution
 * path needs, exactly once per transaction.
 *
 * `expectedChain` is where the funds actually are — the signer's chain for a
 * direct external route, `params.from.chain` for a CEA-origin route, the Push
 * chain for an export. Chain-ownership validation is the caller's job because
 * only the caller knows which of those applies; this function assumes it has
 * already passed.
 */
export async function resolvePC20Token(
  chain: CHAIN,
  address: string,
  opts: PC20ResolverOptions & { tierB?: boolean }
): Promise<ResolvedPC20> {
  const pushChain = getPushChainForNetwork(opts.network);

  // Export: the caller named a Push-native token.
  if (isPushChain(chain)) {
    const pushAddress = getAddress(address) as `0x${string}`;
    const meta = await readPushPC20Metadata(pushAddress, opts);
    return {
      direction: 'export',
      originChain: pushChain,
      originAddress: pushAddress,
      pushAddress,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
    };
  }

  // Import: the caller named an external wrapper.
  const { pushAddress, chainNamespace } = await resolveWrapperToSource(chain, address, opts);

  if (vmForChain(chain) === VM.EVM && (opts.tierB || opts.strict)) {
    await verifyEvmWrapperIdentity(chain, address, pushAddress, opts);
  }

  const meta = await readPushPC20Metadata(pushAddress, opts);
  return {
    direction: 'import',
    originChain: chain,
    originAddress:
      vmForChain(chain) === VM.EVM ? getAddress(address) : address,
    pushAddress,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    wrapperAddress: vmForChain(chain) === VM.EVM ? getAddress(address) : address,
    chainNamespace,
  };
}
