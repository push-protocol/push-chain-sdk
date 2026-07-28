/**
 * Unit tests for the cascade (multichain) replay path in tx-transformer.ts.
 *
 * Focus: `reconstructProgressEvents` recovers the user-level hop count by
 * decoding the sendUniversalTxToUEA payload embedded in each R3 outbound.
 * Before this fix, replay reported `outboundTx.length` (2 external legs),
 * missing the Push-internal R1 hops that the orchestrator merged into the
 * R3 inbound's execution.
 */
import { encodeAbiParameters, encodeFunctionData } from 'viem';
import { OutboundStatus } from '../../generated/uexecutor/v2/types';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import { CEA_EVM } from '../../constants/abi/cea.evm';
import { UEA_MULTICALL_SELECTOR, ZERO_ADDRESS } from '../../constants/selectors';
import {
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
} from '../payload-builders';
import type { UniversalTxResponse } from '../orchestrator.types';
import { reconstructProgressEvents } from '../internals/tx-transformer';

const ZERO_EVM = '0x0000000000000000000000000000000000000000' as `0x${string}`;
const CEA = '0xed13B7229fFF1996957762325a7fD8fbFa5d67C0' as `0x${string}`;
const TARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`;

// Build an R3 outbound payload whose embedded Push-side multicall has
// exactly `innerCount` merged R1 calls (all simple native transfers).
function buildR3OutboundPayload(innerCount: number): string {
  const pushMulticalls = Array.from({ length: innerCount }, (_, i) => ({
    to: TARGET,
    value: BigInt(1000 * (i + 1)),
    data: '0x' as `0x${string}`,
  }));
  const pushMulticallData = buildCeaMulticallPayload(pushMulticalls);
  const universalPayloadBytes = buildInboundUniversalPayload(pushMulticallData);

  const sendUniversalTxToUeaCalldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [ZERO_EVM, BigInt(0), universalPayloadBytes, CEA],
  });
  return buildCeaMulticallPayload([
    { to: CEA, value: BigInt(0), data: sendUniversalTxToUeaCalldata },
  ]);
}

function makeResponse(): UniversalTxResponse {
  return {
    hash: '0xdeadbeef',
    from: '0x0000000000000000000000000000000000000001',
    to: CEA,
    chain: 'eip155:42101',
    chainNamespace: 'eip155:42101',
    origin: 'eip155:42101:0x0000000000000000000000000000000000000001',
    gasLimit: BigInt(0),
    gasPrice: BigInt(0),
    route: undefined,
    raw: {},
  } as unknown as UniversalTxResponse;
}

function makeCascadeV2(
  legs: Array<{ chain: string; payload: string; status?: OutboundStatus }>
): UniversalTxV2 {
  return {
    id: 'utxid',
    pcTx: [],
    outboundTx: legs.map((leg) => ({
      destinationChain: leg.chain,
      recipient: CEA,
      amount: '0',
      externalAssetAddr: '',
      prc20AssetAddr: '',
      sender: '',
      payload: leg.payload,
      gasLimit: '0',
      txType: 0 as unknown as UniversalTxV2['outboundTx'][number]['txType'],
      id: '',
      outboundStatus: leg.status ?? OutboundStatus.OBSERVED,
      gasPrice: '0',
      gasFee: '0',
      refundSwapError: '',
      gasToken: '',
      abortReason: '',
        isPc20: false,
        pc20ContractAddress: '',
    })),
    universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
  };
}

describe('reconstructProgressEvents — cascade multichain replay', () => {
  it('recovers user-level hopCount from an R3 leg with merged R1 calls', () => {
    // 1 R2 leg + 1 R3 leg whose embedded Push multicall has 2 merged calls.
    // User-level hopCount should be (2 outbounds - 1 r3) + 2 merged = 3.
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcdabcd' },
    ]);
    const r3Payload = buildR3OutboundPayload(2);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload },
      { chain: 'eip155:97', payload: r3Payload },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    const term = events.find((e) => e.id === 'SEND-TX-999-01')!;
    expect(init).toBeDefined();
    expect(term).toBeDefined();
    expect((init.response as { hopCount: number }).hopCount).toBe(3);
    expect((term.response as { hopCount: number }).hopCount).toBe(3);
  });

  it('falls back to outboundTx.length when no R3 legs (pure R2 cascade)', () => {
    const r2a = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xdead' },
    ]);
    const r2b = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xbeef' },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2a },
      { chain: 'eip155:97', payload: r2b },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    expect((init.response as { hopCount: number }).hopCount).toBe(2);
  });

  it('clamps defensively — never reports fewer hops than external legs visible', () => {
    // R3 leg with malformed embedded payload (can't decode inner multicall).
    // Fallback: assume 1 merged hop per R3, so hopCount stays at outbounds.length.
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcd' },
    ]);
    // Build an R3-looking payload (contains sendUniversalTxToUEA selector)
    // but with garbage inside that won't decode cleanly.
    const fakeR3 = buildCeaMulticallPayload([
      { to: CEA, value: BigInt(0), data: `0xe7c1e3fc${'00'.repeat(64)}` as `0x${string}` },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload },
      { chain: 'eip155:97', payload: fakeR3 },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const init = events.find((e) => e.id === 'SEND-TX-001')!;
    const hopCount = (init.response as { hopCount: number }).hopCount;
    expect(hopCount).toBeGreaterThanOrEqual(2);
  });

  it('emits SEND-TX-999-02 with failedAt on a reverted leg', () => {
    const r2Payload = buildCeaMulticallPayload([
      { to: TARGET, value: BigInt(0), data: '0xabcd' },
    ]);
    const data = makeCascadeV2([
      { chain: 'eip155:97', payload: r2Payload, status: OutboundStatus.REVERTED },
      { chain: 'eip155:97', payload: r2Payload },
    ]);

    const events = reconstructProgressEvents(makeResponse(), data);
    const fail = events.find((e) => e.id === 'SEND-TX-999-02');
    const ok = events.find((e) => e.id === 'SEND-TX-999-01');
    expect(fail).toBeDefined();
    expect(ok).toBeUndefined();
    expect((fail!.response as { failedAt: number }).failedAt).toBe(1);
  });
});

// =============================================================================
// Single-route (R2 / R3) reconstruction — 203-03 pre-flight events
// =============================================================================

import { TransactionRoute } from '../route-detector';

function makeR2Response(): UniversalTxResponse {
  return {
    ...makeResponse(),
    route: TransactionRoute.UOA_TO_CEA,
    chain: 'eip155:11155111',
  } as unknown as UniversalTxResponse;
}

function makeR3Response(): UniversalTxResponse {
  return {
    ...makeResponse(),
    route: TransactionRoute.CEA_TO_PUSH,
    chain: 'eip155:11155111',
  } as unknown as UniversalTxResponse;
}

function makeR2DataWithBurn(burnAmount: string): UniversalTxV2 {
  return {
    id: 'utxid',
    pcTx: [],
    outboundTx: [
      {
        destinationChain: 'eip155:11155111',
        recipient: TARGET,
        amount: burnAmount,
        externalAssetAddr: '',
        prc20AssetAddr: '',
        sender: '',
        payload: '0x',
        gasLimit: '0',
        txType: 0 as unknown as UniversalTxV2['outboundTx'][number]['txType'],
        id: '',
        outboundStatus: OutboundStatus.OBSERVED,
        gasPrice: '0',
        gasFee: '0',
        refundSwapError: '',
        gasToken: '',
        abortReason: '',
        isPc20: false,
        pc20ContractAddress: '',
      },
    ],
    universalStatus: UniversalTxStatus.UNIVERSAL_TX_STATUS_UNSPECIFIED,
  };
}

describe('reconstructProgressEvents — single-route R2 pre-flight reconstruction', () => {
  it('reconstructs R2 stream with NATIVE 203-03 only (no funds.amount → no PRC-20 hook)', () => {
    const data = makeR2DataWithBurn('0'); // no burn → no PRC-20 leg
    const events = reconstructProgressEvents(makeR2Response(), data);
    const ids = events.map((e) => e.id);

    // Must include the new pre-flight info hook between 203-02 and 204-01.
    expect(ids).toContain('SEND-TX-203-03');
    const idx203_03 = ids.indexOf('SEND-TX-203-03');
    expect(ids.indexOf('SEND-TX-203-02')).toBeLessThan(idx203_03);
    expect(idx203_03).toBeLessThan(ids.indexOf('SEND-TX-204-01'));

    // Without funds.amount, only ONE 203-03 (NATIVE) — no PRC-20 hook.
    const count203_03 = ids.filter((id) => id === 'SEND-TX-203-03').length;
    expect(count203_03).toBe(1);

    // The single 203-03 carries kind: 'NATIVE'.
    const e = events.find((ev) => ev.id === 'SEND-TX-203-03')!;
    expect((e.response as { kind: string }).kind).toBe('NATIVE');
  });

  it('reconstructs R2 stream with both PRC-20 and NATIVE 203-03 when funds.amount > 0', () => {
    const data = makeR2DataWithBurn('100'); // burnAmount > 0 → user supplied funds
    const events = reconstructProgressEvents(makeR2Response(), data);
    const ids = events.map((e) => e.id);

    // Two 203-03 events: PRC-20 first, then NATIVE.
    const indices203_03 = ids.reduce<number[]>((acc, id, i) => {
      if (id === 'SEND-TX-203-03') acc.push(i);
      return acc;
    }, []);
    expect(indices203_03.length).toBe(2);

    // The two 203-03 events have PRC-20 and NATIVE kinds in that order.
    const evs203_03 = events.filter((ev) => ev.id === 'SEND-TX-203-03');
    expect((evs203_03[0].response as { kind: string }).kind).toBe('PRC20');
    expect((evs203_03[1].response as { kind: string }).kind).toBe('NATIVE');
  });
});

describe('reconstructProgressEvents — single-route R3 pre-flight reconstruction', () => {
  it('reconstructs R3 stream with single NATIVE 303-04 from historical tx data', () => {
    const data = makeR2DataWithBurn('0');
    const events = reconstructProgressEvents(makeR3Response(), data);
    const ids = events.map((e) => e.id);

    // 303-04 between 303-02 and 304-01 (R3 single-route preflight bucket).
    expect(ids).toContain('SEND-TX-303-04');
    expect(ids.indexOf('SEND-TX-303-02')).toBeLessThan(ids.indexOf('SEND-TX-303-04'));
    expect(ids.indexOf('SEND-TX-303-04')).toBeLessThan(ids.indexOf('SEND-TX-304-01'));

    // Historical tx data lacks the SDK-side PRC-20 balance snapshot, so replay
    // emits only the native preflight event.
    const count = ids.filter((id) => id === 'SEND-TX-303-04').length;
    expect(count).toBe(1);
    const e = events.find((ev) => ev.id === 'SEND-TX-303-04')!;
    expect((e.response as { kind: string }).kind).toBe('NATIVE');
  });
});
