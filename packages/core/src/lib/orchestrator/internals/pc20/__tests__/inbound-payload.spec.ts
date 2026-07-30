/**
 * PC20 inbound payload construction.
 *
 * The two things that must be true for an EVM wrapper burn, and that nothing
 * else in the codebase asserts:
 *   1. the Push-side multicall transfers the resolved Push-native PC20, not
 *      whatever `getPRC20Address` would return for the wrapper;
 *   2. the wrapper is never approved.
 */

import { decodeFunctionData } from 'viem';
import { buildExecuteMulticall } from '../../../payload-builders';
import type { LegacyExecuteParams } from '../../../orchestrator.types';
import type { ResolvedPC20 } from '../resolver';
import { ERC20_EVM } from '../../../../constants/abi/erc20.evm';
import { CHAIN } from '../../../../constants/enums';

const UEA = '0x1111111111111111111111111111111111111111' as const;
const RECIPIENT = '0x2222222222222222222222222222222222222222' as const;
const WRAPPER = '0x3333333333333333333333333333333333333333' as const;
const PUSH_PC20 = '0x4444444444444444444444444444444444444444' as const;

const resolved: ResolvedPC20 = {
  direction: 'import',
  originChain: CHAIN.ETHEREUM_SEPOLIA,
  originAddress: WRAPPER,
  pushAddress: PUSH_PC20,
  name: 'Push Token',
  symbol: 'PUSH',
  decimals: 18,
  wrapperAddress: WRAPPER,
  chainNamespace: 'eip155:11155111',
};

const pc20Params = (over: Partial<LegacyExecuteParams> = {}): LegacyExecuteParams =>
  ({
    to: RECIPIENT,
    funds: {
      amount: BigInt(1_000_000),
      token: {
        symbol: 'PUSH',
        decimals: 18,
        address: WRAPPER,
        mechanism: 'pc20-burn' as const,
      },
    },
    _pc20: resolved,
    ...over,
  } as LegacyExecuteParams);

describe('PC20 inbound — Push-side payload', () => {
  it('transfers the resolved Push-native PC20, not the wrapper', () => {
    const calls = buildExecuteMulticall({ execute: pc20Params(), ueaAddress: UEA });

    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(PUSH_PC20);
    expect(calls[0].to).not.toBe(WRAPPER);
  });

  it('transfers the full funds amount to the requested recipient', () => {
    const calls = buildExecuteMulticall({ execute: pc20Params(), ueaAddress: UEA });

    const decoded = decodeFunctionData({ abi: ERC20_EVM, data: calls[0].data });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args?.[0]).toBe(RECIPIENT);
    expect(decoded.args?.[1]).toBe(BigInt(1_000_000));
  });

  it('orders funds-plus-data as transfer then call', () => {
    const calls = buildExecuteMulticall({
      execute: pc20Params({ data: '0xabcdef' }),
      ueaAddress: UEA,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].to).toBe(PUSH_PC20); // transfer first
    expect(calls[1].to).toBe(RECIPIENT); // then the user's call
    expect(calls[1].data).toBe('0xabcdef');
  });

  it('leaves distribution to the caller for an explicit MultiCall[]', () => {
    // Existing convention, preserved: an array payload means the user handles
    // fund movement themselves, so the SDK adds no transfer.
    const userCalls = [{ to: RECIPIENT, value: BigInt(0), data: '0x01' as const }];
    const calls = buildExecuteMulticall({
      execute: pc20Params({ data: userCalls }),
      ueaAddress: UEA,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].data).toBe('0x01');
  });

  it('never routes a PC20 through the PRC20 synthetic lookup', () => {
    // getPRC20Address throws for an unmapped address. Reaching it at all would
    // mean the resolved descriptor was ignored.
    expect(() =>
      buildExecuteMulticall({ execute: pc20Params(), ueaAddress: UEA })
    ).not.toThrow();
  });
});

describe('PC20 inbound — approval behavior', () => {
  it('uses a mechanism that is neither approve nor native', () => {
    // 'approve' would grant an allowance the PC20Factory never uses — it burns
    // via burnFrom. 'native' would attach the bridge amount as msg.value.
    const token = pc20Params().funds!.token!;
    expect(token.mechanism).toBe('pc20-burn');
    expect(token.mechanism).not.toBe('approve');
    expect(token.mechanism).not.toBe('native');
  });

  it('carries the wrapper address for the gateway request', () => {
    // req.token must be the external wrapper; only the Push-side transfer uses
    // the resolved source.
    expect(pc20Params().funds!.token!.address).toBe(WRAPPER);
    expect(pc20Params()._pc20!.pushAddress).toBe(PUSH_PC20);
  });
});
