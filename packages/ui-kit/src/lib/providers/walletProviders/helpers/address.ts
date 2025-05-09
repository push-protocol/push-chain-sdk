import { ChainType } from '../../../types/wallet.types';

export const chainToNamespace = {
  EVM: 'eip155',
  SOL: 'solana',
};

export function fromCAIPFormat(caipAddress: string) {
  const parts = caipAddress.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid CAIP-10 address format');
  }

  const namespace = parts[0];
  const chainId = parts[1];
  const rawAddress = parts[2];

  let chain: ChainType | null = null;

  if (namespace === 'eip155') {
    if (chainId === '1') {
      chain = ChainType.ETHEREUM;
    } else if (chainId === '56') {
      chain = ChainType.BINANCE;
    } else if (chainId === '42161') {
      chain = ChainType.ARBITRUM;
    } else if (chainId === '43114') {
      chain = ChainType.AVALANCHE;
    } else {
      chain = ChainType.ETHEREUM;
    }
  } else if (namespace === 'solana') {
    chain = ChainType.SOLANA;
  } else {
    throw new Error('Unsupported namespace');
  }

  return {
    chain,
    chainId,
    rawAddress,
  };
}

export function toCAIPFormat(
  rawAddress: string,
  chain: ChainType,
  chainId: number | string
) {
  const formattedAddress = rawAddress;
  let formattedChainId = chainId;
  let namespace = '';

  if (
    chain.toLowerCase() === ChainType.ETHEREUM ||
    chain.toLowerCase() === ChainType.BINANCE ||
    chain.toLowerCase() === ChainType.ARBITRUM ||
    chain.toLowerCase() === ChainType.AVALANCHE
  ) {
    namespace = 'eip155';

    if (typeof chainId === 'string' && chainId.startsWith('0x')) {
      formattedChainId = parseInt(chainId, 16);
    }
  } else if (chain.toLowerCase() === ChainType.SOLANA) {
    namespace = 'solana';

    // TODO: Find a method to get the solana chain id in caip format
    formattedChainId = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'; //testnet
  } else {
    throw new Error("Unsupported chain. Use 'ethereum' or 'solana'.");
  }

  return `${namespace}:${formattedChainId}:${formattedAddress}`;
}
