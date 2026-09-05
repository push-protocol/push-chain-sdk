import { getAddress } from 'ethers';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType, ITypedData } from '../../../types/wallet.types';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  bytesToHex,
  createWalletClient,
  custom,
  hexToBytes,
  parseTransaction,
} from 'viem';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { sepolia } from 'viem/chains';
import {
  isMobileDevice,
  openPhantomMobileBrowser,
  shouldOpenPhantomMobileBrowser,
} from './phantomMobile';

declare global {
  interface Window {
    phantom?: {
      ethereum?: {
        isConnected?: boolean;
        request: (args: { method: string; params?: any[] }) => Promise<any>;
      };
      solana?: {
        isConnected?: boolean;
        chainId?: number;
        connect: () => Promise<{ publicKey: { toString: () => string } }>;
        disconnect: () => Promise<void>;
        signMessage: (
          message: Uint8Array,
          encoding: string
        ) => Promise<{ signature: Uint8Array }>;
        signAndSendTransaction: (
          txn: Transaction | VersionedTransaction
        ) => Promise<{ signature: string } | string>;
      };
    };
    ethereum?: any;
  }
}

export class PhantomProvider extends BaseWalletProvider {
  constructor() {
    super('Phantom', 'https://www.phantom.app/img/logo.png', [
      ChainType.ETHEREUM,
      ChainType.SOLANA,
    ]);
  }

  private connectedChainType: ChainType | null = null;

  isInstalled = async (): Promise<boolean> => {
    return (
      typeof window !== 'undefined' &&
      (typeof window.phantom !== 'undefined' || isMobileDevice())
    );
  };

  private connectEthereum = async (): Promise<{ caipAddress: string }> => {
    if (!window.phantom?.ethereum) {
      throw new Error('Phantom not installed for Ethereum');
    }

    const provider = window.phantom?.ethereum;
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const rawAddress = accounts[0];

    const checksumAddress = getAddress(rawAddress);

    const chainId = await this.getChainId(ChainType.ETHEREUM);

    this.connectedChainType = ChainType.ETHEREUM;

    const caipAddress = this.formatAddress(
      checksumAddress,
      ChainType.ETHEREUM,
      chainId
    );
    return caipAddress;
  };

  private connectSolana = async (): Promise<{ caipAddress: string }> => {
    if (!window.phantom?.solana) {
      if (shouldOpenPhantomMobileBrowser(ChainType.SOLANA)) {
        openPhantomMobileBrowser(ChainType.SOLANA);
        return new Promise<{ caipAddress: string }>(() => undefined);
      }

      throw new Error('Phantom not installed for Solana');
    }

    const provider = window.phantom?.solana;
    const accounts = await provider.connect();

    const chainId = await this.getChainId(ChainType.SOLANA);

    this.connectedChainType = ChainType.SOLANA;

    const caipAddress = this.formatAddress(
      accounts.publicKey.toString(),
      ChainType.SOLANA,
      chainId
    );

    return caipAddress;
  };

  connect = async (chainType?: ChainType): Promise<{ caipAddress: string }> => {
    let account;
    if (!chainType || chainType === ChainType.SOLANA) {
      account = this.connectSolana();
    } else if (chainType === ChainType.ETHEREUM) {
      account = this.connectEthereum();
    }

    if (!account) {
      throw new Error('Error in connecting to phantom');
    }

    return account;
  };

  getChainId = async (chainType?: ChainType): Promise<number> => {
    if (chainType === ChainType.ETHEREUM) {
      const provider = window.phantom?.ethereum;
      if (!provider) throw new Error('No Phantom Ethereum wallet connected');
      const chainId = await provider.request({ method: 'eth_chainId' });
      return parseInt(chainId, 16);
    } else if (chainType === ChainType.SOLANA) {
      const provider = window.phantom?.solana;
      if (!provider) throw new Error('No Phantom Solana wallet connected');

      return provider.chainId || 1;
    }
    throw new Error('No Phantom wallet connected');
  };

  signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    const isInstalled = await this.isInstalled();
    if (!isInstalled) {
      throw new Error('No Phantom wallet installed');
    }

    if (
      this.connectedChainType === ChainType.SOLANA &&
      window.phantom?.solana
    ) {
      try {
        const provider = window.phantom?.solana;
        const signedMessage = await provider.signMessage(message, 'utf8');

        return signedMessage.signature;
      } catch (error) {
        console.error('Phantom Solana signing error:', error);
        throw error;
      }
    } else if (
      this.connectedChainType === ChainType.ETHEREUM &&
      window.phantom?.ethereum
    ) {
      try {
        const provider = window.phantom?.ethereum;

        const accounts = await provider.request({
          method: 'eth_accounts',
        });

        if (!accounts || accounts.length === 0) {
          throw new Error('No connected account');
        }

        const hexMessage = bytesToHex(message);

        const signature = await provider.request({
          method: 'personal_sign',
          params: [hexMessage, accounts[0]],
        });

        return hexToBytes(signature as `0x${string}`);
      } catch (error) {
        console.error('Phantom Ethereum signing error:', error);
        throw error;
      }
    } else {
      throw new Error('No Phantom wallet connected');
    }
  };

  signAndSendTransaction = async (txn: Uint8Array): Promise<Uint8Array> => {
    const isInstalled = await this.isInstalled();
    if (!isInstalled) {
      throw new Error('No Phantom wallet installed');
    }

    if (
      this.connectedChainType === ChainType.SOLANA &&
      window.phantom?.solana
    ) {
      try {
        const provider = window.phantom?.solana;

        // VersionedTransaction.deserialize handles both legacy and v0 transactions.
        // Check the deserialized message version to decide the appropriate type
        // for Phantom's signAndSendTransaction.
        const deserialized = VersionedTransaction.deserialize(txn);
        let transaction: Transaction | VersionedTransaction;
        if (deserialized.message.version === 'legacy') {
          transaction = Transaction.from(txn);
        } else {
          transaction = deserialized;
        }

        const signedTransaction = await provider.signAndSendTransaction(
          transaction
        );
        const signature =
          typeof signedTransaction === 'string'
            ? signedTransaction
            : signedTransaction.signature;

        return bs58.decode(signature);
      } catch (error) {
        console.error('Phantom Solana signing error:', error);
        throw error;
      }
    } else if (
      this.connectedChainType === ChainType.ETHEREUM &&
      window.phantom?.ethereum
    ) {
      try {
        const provider = window.phantom?.ethereum;

        const accounts = await provider.request({
          method: 'eth_accounts',
        });

        if (!accounts || accounts.length === 0) {
          throw new Error('No connected account');
        }

        const hex = bytesToHex(txn);
        const parsed = parseTransaction(hex);

        const txParams = {
          from: accounts[0],
          to: parsed.to,
          value: parsed.value ? '0x' + parsed.value.toString(16) : undefined,
          data: parsed.data,
          gas: parsed.gas ? '0x' + parsed.gas.toString(16) : undefined,
          maxPriorityFeePerGas: parsed.maxPriorityFeePerGas
            ? '0x' + parsed.maxPriorityFeePerGas.toString(16)
            : undefined,
          maxFeePerGas: parsed.maxFeePerGas
            ? '0x' + parsed.maxFeePerGas.toString(16)
            : undefined,
        };

        const signature = await provider.request({
          method: 'eth_sendTransaction',
          params: [txParams],
        });

        return hexToBytes(signature as `0x${string}`);
      } catch (error) {
        console.error('Phantom Ethereum signing error:', error);
        throw error;
      }
    } else {
      throw new Error('No Phantom wallet connected');
    }
  };

  signTypedData = async (typedData: ITypedData): Promise<Uint8Array> => {
    const isInstalled = await this.isInstalled();
    if (!isInstalled) {
      throw new Error('No Phantom wallet installed');
    }

    if (
      this.connectedChainType === ChainType.SOLANA &&
      window.phantom?.solana
    ) {
      throw new Error('signTypedData is not implemented for this provider');
    } else if (
      this.connectedChainType === ChainType.ETHEREUM &&
      window.phantom?.ethereum
    ) {
      try {
        const walletClient = createWalletClient({
          chain: sepolia,
          transport: custom(window.ethereum!),
        });

        const accounts = await walletClient.request({
          method: 'eth_accounts',
        });

        if (!accounts || accounts.length === 0) {
          throw new Error('No connected account');
        }

        const signature = await walletClient.signTypedData({
          account: accounts[0],
          ...typedData,
        });

        return hexToBytes(signature);
      } catch (error) {
        console.error('Phantom Ethereum signing error:', error);
        throw error;
      }
    } else {
      throw new Error('No Phantom wallet connected');
    }
  };

  disconnect = async (): Promise<void> => {
    const isInstalled = await this.isInstalled();
    if (!isInstalled) return;

    if (
      this.connectedChainType === ChainType.SOLANA &&
      window.phantom?.solana
    ) {
      const provider = window.phantom?.solana;
      this.connectedChainType = null;
      await provider.disconnect();
    }

    if (
      this.connectedChainType === ChainType.ETHEREUM &&
      window.phantom?.ethereum
    ) {
      this.connectedChainType = null;
      //TODO: find how to disconnect ethereum
    }

    return Promise.resolve();
  };
}
