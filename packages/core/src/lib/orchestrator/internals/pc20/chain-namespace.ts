/**
 * Chain namespace mapping for PC20 — single source of truth.
 *
 * `chainNamespace` is the key for every PC20 registry read on UniversalCore
 * (`getPC20Wrapper`, `getPC20Source`, `pc20FactoryByChain`,
 * `getPC20ExportGasAndFees`, `pc20DeploymentGasOverhead`) and appears in the
 * public PC20 result types.
 *
 * The contracts define it as the CAIP-2 chain identifier — see
 * `push-chain-core-contracts/src/Interfaces/IUniversalCore.sol`:
 *
 *     /// @param destChainNamespace  Destination chain (CAIP-2, e.g., "eip155:1")
 *
 * ## Why this derives from CHAIN_INFO and not from the CHAIN enum value
 *
 * The `CHAIN` enum values look like CAIP-2 strings already, so identity is
 * tempting. It is wrong. `CHAIN.PUSH_LOCALNET` is `'eip155:9001'` while its
 * `CHAIN_INFO.chainId` is `'9000'`, and `CHAIN.PUSH_MAINNET`'s chainId is still
 * the `'TBD'` placeholder. The rest of the SDK (`helpers.getChainNamespace`,
 * `utils/external-tx-hash.chainFromNamespace`) already derives from
 * `CHAIN_INFO`, so deriving here keeps one convention instead of introducing a
 * second that silently disagrees on those two chains.
 *
 * The `'TBD'` placeholder is rejected outright. `'eip155:TBD'` is a
 * syntactically fine string that matches nothing in the registry — exactly the
 * kind of value that reads back as "not deployed".
 *
 * Do NOT confuse this with `VM_NAMESPACE` in `constants/chain.ts`, which is the
 * CAIP-2 *prefix* only (`'eip155'` / `'solana'`). Passing a bare prefix to the
 * registry silently misses.
 *
 * ## Why these throw
 *
 * An unmapped namespace returns `(0x0, known=false)` from the registry, which
 * is indistinguishable from "this wrapper is not deployed yet". Returning a
 * negative would surface a mapping bug as an empty receipt field or a spurious
 * "not registered" error. Throwing keeps the failure legible.
 */

import { CHAIN, VM } from '../../../constants/enums';
import { CHAIN_INFO, VM_NAMESPACE } from '../../../constants/chain';
import { PC20UnknownChainNamespaceError } from './errors';

/** All `CHAIN` enum values (PUSH_TESTNET_DONUT aliases PUSH_TESTNET, so this de-dupes). */
const ALL_CHAINS = Array.from(new Set(Object.values(CHAIN))) as CHAIN[];

/** chainId values that are placeholders rather than real identifiers. */
const PLACEHOLDER_CHAIN_IDS = new Set(['TBD', '', 'unknown']);

function deriveNamespace(chain: CHAIN): string | undefined {
  const info = CHAIN_INFO[chain];
  if (!info) return undefined;
  if (PLACEHOLDER_CHAIN_IDS.has(info.chainId)) return undefined;
  return `${VM_NAMESPACE[info.vm]}:${info.chainId}`;
}

const CHAIN_TO_NAMESPACE: ReadonlyMap<CHAIN, string> = new Map(
  ALL_CHAINS.flatMap((chain) => {
    const ns = deriveNamespace(chain);
    return ns ? ([[chain, ns]] as [CHAIN, string][]) : [];
  })
);

const NAMESPACE_TO_CHAIN: ReadonlyMap<string, CHAIN> = new Map(
  Array.from(CHAIN_TO_NAMESPACE, ([chain, ns]) => [ns, chain] as [string, CHAIN])
);

/**
 * Convert a supported `CHAIN` to the namespace string UniversalCore is keyed on.
 *
 * @throws {PC20UnknownChainNamespaceError} if the chain is unsupported or its
 * chainId is still a placeholder.
 */
export function chainToNamespace(chain: CHAIN): string {
  const namespace = CHAIN_TO_NAMESPACE.get(chain);
  if (!namespace) {
    throw new PC20UnknownChainNamespaceError(String(chain), {
      chain: String(chain),
      hint:
        'This chain has no usable CAIP-2 chainId in CHAIN_INFO ' +
        '(unsupported, or still a TBD placeholder).',
    });
  }
  return namespace;
}

/**
 * Convert a namespace string from chain or protobuf data back to a `CHAIN`.
 *
 * Used by the outbound tracking fallback, where `destinationChain` arrives as an
 * untyped string from the node.
 *
 * @throws {PC20UnknownChainNamespaceError} if it maps to no supported chain.
 */
export function namespaceToChain(namespace: string): CHAIN {
  const chain = NAMESPACE_TO_CHAIN.get(namespace);
  if (!chain) {
    throw new PC20UnknownChainNamespaceError(namespace, {
      hint:
        'Expected a CAIP-2 chain id (e.g. "eip155:11155111"), not a bare ' +
        'namespace prefix such as "eip155".',
    });
  }
  return chain;
}

/** Non-throwing variant for callers that legitimately probe an unknown value. */
export function tryNamespaceToChain(namespace: string): CHAIN | undefined {
  return NAMESPACE_TO_CHAIN.get(namespace);
}

/** Non-throwing variant, for building candidate chain lists. */
export function tryChainToNamespace(chain: CHAIN): string | undefined {
  return CHAIN_TO_NAMESPACE.get(chain);
}

/** VM for a supported chain. Throws rather than defaulting to EVM. */
export function vmForChain(chain: CHAIN): VM {
  const info = CHAIN_INFO[chain];
  if (!info) {
    throw new PC20UnknownChainNamespaceError(String(chain), {
      chain: String(chain),
      hint: 'Chain is not present in CHAIN_INFO.',
    });
  }
  return info.vm;
}

/** True for any Push Chain network (never an external chain). */
export function isPushChain(chain: CHAIN): boolean {
  // PUSH_TESTNET_DONUT is an alias of PUSH_TESTNET, so it is covered here.
  return (
    chain === CHAIN.PUSH_MAINNET ||
    chain === CHAIN.PUSH_TESTNET ||
    chain === CHAIN.PUSH_LOCALNET
  );
}

/**
 * Supported external chains that have a usable namespace — the default target
 * set for deployment discovery when the caller passes no explicit `chains`.
 */
export function allExternalChains(): CHAIN[] {
  return ALL_CHAINS.filter((c) => !isPushChain(c) && CHAIN_TO_NAMESPACE.has(c));
}
