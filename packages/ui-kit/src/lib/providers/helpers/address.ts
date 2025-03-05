import { ChainType } from '../types/wallet.types';

const CHAIN_ID_MAP: Record<ChainType, string> = {
  [ChainType.ETHEREUM]: 'eip155:1', // Ethereum mainnet
  [ChainType.SOLANA]: 'solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ', // Solana mainnet
  [ChainType.BINANCE]: 'eip155:56', // Binance Smart Chain
  [ChainType.ARBITRUM]: 'eip155:42161', // Arbitrum One
};

export function formatCAIP10Address(
  rawAddress: string,
  chainType: ChainType
): string {
  const chainId = CHAIN_ID_MAP[chainType];

  const formattedAddress = (() => {
    switch (chainType) {
      case ChainType.ETHEREUM:
      case ChainType.BINANCE:
      case ChainType.ARBITRUM:
        return rawAddress;
      case ChainType.SOLANA:
        return rawAddress;
      default:
        return rawAddress;
    }
  })();

  return `${chainId}:${formattedAddress}`;
}

export function parseCAIP10Address(caipAddress: string): {
  chainType: ChainType | null;
  rawAddress: string;
} {
  const parts = caipAddress.split(':');

  if (parts.length !== 3) {
    return { chainType: null, rawAddress: caipAddress };
  }

  const namespace = parts[0];
  const reference = parts[1];
  const rawAddress = parts[2];

  const chainId = `${namespace}:${reference}`;

  const chainType = Object.entries(CHAIN_ID_MAP).find(
    ([, id]) => id === chainId
  )?.[0] as ChainType | undefined;

  return { chainType: chainType || null, rawAddress };
}
