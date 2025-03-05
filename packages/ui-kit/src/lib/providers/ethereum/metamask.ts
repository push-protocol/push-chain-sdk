import { MetaMaskSDK } from '@metamask/sdk';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType } from '../types/wallet.types';

export class MetamaskProvider extends BaseWalletProvider {
  private sdk: MetaMaskSDK;

  constructor() {
    super('MetaMask', 'https://metamask.io/images/metamask-fox.svg', [
      ChainType.ETHEREUM,
    ]);
    this.sdk = new MetaMaskSDK({
      dappMetadata: {
        name: 'Your Dapp Name',
        url: window.location.href,
      },
    });
  }

  isInstalled = async (): Promise<boolean> => {
    const provider = this.sdk.getProvider();
    return !!provider;
  };

  async connect(): Promise<{ caipAddress: string }> {
    try {
      const accounts = await this.sdk.connect();

      const rawAddress = accounts[0];

      const addressincaip = this.formatAddress(rawAddress, ChainType.ETHEREUM);
      return addressincaip;
    } catch (error) {
      console.error('Failed to connect to MetaMask:', error);
      throw error;
    }
  }

  getProvider = () => {
    return this.sdk.getProvider();
  };

  getChainId = async (): Promise<unknown> => {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Provider is undefined');
    }
    const chainId = await provider.request({
      method: 'eth_chainId',
      params: [],
    });
    return chainId;
  };

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
      console.log('Signature inside metamask', signature);

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

    //TODO: reload the dapp after disconnecting the wallet
  };
}
