/**
 * PC20 outbound tracking.
 *
 * `externalAssetAddr` alone is not a reliable source for the destination
 * wrapper address on a PC20 export:
 *
 *   - it is empty when the outbound is first created;
 *   - it is normally backfilled once the destination wrapper is *observed*,
 *     which only happens when a wrapper is newly deployed;
 *   - a repeat export deploys nothing, so nothing is observed and the field can
 *     stay empty indefinitely.
 *
 * The wrapper is therefore resolved from UniversalCore whenever the observation
 * did not supply one. `pc20ContractAddress` (the locked Push-native source) is
 * the stable identifier that makes the lookup possible.
 */

import type { OutboundTxV2 } from '../../../generated/uexecutor/v2/types';
import type { OrchestratorContext } from '../context';
import { printLog } from '../context';
import { CHAIN } from '../../../constants/enums';
import { tryNamespaceToChain, vmForChain } from './chain-namespace';
import { getRegisteredWrapper, type PC20ResolverOptions } from './resolver';
import { PC20UnknownChainNamespaceError } from './errors';

/** Shape of the fields this module needs, so callers can pass partial fixtures. */
export type PC20OutboundView = Pick<
  OutboundTxV2,
  'isPc20' | 'pc20ContractAddress' | 'externalAssetAddr' | 'destinationChain'
> & {
  observedTx?: { pc20WrapperAddress?: string } | undefined;
};

/**
 * Best available destination wrapper address for a PC20 outbound, in
 * chain-native form (checksummed hex on EVM, base58 on Solana).
 *
 * Resolution order, cheapest first:
 *   1. the settlement observation, when a wrapper was newly deployed;
 *   2. `externalAssetAddr`, once backfilled;
 *   3. UniversalCore, keyed by the Push-native source.
 *
 * Returns `undefined` rather than throwing when nothing resolves — a receipt
 * for an in-flight outbound legitimately has no wrapper yet, and failing
 * tracking over a cosmetic field would be worse than omitting it.
 */
export async function resolvePC20WrapperForReceipt(
  ctx: OrchestratorContext,
  outbound: PC20OutboundView,
  opts: PC20ResolverOptions
): Promise<string | undefined> {
  if (!outbound.isPc20) return undefined;

  const observed = outbound.observedTx?.pc20WrapperAddress;
  if (observed) return normalizeForChain(outbound.destinationChain, observed);

  if (outbound.externalAssetAddr) {
    return normalizeForChain(outbound.destinationChain, outbound.externalAssetAddr);
  }

  if (!outbound.pc20ContractAddress) {
    printLog(
      ctx,
      '[pc20] outbound is flagged isPc20 but carries no pc20ContractAddress; ' +
        'cannot resolve the destination wrapper'
    );
    return undefined;
  }

  // `destinationChain` arrives as an untyped string. It must go through the
  // namespace mapping — passing it to the registry verbatim would return a zero
  // wrapper, indistinguishable from "not deployed yet".
  const chain = tryNamespaceToChain(outbound.destinationChain);
  if (!chain) {
    printLog(
      ctx,
      `[pc20] unmappable destination namespace "${outbound.destinationChain}"; ` +
        'skipping wrapper resolution'
    );
    return undefined;
  }

  try {
    const registered = await getRegisteredWrapper(
      outbound.pc20ContractAddress as `0x${string}`,
      chain,
      opts
    );
    return registered?.address;
  } catch (err) {
    printLog(
      ctx,
      `[pc20] wrapper resolution failed for ${outbound.pc20ContractAddress} on ` +
        `${chain}: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

/**
 * Strict namespace resolution for callers that must not silently degrade.
 *
 * @throws {PC20UnknownChainNamespaceError} when the namespace maps to no chain.
 */
export function requireDestinationChain(namespace: string): CHAIN {
  const chain = tryNamespaceToChain(namespace);
  if (!chain) {
    throw new PC20UnknownChainNamespaceError(namespace, {
      hint: 'Destination chain on the outbound record is not a supported CAIP-2 id.',
    });
  }
  return chain;
}

/**
 * Present an address in the destination chain's native form.
 *
 * SVM identities travel as `0x`-prefixed hex internally (that is how the
 * Cosmos keeper indexes them) but users expect base58.
 */
function normalizeForChain(namespace: string, address: string): string {
  const chain = tryNamespaceToChain(namespace);
  if (!chain) return address;

  try {
    if (vmForChain(chain) === 'SVM' && address.startsWith('0x')) {
      // Reuse the codec so hex→base58 has exactly one implementation.
      const { pc20Bytes32ToAddress } = require('./address-codec');
      return pc20Bytes32ToAddress(chain, address);
    }
    const { getAddress } = require('viem');
    return getAddress(address);
  } catch {
    // A malformed address from the node is not worth failing a receipt over.
    return address;
  }
}
