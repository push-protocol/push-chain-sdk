export enum ChainType {
  ETHEREUM = 'ethereum',
  SOLANA = 'solana',
  BINANCE = 'binance',
  ARBITRUM = 'arbitrum',
}
export interface WalletInfo {
  address: string;
  chainType: ChainType;
  providerName: string;
}

export interface IWalletProvider {
  name: string;
  icon: string;
  supportedChains: ChainType[];
  connect(chainType?: ChainType): Promise<{ caipAddress: string }>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  disconnect(): Promise<void>;
}
