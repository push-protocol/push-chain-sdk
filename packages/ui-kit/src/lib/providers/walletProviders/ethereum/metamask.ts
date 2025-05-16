import { MetaMaskSDK } from '@metamask/sdk';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType } from '../../../types/wallet.types';
import { getAddress } from 'ethers';
import { HexString } from 'ethers/lib.commonjs/utils/data';
import * as chains from "viem/chains";
import { toHex } from "viem";


export class MetamaskProvider extends BaseWalletProvider {
  private sdk: MetaMaskSDK;

  constructor() {
    super('MetaMask', 'https://metamask.io/images/metamask-fox.svg', [
      ChainType.ETHEREUM,
      ChainType.ARBITRUM,
      ChainType.AVALANCHE,
      ChainType.BINANCE
    ]);
    this.sdk = new MetaMaskSDK();
  }

  isInstalled = async (): Promise<boolean> => {
    const provider = this.sdk.getProvider();
    return !!provider;
  };

  getProvider = () => {
    return this.sdk.getProvider();
  };

  async connect(chainType: ChainType): Promise<{ caipAddress: string }> {
    try {
      const accounts = await this.sdk.connect();
      const rawAddress = accounts[0];
      const checksumAddress = getAddress(rawAddress);

      await this.switchNetwork(chainType);

      const chainId = await this.getChainId();

      const addressincaip = this.formatAddress(checksumAddress, ChainType.ETHEREUM, chainId);

      return addressincaip;
    } catch (error) {
      console.error('Failed to connect to MetaMask:', error);
      throw error;
    }
  }

  getChainId = async (): Promise<number> => {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Provider is undefined');
    }
    const hexChainId = await provider.request({
      method: 'eth_chainId',
      params: [],
    }) as HexString;

    const chainId = parseInt(hexChainId.toString(), 16);
    return chainId;
  };

  switchNetwork = async (chainName: ChainType) => {
    const network = (chains as Record<string, chains.Chain>)[chainName];
    const provider = this.getProvider();

    if (!provider) throw new Error('Provider not found while switching network');

    const hexNetworkId = toHex(network.id);

    try {
      // Try to switch to the network
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexNetworkId }]
      });
    } catch (err) {
      // If the error code is 4902, the network needs to be added
      if ((err as any).code === 4902) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: hexNetworkId,
              chainName: network.name,
              rpcUrls: network.rpcUrls.default.http,
              nativeCurrency: network.nativeCurrency,
              blockExplorerUrls: network.blockExplorers?.default.url
            }]
          });
        } catch (addError) {
          console.error("Error adding network:", addError);
          throw addError
        }
      } else {
        console.error("Error switching network:", err);
        throw err;
      }
    }

  }

  signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    try {
      const provider = this.getProvider();
      if (!provider) {
        throw new Error('Provider is undefined');
      }
      const accounts = (await provider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error('No connected account');
      }

      const hexMessage = '0x' + Buffer.from(message).toString('hex');

      const signature = await provider.request({
        method: 'personal_sign',
        params: [hexMessage, accounts[0]],
      });

      return new Uint8Array(Buffer.from((signature as string).slice(2), 'hex'));
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  disconnect = async () => {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Provider is undefined');
    }
    await provider.request({
      method: 'wallet_revokePermissions',
      params: [
        {
          eth_accounts: {},
        },
      ],
    });
  };
}
