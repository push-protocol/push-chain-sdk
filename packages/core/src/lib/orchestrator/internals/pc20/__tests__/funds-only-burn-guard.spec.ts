/**
 * Regression: a PC20 wrapper burn must never leave via the funds-only path.
 *
 * Observed on Donut before the fix — an EVM wrapper burn was routed to
 * `executeFundsOnly`, which sends an empty payload. The gateway prepends the
 * PC20 selector, the chain classifies the result FUNDS_AND_PAYLOAD, and its
 * inbound decode hard-fails on the selector-only payload with no revert. The
 * wrapper was already burned, so the canonical token stayed locked in
 * VaultPC20 forever. The failure is at ballot finalization: NormalizeForTxType
 * strips the selector to '0x', which slips past its empty-payload check, and
 * DecodeRawPayload('0x') errors — so no inbound handler ever runs, which is
 * why there is no deploy, no credit, and no revert outbound.
 *
 * The orchestrator now routes every PC20 import to the payload path on BOTH
 * VMs — it had been gated on `VM.SVM`, which is what left EVM exposed. These
 * tests cover the backstop that makes a regression fail loudly instead of
 * destroying tokens.
 */
import { executeFundsOnly } from '../../execute-funds-only';
import { PC20UnsafeEmptyPayloadError } from '../errors';
import { CHAIN } from '../../../../constants/enums';
import type { ResolvedPC20 } from '../resolver';
import type { MoveableToken } from '../../../../constants/tokens';

const IMPORT_DESCRIPTOR: ResolvedPC20 = {
  direction: 'import',
  originChain: CHAIN.ETHEREUM_SEPOLIA,
  originAddress: '0x81E05001A1f3fB574E18c1B0b2596163c68144ae',
  pushAddress: '0x14693f665cE282A451ba9a86F2EC04B43F931145',
  name: 'rain',
  symbol: 'rain',
  decimals: 18,
  chainNamespace: 'eip155:11155111',
};

// The gate flattens a PC20 into the legacy shape before execution, so the
// burn arrives here looking ordinary — the `_pc20` tag is the only signal.
const BURN_TOKEN: MoveableToken = {
  symbol: 'rain',
  decimals: 18,
  address: '0x81E05001A1f3fB574E18c1B0b2596163c68144ae',
  mechanism: 'pc20-burn',
} as unknown as MoveableToken;

const paramsFor = (extra: Record<string, unknown> = {}) =>
  ({
    to: '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D',
    funds: { amount: BigInt(10) ** BigInt(18), token: BURN_TOKEN },
    _pc20: IMPORT_DESCRIPTOR,
    ...extra,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

// The guard runs before anything touches ctx, so a stub is enough. If the
// guard ever stops firing, execution proceeds and these blow up on the stub
// rather than passing quietly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxStub = {} as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cbStub = (() => ({})) as any;

describe('executeFundsOnly — PC20 burn backstop', () => {
  it('refuses to broadcast a PC20 import (would burn the wrapper and lock the token)', async () => {
    await expect(
      executeFundsOnly(ctxStub, paramsFor(), [], cbStub)
    ).rejects.toThrow(PC20UnsafeEmptyPayloadError);
  });

  it('names the offending path so the failure is diagnosable', async () => {
    await expect(
      executeFundsOnly(ctxStub, paramsFor(), [], cbStub)
    ).rejects.toThrow(/executeFundsOnly/);
  });

  it('reports the wrapper being burned, not the canonical token', async () => {
    try {
      await executeFundsOnly(ctxStub, paramsFor(), [], cbStub);
      throw new Error('expected executeFundsOnly to reject');
    } catch (err) {
      const e = err as PC20UnsafeEmptyPayloadError;
      expect(e.code).toBe('PC20_UNSAFE_EMPTY_PAYLOAD');
      expect(e.address).toBe(IMPORT_DESCRIPTOR.originAddress);
      expect(e.chainNamespace).toBe('eip155:11155111');
    }
  });

  it('does not fire for an export — locking the source token is the safe direction', async () => {
    const exportParams = paramsFor({
      _pc20: { ...IMPORT_DESCRIPTOR, direction: 'export' },
    });
    // Rejects for unrelated reasons (stub ctx), but never as the PC20 guard.
    await expect(
      executeFundsOnly(ctxStub, exportParams, [], cbStub)
    ).rejects.not.toThrow(PC20UnsafeEmptyPayloadError);
  });

  it('does not fire for an ordinary PRC20 funds transfer', async () => {
    const legacy = paramsFor({ _pc20: undefined });
    await expect(
      executeFundsOnly(ctxStub, legacy, [], cbStub)
    ).rejects.not.toThrow(PC20UnsafeEmptyPayloadError);
  });
});
