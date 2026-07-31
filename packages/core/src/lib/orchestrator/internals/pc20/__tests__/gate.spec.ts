import { isPC20Reference } from '../../../orchestrator.types';
import type {
  ExecuteParams,
  PC20TokenReference,
} from '../../../orchestrator.types';
import {
  assertLegacyFunds,
  assertPC20ImportHasPayload,
  isPC20ImportWithFunds,
  isPC20Transaction,
} from '../gate';
import { PC20UnsafeEmptyPayloadError } from '../errors';
import { CHAIN } from '../../../../constants/enums';
import type { MoveableToken } from '../../../../constants/tokens';

const MOVEABLE: MoveableToken = {
  symbol: 'USDC',
  decimals: 6,
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  mechanism: 'approve',
};

const PC20: PC20TokenReference = {
  chain: CHAIN.ETHEREUM_SEPOLIA,
  address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
};

describe('isPC20Reference', () => {
  it('accepts a { chain, address } reference', () => {
    expect(isPC20Reference(PC20)).toBe(true);
  });

  it('rejects a MoveableToken', () => {
    expect(isPC20Reference(MOVEABLE)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isPC20Reference(undefined)).toBe(false);
  });

  it('does not misclassify a MoveableToken that also carries a chain', () => {
    // The tag is what makes this safe. Structural inference alone would be
    // ambiguous the moment MoveableToken grows an optional field.
    expect(
      isPC20Reference({
        ...MOVEABLE,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      } as unknown as MoveableToken)
    ).toBe(false);
  });
});

describe('PC20 gate', () => {
  const base = { to: '0xdeadbeef' } as unknown as ExecuteParams;

  it('passes a legacy MoveableToken through unchanged', () => {
    const params = {
      ...base,
      funds: { amount: BigInt(1), token: MOVEABLE },
    } as ExecuteParams;
    expect(assertLegacyFunds(params)).toBe(params);
    expect(isPC20Transaction(params)).toBe(false);
  });

  it('passes native funds (no token) through unchanged', () => {
    const params = { ...base, funds: { amount: BigInt(1) } } as ExecuteParams;
    expect(assertLegacyFunds(params)).toBe(params);
  });

  it('refuses to let an unresolved PC20 reference reach a legacy builder', () => {
    // The async gate (resolvePC20Funds) is the only way a PC20 reaches the
    // execution path. Hitting this synchronous assert means it was bypassed.
    const params = {
      ...base,
      funds: { amount: BigInt(1), token: PC20 },
    } as ExecuteParams;
    expect(isPC20Transaction(params)).toBe(true);
    expect(() => assertLegacyFunds(params)).toThrow(/without.*resolution/i);
  });
});

describe('PC20 import payload safety', () => {
  const resolvedImport = {
    funds: { amount: BigInt(1) },
    _pc20: {
      direction: 'import' as const,
      originChain: CHAIN.ETHEREUM_SEPOLIA,
      originAddress: PC20.address,
      pushAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`,
      name: 'Rain',
      symbol: 'RAIN',
      decimals: 18,
      chainNamespace: 'eip155:11155111',
    },
  };

  it('recognizes only resolved imports with a positive wrapper amount', () => {
    expect(isPC20ImportWithFunds(resolvedImport)).toBe(true);
    expect(
      isPC20ImportWithFunds({
        ...resolvedImport,
        funds: { amount: BigInt(0) },
      })
    ).toBe(false);
    expect(
      isPC20ImportWithFunds({
        ...resolvedImport,
        _pc20: { ...resolvedImport._pc20, direction: 'export' as const },
      })
    ).toBe(false);
  });

  it('fails closed before a resolved wrapper burn can carry an empty payload', () => {
    expect(() =>
      assertPC20ImportHasPayload(resolvedImport, false, 'test path')
    ).toThrow(PC20UnsafeEmptyPayloadError);

    try {
      assertPC20ImportHasPayload(resolvedImport, false, 'test path');
    } catch (error) {
      expect((error as PC20UnsafeEmptyPayloadError).code).toBe(
        'PC20_UNSAFE_EMPTY_PAYLOAD'
      );
      expect((error as PC20UnsafeEmptyPayloadError).message).toMatch(
        /No transaction was submitted/
      );
    }
  });

  it('allows the same import once a real forwarding payload exists', () => {
    expect(() =>
      assertPC20ImportHasPayload(resolvedImport, true, 'test path')
    ).not.toThrow();
  });
});

describe('route validation with PC20 funds', () => {
  // This exact gap reached a live run: validateRouteParams re-checks
  // funds.token against the symbol-keyed MOVEABLE_TOKENS table inside
  // executeMultiChain, after the gate has already resolved the PC20. It must
  // skip that check — and only that check — for PC20 shapes.
  const { validateRouteParams } = jest.requireActual('../../../route-detector');
  const target = {
    to: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0x' + '1'.repeat(40) },
    funds: { amount: BigInt(1) },
  };

  it('accepts an unresolved PC20 reference (pre-gate, e.g. prepareTransaction)', () => {
    expect(() =>
      validateRouteParams(
        { ...target, funds: { amount: BigInt(1), token: PC20 } },
        { clientChain: CHAIN.ETHEREUM_SEPOLIA }
      )
    ).not.toThrow();
  });

  it('accepts the gate-resolved internal form (_pc20 present)', () => {
    expect(() =>
      validateRouteParams(
        {
          ...target,
          funds: {
            amount: BigInt(1),
            token: { symbol: 'rain', decimals: 18, address: PC20.address, mechanism: 'pc20-burn' },
          },
          _pc20: { direction: 'export' },
        },
        { clientChain: CHAIN.ETHEREUM_SEPOLIA }
      )
    ).not.toThrow();
  });

  it('still rejects an unregistered MoveableToken', () => {
    expect(() =>
      validateRouteParams(
        {
          ...target,
          funds: {
            amount: BigInt(1),
            token: { symbol: 'NOPE', decimals: 18, address: '0x' + '2'.repeat(40), mechanism: 'approve' },
          },
        },
        { clientChain: CHAIN.ETHEREUM_SEPOLIA }
      )
    ).toThrow(/Unsupported moveable token/);
  });
});
