import { toCAIPFormat } from './helpers/address';
import {
  ChainType,
  IWalletProvider,
  ITypedData,
} from '../../types/wallet.types';

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
  abstract signAndSendTransaction(txn: Uint8Array): Promise<Uint8Array>;
  abstract signTypedData(typedData: ITypedData): Promise<Uint8Array>;
  abstract disconnect(): Promise<void>;
  abstract getChainId(): Promise<unknown>;

  protected formatAddress(
    rawAddress: string,
    chainType: ChainType,
    chainId: number
  ): { caipAddress: string } {
    const caipAddress = toCAIPFormat(rawAddress, chainType, chainId);
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
