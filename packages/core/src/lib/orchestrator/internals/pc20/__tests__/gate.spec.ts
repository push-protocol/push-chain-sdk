import { isPC20Reference } from '../../../orchestrator.types';
import type {
  ExecuteParams,
  PC20TokenReference,
} from '../../../orchestrator.types';
import { assertLegacyFunds, isPC20Transaction } from '../gate';
import { CHAIN } from '../../../../constants/enums';
import type { MoveableToken } from '../../../../constants/tokens';

const MOVEABLE: MoveableToken = {
  symbol: 'USDC',
  decimals: 6,
  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  mechanism: 'approve',
};

const PC20: PC20TokenReference = {
  standard: 'pc20',
  chain: CHAIN.ETHEREUM_SEPOLIA,
  address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
};

describe('isPC20Reference', () => {
  it('accepts the tagged form', () => {
    expect(isPC20Reference(PC20)).toBe(true);
  });

  it('rejects a MoveableToken', () => {
    expect(isPC20Reference(MOVEABLE)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isPC20Reference(undefined)).toBe(false);
  });

  it('accepts the deprecated untagged { chain, address } form', () => {
    expect(
      isPC20Reference({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: PC20.address,
      } as PC20TokenReference)
    ).toBe(true);
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
