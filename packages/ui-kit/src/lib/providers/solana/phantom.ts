import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType } from '../types/wallet.types';

export class PhantomProvider extends BaseWalletProvider {
  constructor() {
    super('Phantom', 'https://www.phantom.app/img/logo.png', [
      ChainType.ETHEREUM,
      ChainType.SOLANA,
    ]);
  }

  isInstalled = async (): Promise<boolean> => {
    return (
      typeof window !== 'undefined' && typeof window.phantom !== 'undefined'
    );
  };

  private connectEthereum = async (): Promise<{ caipAddress: string }> => {
    if (!window.phantom || !window.phantom?.ethereum) {
      throw new Error('Phantom not installed for Ethereum');
    }

    const provider = window.phantom?.ethereum;
    const accounts = await provider.request({ method: 'eth_requestAccounts' });

    const caipAddress = this.formatAddress(accounts, ChainType.ETHEREUM);
    return caipAddress;
  };

  private connectSolana = async (): Promise<{ caipAddress: string }> => {
    if (!window.phantom || !window.phantom?.solana) {
      throw new Error('Phantom not installed for Ethereum');
    }

    const provider = window.phantom?.solana;
    const accounts = await provider.connect();

    const caipAddress = this.formatAddress(
      accounts.publicKey.toString(),
      ChainType.SOLANA
    );

    return caipAddress;
  };

  connect = async (chainType?: ChainType): Promise<{ caipAddress: string }> => {
    let account;
    if (!chainType || chainType === 'solana') {
      account = this.connectSolana();
    } else if (chainType === 'ethereum') {
      account = this.connectEthereum();
    }

    if (!account) {
      throw new Error('Error in connecting to phantom');
    }

    return account;
  };

  signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    const isInstalled = this.isInstalled();
    if (!isInstalled) {
      throw new Error('No Phantom wallet installed');
    }

    if (window.phantom.solana && window.phantom.solana.isConnected) {
      try {
        const provider = window.phantom?.solana;
        const signedMessage = await provider.signMessage(message, 'utf8');

        return signedMessage.signature;
      } catch (error) {
        console.error('Phantom Solana signing error:', error);
        throw error;
      }
    } else if (window.phantom.ethereum && window.phantom.ethereum.isConnected) {
      try {
        const provider = window.phantom?.ethereum;

        const accounts = await provider.request({
          method: 'eth_accounts',
        });

        if (!accounts || accounts.length === 0) {
          throw new Error('No connected account');
        }

        const hexMessage = '0x' + Buffer.from(message).toString('hex');

        const signature = await provider.request({
          method: 'personal_sign',
          params: [hexMessage, accounts[0]],
        });

        return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
      } catch (error) {
        console.error('Phantom Ethereum signing error:', error);
        throw error;
      }
    } else {
      throw new Error('No Phantom wallet connected');
    }
  };

  disconnect = async (): Promise<void> => {
    const isInstalled = this.isInstalled();
    if (!isInstalled) return;

    if (window.phantom.solana.isConnected) {
      const provider = window.phantom?.solana;
      await provider.disconnect();
    }

    if (window.phantom.ethereum.isConnected) {
      //TOOD: find how to disconnect ethereum
    }

    return Promise.resolve();
  };
}
