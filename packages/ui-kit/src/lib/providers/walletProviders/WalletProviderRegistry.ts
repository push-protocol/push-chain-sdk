import { MetamaskProvider } from './ethereum/metamask';
import { PhantomProvider } from './solana/phantom';
import { ChainType, IWalletProvider } from '../../types/wallet.types';
import { WalletConnectProvider } from './ethereum/walletconnect';

class WalletProviderRegistry {
  private providers: Map<string, IWalletProvider> = new Map();
  private chainProviders: Map<ChainType, IWalletProvider[]> = new Map();

  constructor() {
    this.registerProvider(new MetamaskProvider());
    this.registerProvider(new PhantomProvider());
    this.registerProvider(new WalletConnectProvider());
  }

  registerProvider(provider: IWalletProvider): void {
    this.providers.set(provider.name, provider);

    provider.supportedChains.forEach((chain) => {
      if (!this.chainProviders.has(chain)) {
        this.chainProviders.set(chain, []);
      }
      this.chainProviders.get(chain)?.push(provider);
    });
  }

  getProvider(name: string): IWalletProvider | undefined {
    return this.providers.get(name);
  }

  getProvidersByChain(chain: ChainType): IWalletProvider[] {
    return this.chainProviders.get(chain) || [];
  }

  getAllProviders(): IWalletProvider[] {
    return Array.from(this.providers.values());
  }

  getAllSupportedChains(): ChainType[] {
    return Array.from(this.chainProviders.keys());
  }
}

export const walletRegistry = new WalletProviderRegistry();
