import { decodeAbiParameters, size, slice } from 'viem';
import {
  buildPC20ExportPayload,
  assertMetadataFitsFactoryLimits,
  PC20_SELECTOR,
  MAX_PC20_NAME_BYTES,
  MAX_PC20_SYMBOL_BYTES,
} from '../export';
import { InvalidPC20MetadataError } from '../errors';
import { CHAIN } from '../../../../constants/enums';
import { chainToNamespace } from '../chain-namespace';

const DEST = CHAIN.ETHEREUM_SEPOLIA;

const base = {
  destinationChain: DEST,
  name: 'Push Token',
  symbol: 'PUSH',
  decimals: 18,
};

const METADATA_ABI = [
  { name: 'destChainNamespace', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'symbol', type: 'string' },
  { name: 'decimals', type: 'uint8' },
] as const;

describe('PC20 export payload', () => {
  it('starts with exactly the PC20 selector', () => {
    const payload = buildPC20ExportPayload(base);
    expect(slice(payload, 0, 4)).toBe(PC20_SELECTOR);
    // 'PC20' in ASCII. A drifted selector routes to the PRC20 path silently.
    expect(PC20_SELECTOR).toBe('0x50433230');
  });

  it('encodes the metadata tuple exactly', () => {
    const payload = buildPC20ExportPayload(base);
    const [namespace, name, symbol, decimals] = decodeAbiParameters(
      METADATA_ABI,
      slice(payload, 4)
    );

    expect(namespace).toBe(chainToNamespace(DEST));
    expect(name).toBe('Push Token');
    expect(symbol).toBe('PUSH');
    expect(decimals).toBe(18);
  });

  it('appends destination user data verbatim after the metadata', () => {
    const withoutData = buildPC20ExportPayload(base);
    const withData = buildPC20ExportPayload({
      ...base,
      destinationUserData: '0xdeadbeef',
    });

    expect(withData.startsWith(withoutData)).toBe(true);
    expect(slice(withData, size(withoutData))).toBe('0xdeadbeef');
  });

  it('produces an identical payload when user data is empty or omitted', () => {
    expect(buildPC20ExportPayload({ ...base, destinationUserData: '0x' })).toBe(
      buildPC20ExportPayload(base)
    );
  });

  it('rejects an unsupported destination chain', () => {
    expect(() =>
      buildPC20ExportPayload({ ...base, destinationChain: CHAIN.PUSH_MAINNET })
    ).toThrow();
  });
});

describe('PC20 metadata factory limits', () => {
  it('accepts metadata at the limit', () => {
    expect(() =>
      assertMetadataFitsFactoryLimits('a'.repeat(64), 'b'.repeat(32))
    ).not.toThrow();
  });

  it('rejects an over-long name', () => {
    expect(() => assertMetadataFitsFactoryLimits('a'.repeat(65), 'OK')).toThrow(
      InvalidPC20MetadataError
    );
  });

  it('rejects an over-long symbol', () => {
    expect(() => assertMetadataFitsFactoryLimits('OK', 'b'.repeat(33))).toThrow(
      InvalidPC20MetadataError
    );
  });

  it('measures bytes, not characters', () => {
    // 32 multi-byte characters is 96 bytes — a `.length` check would pass this
    // and then revert on the destination chain, after the source is locked.
    const multiByte = 'é'.repeat(32);
    expect(multiByte).toHaveLength(32);
    expect(() => assertMetadataFitsFactoryLimits('OK', multiByte)).toThrow(
      InvalidPC20MetadataError
    );
  });

  it('rejects empty name or symbol', () => {
    expect(() => assertMetadataFitsFactoryLimits('', 'PUSH')).toThrow(
      InvalidPC20MetadataError
    );
    expect(() => assertMetadataFitsFactoryLimits('Push', '')).toThrow(
      InvalidPC20MetadataError
    );
  });

  it('pins the limits to the reference PC20Factory constants', () => {
    // push-chain-gateway-contracts@pc20-3rd-iteration PC20Factory.sol:32-33.
    // If the contract changes these, this test must be updated deliberately.
    expect(MAX_PC20_NAME_BYTES).toBe(64);
    expect(MAX_PC20_SYMBOL_BYTES).toBe(32);
  });
});
