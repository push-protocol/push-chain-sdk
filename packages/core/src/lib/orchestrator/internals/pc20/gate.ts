/**
 * The PC20 gate.
 *
 * `funds.token` publicly accepts a `MoveableToken` or a `PC20TokenReference`.
 * Exactly one place decides which branch a transaction takes, and it is here.
 * Everything downstream types against `LegacyExecuteParams`, whose `funds.token`
 * is an `InternalFundsToken` and whose `_pc20` descriptor is authoritative for
 * PC20 behavior. A PC20 reference reaching a builder unresolved is a compile
 * error, not a runtime `undefined`.
 *
 * Resolution happens once, here, before approvals, fee calculation, or any
 * broadcast — so a chain/address mismatch costs the caller nothing.
 */

import type {
  ExecuteParams,
  LegacyExecuteParams,
  PC20TokenReference,
} from '../../orchestrator.types';
import { isPC20Reference } from '../../orchestrator.types';
import type { OrchestratorContext } from '../context';
import { CHAIN } from '../../../constants/enums';
import { getPushChainForNetwork } from '../helpers';
import { resolvePC20Token, type ResolvedPC20 } from './resolver';
import { isPushChain } from './chain-namespace';
import {
  PC20TokenChainMismatchError,
  PC20RegistryMismatchError,
} from './errors';

/** True when this transaction's funds are a PC20 reference. */
export function isPC20Transaction(params: ExecuteParams): boolean {
  return isPC20Reference(params.funds?.token);
}

/**
 * Where the funds token must live for this transaction.
 *
 * `to.chain` is the *destination* and is never the answer — mistaking the two
 * is the single most likely caller error, which is why it gets its own check
 * and its own error rather than failing later as "wrapper not registered".
 */
function expectedFundsChain(
  ctx: OrchestratorContext,
  params: ExecuteParams
): CHAIN {
  // Explicit CEA-origin route (Routes 3/4): the funds sit on the `from` chain.
  const fromChain = (params as { from?: { chain?: CHAIN } }).from?.chain;
  if (fromChain) return fromChain;

  // Push-to-external export: the caller named a Push-native token.
  const token = params.funds?.token as PC20TokenReference | undefined;
  if (token && isPushChain(token.chain)) {
    return getPushChainForNetwork(ctx.pushNetwork);
  }

  // Direct external-to-Push: the funds are wherever the signer is.
  return ctx.universalSigner.account.chain;
}

/**
 * Validate chain ownership and resolve the PC20 against the live registry.
 *
 * Returns params shaped for the shared execution path, with `_pc20` carrying
 * the resolved descriptor. The caller's token object is never mutated.
 */
export async function resolvePC20Funds(
  ctx: OrchestratorContext,
  params: ExecuteParams
): Promise<LegacyExecuteParams> {
  const token = params.funds?.token as PC20TokenReference;
  const amount = params.funds?.amount ?? BigInt(0);

  if (amount <= BigInt(0)) {
    throw new Error('funds.amount must be greater than zero for a PC20 transfer.');
  }

  const expected = expectedFundsChain(ctx, params);
  if (token.chain !== expected) {
    throw new PC20TokenChainMismatchError({
      chain: String(token.chain),
      address: token.address,
      expectedChain: String(expected),
    });
  }

  const resolved: ResolvedPC20 = await resolvePC20Token(
    token.chain,
    token.address,
    {
      network: ctx.pushNetwork,
      rpcUrls: ctx.rpcUrls as Partial<Record<CHAIN, string[]>>,
      // Factory identity is Tier B. Run it on first use of a given
      // (chain, address) per session; the resolver caches the verdict.
      tierB: true,
    }
  );

  return {
    ...(params as object),
    funds: {
      amount,
      token: {
        symbol: resolved.symbol,
        decimals: resolved.decimals,
        // The gateway request carries the *external wrapper* address. The
        // Push-side transfer uses `_pc20.pushAddress` instead.
        address: resolved.originAddress,
        mechanism: 'pc20-burn' as const,
      },
    },
    _pc20: resolved,
  } as LegacyExecuteParams;
}

/**
 * Narrow `ExecuteParams` to the shared execution shape.
 *
 * Synchronous counterpart used where no PC20 resolution is possible or needed.
 * Throws if a PC20 reference reaches it, which would mean the async gate was
 * skipped.
 */
export function assertLegacyFunds(params: ExecuteParams): LegacyExecuteParams {
  if (isPC20Reference(params.funds?.token)) {
    throw new Error(
      'Internal: a PC20 funds reference reached the legacy path without ' +
        'resolution. resolvePC20Funds() must run first.'
    );
  }
  return params as LegacyExecuteParams;
}

/**
 * Re-verify a prepared PC20 transaction at send time.
 *
 * A prepared tx is built now and broadcast later. Between the two, the registry
 * can change in a way that matters:
 *
 *   - a first export lands and creates a wrapper mapping that did not exist,
 *     turning a predicted destination address into a registered one;
 *   - a factory is reconfigured, invalidating the identity the payload assumed.
 *
 * Only the critical reads are repeated — forward/reverse registry agreement and
 * the Push source binding. Re-running the whole Tier B sweep on every send of a
 * prepared tx would cost more than it protects.
 *
 * Throws if the resolved Push source has moved. That is not recoverable by
 * retrying: the signed payload already encodes the old source.
 */
export async function revalidatePreparedPC20(
  ctx: OrchestratorContext,
  prepared: LegacyExecuteParams
): Promise<void> {
  const descriptor = prepared._pc20;
  if (!descriptor) return;

  // An export's identity is the Push token itself, which the payload pins; a
  // registry change cannot redirect it. Only imports need the recheck.
  if (descriptor.direction !== 'import') return;

  const fresh = await resolvePC20Token(
    descriptor.originChain,
    descriptor.originAddress,
    {
      network: ctx.pushNetwork,
      rpcUrls: ctx.rpcUrls as Partial<Record<CHAIN, string[]>>,
      // Tier A only. Tier B already passed at prepare time and its subjects
      // (factory identity, deployed bytecode) do not change without a redeploy.
      tierB: false,
    }
  );

  if (fresh.pushAddress.toLowerCase() !== descriptor.pushAddress.toLowerCase()) {
    throw new PC20RegistryMismatchError({
      chain: String(descriptor.originChain),
      address: descriptor.originAddress,
      chainNamespace: descriptor.chainNamespace,
      resolvedWrapper: fresh.pushAddress,
      hint:
        'The registry changed after this transaction was prepared. Prepare it ' +
        'again — the signed payload encodes the previous Push source.',
    });
  }
}

/** Resolve PC20 funds when present; otherwise pass the legacy shape through. */
export async function gateFunds(
  ctx: OrchestratorContext,
  params: ExecuteParams
): Promise<LegacyExecuteParams> {
  return isPC20Transaction(params)
    ? resolvePC20Funds(ctx, params)
    : assertLegacyFunds(params);
}
