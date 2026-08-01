/**
 * A PC20 return with a prepaid gas deposit emits TWO gateway `UniversalTx`
 * events from one user tx: the PC20 burn (payload carries the `PC20` selector)
 * and a plain FUNDS event for the attached native value. Each becomes its own
 * UTX on Push, so picking the wrong one reports the wrong transaction's status.
 *
 * The default heuristic takes the LAST gateway log, which is the fee-credit
 * leg — the one that fails under the known fee-credit bug. That made a
 * fully-successful transfer surface to the developer as failed.
 *
 * Log shapes here mirror the live evidence tx
 * 0xcdd2b0ce00bc0826604db52d040566ac7910750bfad01563a78cfb4e55b907b3:
 * gateway logs at receipt indexes 749 (PC20 burn) and 750 (fee credit).
 */
import { encodeAbiParameters, encodeEventTopics, zeroAddress } from 'viem';
import { EVENT_UNIVERSAL_TX } from '../../universal-tx-detector/events';
import { findPC20GatewayLogIndex } from '../internals/response-builder';
import type { OrchestratorContext } from '../internals/context';

const ctx = {} as OrchestratorContext;

const SENDER = '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D' as const;
const UEA = '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D' as const;
const WRAPPER = '0x81E05001A1f3fB574E18c1B0b2596163c68144ae' as const;
/** Selector-prefixed payload, exactly as the gateway stamps it. */
const PC20_PAYLOAD = `0x50433230${'ab'.repeat(64)}` as const;

function gatewayLog(args: {
  token: `0x${string}`;
  amount: bigint;
  payload: `0x${string}`;
  txType: number;
  logIndex: number;
}) {
  const topics = encodeEventTopics({
    abi: [EVENT_UNIVERSAL_TX],
    eventName: 'UniversalTx',
    args: { sender: SENDER, recipient: UEA },
  });
  const data = encodeAbiParameters(
    EVENT_UNIVERSAL_TX.inputs.filter((i) => !i.indexed),
    [args.token, args.amount, args.payload, UEA, args.txType, '0x', false]
  );
  return { data, topics, logIndex: args.logIndex };
}

/** The PC20 burn leg — carries the user's transfer. */
const pc20BurnLog = gatewayLog({
  token: WRAPPER,
  amount: BigInt('1000000000000000'),
  payload: PC20_PAYLOAD,
  txType: 3, // FUNDS_AND_PAYLOAD (Solidity enum)
  logIndex: 749,
});

/** The fee-credit leg — attached ETH routed as plain FUNDS, empty payload. */
const feeCreditLog = gatewayLog({
  token: zeroAddress,
  amount: BigInt('529361008326850'),
  payload: '0x',
  txType: 2, // FUNDS
  logIndex: 750,
});

describe('PC20 tracked leg selection', () => {
  it('picks the PC20 burn leg, not the trailing fee-credit leg', () => {
    const idx = findPC20GatewayLogIndex(ctx, [pc20BurnLog, feeCreditLog]);
    expect(idx).toBe(0);
    // The bug this guards: the default heuristic would take the last log.
    expect(idx).not.toBe([pc20BurnLog, feeCreditLog].length - 1);
  });

  it('finds the PC20 leg regardless of emission order', () => {
    // Identification is by payload selector, not position, so a future
    // reordering in the gateway cannot silently reintroduce the bug.
    expect(findPC20GatewayLogIndex(ctx, [feeCreditLog, pc20BurnLog])).toBe(1);
  });

  it('returns null when no PC20 leg is present, leaving default behaviour', () => {
    expect(findPC20GatewayLogIndex(ctx, [feeCreditLog])).toBeNull();
  });

  it('ignores a payload that merely contains the selector later on', () => {
    const decoy = gatewayLog({
      token: WRAPPER,
      amount: BigInt(1),
      payload: `0x${'00'.repeat(8)}50433230`,
      txType: 3,
      logIndex: 800,
    });
    expect(findPC20GatewayLogIndex(ctx, [decoy])).toBeNull();
  });

  it('skips logs that are not decodable UniversalTx events', () => {
    const foreign = { data: '0xdeadbeef', topics: ['0x' + '11'.repeat(32)], logIndex: 5 };
    expect(findPC20GatewayLogIndex(ctx, [foreign, pc20BurnLog])).toBe(1);
  });
});
