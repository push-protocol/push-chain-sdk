import {
  pc20AddressToBytes32,
  pc20Bytes32ToAddress,
  isZeroBytes32,
} from '../address-codec';
import { InvalidPC20AddressError } from '../errors';
import { CHAIN } from '../../../../constants/enums';

const EVM_CHAIN = CHAIN.ETHEREUM_SEPOLIA;
const SVM_CHAIN = CHAIN.SOLANA_DEVNET;

// Lowercase input; the checksummed form differs, which is what makes this a
// useful round-trip fixture rather than a no-op string compare.
const EVM_LOWER = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984';
const EVM_CHECKSUMMED = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const EVM_PADDED =
  '0x0000000000000000000000001f9840a85d5af5bf1d1762f925bdaddc4201f984';

const SVM_BASE58 = 'So11111111111111111111111111111111111111112';

describe('PC20 address codec — EVM', () => {
  it('left-pads a 20-byte address to bytes32', () => {
    expect(pc20AddressToBytes32(EVM_CHAIN, EVM_LOWER).toLowerCase()).toBe(
      EVM_PADDED
    );
  });

  it('round-trips and returns the checksummed form', () => {
    const raw = pc20AddressToBytes32(EVM_CHAIN, EVM_LOWER);
    expect(pc20Bytes32ToAddress(EVM_CHAIN, raw)).toBe(EVM_CHECKSUMMED);
  });

  it('rejects the zero address', () => {
    expect(() =>
      pc20AddressToBytes32(EVM_CHAIN, '0x' + '0'.repeat(40))
    ).toThrow(InvalidPC20AddressError);
  });

  it('rejects a malformed address', () => {
    expect(() => pc20AddressToBytes32(EVM_CHAIN, '0xdeadbeef')).toThrow(
      InvalidPC20AddressError
    );
  });

  it('rejects a bytes32 whose high bytes are set', () => {
    // A Solana identity decoded as EVM would otherwise silently truncate into a
    // plausible-looking address.
    const svmRaw = pc20AddressToBytes32(SVM_CHAIN, SVM_BASE58);
    expect(() => pc20Bytes32ToAddress(EVM_CHAIN, svmRaw)).toThrow(
      InvalidPC20AddressError
    );
  });
});

describe('PC20 address codec — SVM', () => {
  it('round-trips base58 through the raw 32-byte form', () => {
    const raw = pc20AddressToBytes32(SVM_CHAIN, SVM_BASE58);
    expect(raw).toHaveLength(66);
    expect(pc20Bytes32ToAddress(SVM_CHAIN, raw)).toBe(SVM_BASE58);
  });

  it('accepts the hex form and normalizes it back to base58', () => {
    const raw = pc20AddressToBytes32(SVM_CHAIN, SVM_BASE58);
    expect(pc20AddressToBytes32(SVM_CHAIN, raw)).toBe(raw);
    expect(pc20Bytes32ToAddress(SVM_CHAIN, raw)).toBe(SVM_BASE58);
  });

  it('rejects the default public key', () => {
    expect(() =>
      pc20AddressToBytes32(SVM_CHAIN, '11111111111111111111111111111111')
    ).toThrow(InvalidPC20AddressError);
  });

  it('rejects a malformed base58 key', () => {
    expect(() => pc20AddressToBytes32(SVM_CHAIN, 'not-a-key')).toThrow(
      InvalidPC20AddressError
    );
  });
});

describe('isZeroBytes32', () => {
  it('detects the unset registry value', () => {
    expect(isZeroBytes32('0x' + '0'.repeat(64))).toBe(true);
    expect(isZeroBytes32(EVM_PADDED)).toBe(false);
  });

  it('rejects decoding an unset value rather than returning the zero address', () => {
    expect(() =>
      pc20Bytes32ToAddress(EVM_CHAIN, '0x' + '0'.repeat(64))
    ).toThrow(InvalidPC20AddressError);
  });
});
