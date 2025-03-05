import { formatCAIP10Address } from './helpers/address';
import { ChainType, IWalletProvider } from './types/wallet.types';

export abstract class BaseWalletProvider implements IWalletProvider {
  public readonly name: string;
  public readonly icon: string;
  public readonly supportedChains: ChainType[];

  constructor(name: string, icon: string, supportedChains: ChainType[]) {
    this.name = name;
    this.icon = icon;
    this.supportedChains = supportedChains;
  }

  abstract connect(chainType?: ChainType): Promise<{ caipAddress: string }>;
  abstract signMessage(message: Uint8Array): Promise<Uint8Array>;
  abstract disconnect(): Promise<void>;

  protected formatAddress(
    rawAddress: string,
    chainType: ChainType
  ): { caipAddress: string } {
    const caipAddress = formatCAIP10Address(rawAddress, chainType);
    return { caipAddress };
  }

  protected validateChainType(chainType?: ChainType): ChainType {
    if (!chainType && this.supportedChains.length === 1) {
      return this.supportedChains[0];
    }

    if (chainType && !this.supportedChains.includes(chainType)) {
      throw new Error(`${this.name} does not support ${chainType}`);
    }

    return chainType as ChainType;
  }
}
