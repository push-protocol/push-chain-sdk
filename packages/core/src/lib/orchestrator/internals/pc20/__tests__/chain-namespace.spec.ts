import {
  chainToNamespace,
  namespaceToChain,
  tryNamespaceToChain,
  allExternalChains,
  isPushChain,
  vmForChain,
} from '../chain-namespace';
import { PC20UnknownChainNamespaceError } from '../errors';
import { CHAIN, VM } from '../../../../constants/enums';
import { getChainNamespace } from '../../helpers';

describe('chain namespace mapping', () => {
  it('round-trips every external chain', () => {
    for (const chain of allExternalChains()) {
      expect(namespaceToChain(chainToNamespace(chain))).toBe(chain);
    }
  });

  it('agrees with the SDK-wide getChainNamespace convention', () => {
    // The rest of the SDK derives namespaces from CHAIN_INFO. If PC20 ever
    // derived them differently, registry reads would miss silently.
    for (const chain of allExternalChains()) {
      expect(chainToNamespace(chain)).toBe(getChainNamespace(chain));
    }
  });

  it('produces CAIP-2 chain ids, not bare prefixes', () => {
    expect(chainToNamespace(CHAIN.ETHEREUM_SEPOLIA)).toBe('eip155:11155111');
    expect(chainToNamespace(CHAIN.BNB_TESTNET)).toBe('eip155:97');
    expect(chainToNamespace(CHAIN.SOLANA_DEVNET)).toBe(
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    );
  });

  it('rejects a bare namespace prefix', () => {
    expect(() => namespaceToChain('eip155')).toThrow(
      PC20UnknownChainNamespaceError
    );
    expect(() => namespaceToChain('solana')).toThrow(
      PC20UnknownChainNamespaceError
    );
  });

  it('rejects an unknown namespace instead of returning a negative result', () => {
    // Returning undefined here would read downstream as "not deployed" and hide
    // the mapping bug.
    expect(() => namespaceToChain('eip155:999999')).toThrow(
      PC20UnknownChainNamespaceError
    );
  });

  it('rejects chains whose chainId is still a TBD placeholder', () => {
    expect(() => chainToNamespace(CHAIN.PUSH_MAINNET)).toThrow(
      PC20UnknownChainNamespaceError
    );
  });

  it('offers a non-throwing probe', () => {
    expect(tryNamespaceToChain('eip155:11155111')).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(tryNamespaceToChain('nope:1')).toBeUndefined();
  });

  it('excludes Push chains from the external set', () => {
    const external = allExternalChains();
    expect(external).not.toContain(CHAIN.PUSH_TESTNET_DONUT);
    expect(external).not.toContain(CHAIN.PUSH_MAINNET);
    expect(external).toContain(CHAIN.ETHEREUM_SEPOLIA);
    expect(external.every((c) => !isPushChain(c))).toBe(true);
  });

  it('identifies Push chains including the DONUT alias', () => {
    expect(isPushChain(CHAIN.PUSH_TESTNET)).toBe(true);
    expect(isPushChain(CHAIN.PUSH_TESTNET_DONUT)).toBe(true);
    expect(isPushChain(CHAIN.PUSH_LOCALNET)).toBe(true);
    expect(isPushChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(false);
  });

  it('reports the VM per chain', () => {
    expect(vmForChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(VM.EVM);
    expect(vmForChain(CHAIN.SOLANA_DEVNET)).toBe(VM.SVM);
  });
});
