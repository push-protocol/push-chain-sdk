/**
 * PC20 address codecs.
 *
 * UniversalCore stores every external identity as `bytes32`, with VM-specific
 * encoding:
 *
 *   EVM — the 20-byte address left-padded to 32 bytes.
 *   SVM — the raw 32-byte Solana public key, stored directly.
 *
 * The public API always speaks chain-native: checksummed hex for EVM, base58
 * for Solana. These helpers are the only place the two representations meet.
 */

import { getAddress, isAddress, isHex, padHex, type Hex } from 'viem';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { CHAIN, VM } from '../../../constants/enums';
import { vmForChain } from './chain-namespace';
import { InvalidPC20AddressError } from './errors';

/** 32 zero bytes — the registry's "absent" value, and Solana's default pubkey. */
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

/** True when a `bytes32` registry read came back empty (unset mapping). */
export function isZeroBytes32(value: string): boolean {
  return /^0x0*$/i.test(value);
}

/**
 * Normalize a chain-native address to the registry's `bytes32` form.
 *
 * @throws {InvalidPC20AddressError} on a malformed or zero/default address.
 */
export function pc20AddressToBytes32(chain: CHAIN, address: string): Hex {
  const vm = vmForChain(chain);
  return vm === VM.SVM
    ? svmAddressToBytes32(chain, address)
    : evmAddressToBytes32(chain, address);
}

/**
 * Convert a registry `bytes32` back to the chain-native representation:
 * checksummed hex for EVM, base58 for Solana.
 *
 * @throws {InvalidPC20AddressError} on a malformed or zero value.
 */
export function pc20Bytes32ToAddress(chain: CHAIN, value: string): string {
  const vm = vmForChain(chain);
  if (!isHex(value) || value.length !== 66) {
    throw new InvalidPC20AddressError('Registry value is not a 32-byte hex string.', {
      chain,
      address: value,
    });
  }
  if (isZeroBytes32(value)) {
    throw new InvalidPC20AddressError('Registry value is the zero identity.', {
      chain,
      address: value,
      hint: 'The mapping is unset — check `deployed`/`known` before decoding.',
    });
  }
  return vm === VM.SVM ? svmBytes32ToAddress(value) : evmBytes32ToAddress(chain, value);
}

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

function evmAddressToBytes32(chain: CHAIN, address: string): Hex {
  if (!isAddress(address)) {
    throw new InvalidPC20AddressError('Not a valid 20-byte EVM address.', {
      chain,
      address,
    });
  }
  if (address.toLowerCase() === ZERO_EVM_ADDRESS) {
    throw new InvalidPC20AddressError('Zero address is not a valid PC20 token.', {
      chain,
      address,
    });
  }
  return padHex(getAddress(address) as Hex, { size: 32, dir: 'left' });
}

function evmBytes32ToAddress(chain: CHAIN, value: Hex): string {
  // An EVM identity occupies the low 20 bytes; anything in the high 12 bytes
  // means this value was written for a different VM and must not be truncated
  // into a plausible-looking address.
  const highBytes = value.slice(2, 26);
  if (!/^0*$/.test(highBytes)) {
    throw new InvalidPC20AddressError(
      'Registry value has non-zero high bytes and is not a left-padded EVM address.',
      { chain, address: value, hint: 'This identity may belong to a non-EVM chain.' }
    );
  }
  return getAddress(`0x${value.slice(26)}`);
}

// ---------------------------------------------------------------------------
// SVM
// ---------------------------------------------------------------------------

function svmAddressToBytes32(chain: CHAIN, address: string): Hex {
  let key: PublicKey;
  try {
    // Accept both base58 (the normal form) and 32-byte hex, so a value read
    // back off-chain can be round-tripped without the caller re-encoding it.
    key = isHex(address)
      ? new PublicKey(Buffer.from(address.slice(2), 'hex'))
      : new PublicKey(address);
  } catch {
    throw new InvalidPC20AddressError('Not a valid Solana public key.', {
      chain,
      address,
    });
  }
  if (key.equals(PublicKey.default)) {
    throw new InvalidPC20AddressError('Default public key is not a valid PC20 mint.', {
      chain,
      address,
    });
  }
  return `0x${Buffer.from(key.toBytes()).toString('hex')}` as Hex;
}

function svmBytes32ToAddress(value: Hex): string {
  return bs58.encode(Buffer.from(value.slice(2), 'hex'));
}
