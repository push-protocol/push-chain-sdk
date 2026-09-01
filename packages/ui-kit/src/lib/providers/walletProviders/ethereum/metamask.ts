import { MetaMaskSDK } from '@metamask/sdk';
import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType, ITypedData } from '../../../types/wallet.types';
import { BrowserProvider, getAddress } from 'ethers';
import { HexString } from 'ethers/lib.commonjs/utils/data';
import { chains } from './chains';
import { bytesToHex, Chain, hexToBytes, parseTransaction, toHex } from 'viem';
import { signAuthorizationWithEthersSigner } from './signAuthorization';

export class MetamaskProvider extends BaseWalletProvider {
  private sdk: MetaMaskSDK;

  constructor() {
    super('MetaMask', 'https://metamask.io/images/metamask-fox.svg', [
      ChainType.ETHEREUM,
      ChainType.ARBITRUM,
      ChainType.BASE,
      ChainType.BINANCE,
      ChainType.PUSH_WALLET,
    ]);
    this.sdk = new MetaMaskSDK({
      dappMetadata: {
        url: 'https://push.org/',
      }
    });
  }

  isInstalled = async (): Promise<boolean> => {
    const provider = this.sdk.getProvider();
    return !!provider;
  };

  getProvider = () => {
    return this.sdk.getProvider();
  };

  getSigner = async () => {
    const sdkProvider = this.sdk.getProvider();
    if (!sdkProvider) {
      throw new Error('Provider is undefined');
    }
    const browserProvider = new BrowserProvider(sdkProvider);
    return await browserProvider.getSigner();
  };

  async connect(chainType: ChainType): Promise<{ caipAddress: string }> {
    try {
      const accounts = await this.sdk.connect();
      const rawAddress = accounts[0];
      const checksumAddress = getAddress(rawAddress);

      await this.switchNetwork(chainType);

      const chainId = await this.getChainId();

      const addressincaip = this.formatAddress(
        checksumAddress,
        ChainType.ETHEREUM,
        chainId
      );

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
    const hexChainId = (await provider.request({
      method: 'eth_chainId',
      params: [],
    })) as HexString;

    const chainId = parseInt(hexChainId.toString(), 16);
    return chainId;
  };

  switchNetwork = async (chainName: ChainType) => {
    const network = chains[chainName] as Chain;
    const provider = this.getProvider();

    if (!provider)
      throw new Error('Provider not found while switching network');

    const hexNetworkId = toHex(network.id);

    try {
      // Try to switch to the network
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexNetworkId }],
      });
    } catch (err) {
      // If the error code is 4902, the network needs to be added
      if ((err as any).code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: hexNetworkId,
                chainName: network.name,
                rpcUrls: network.rpcUrls.default.http,
                nativeCurrency: network.nativeCurrency,
                blockExplorerUrls: network.blockExplorers?.default.url,
              },
            ],
          });
        } catch (addError) {
          console.error('Error adding network:', addError);
          throw addError;
        }
      } else {
        console.error('Error switching network:', err);
        throw err;
      }
    }
  };

  signAndSendTransaction = async (txn: Uint8Array): Promise<Uint8Array> => {
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

      const hex = bytesToHex(txn);
      const parsed = parseTransaction(hex);

      // Deliberately omit gas / maxFeePerGas / maxPriorityFeePerGas: those
      // were estimated by Core against its own RPC, which can disagree with
      // (or go stale relative to) whatever RPC MetaMask itself broadcasts
      // through, causing spurious -32003 "Transaction rejected" errors after
      // the user has already approved. Letting MetaMask estimate gas/fees
      // itself, against its own RPC, right before it broadcasts, avoids that
      // estimate-vs-broadcast mismatch entirely.
      const txParams = {
        from: accounts[0],
        to: parsed.to,
        value: parsed.value ? '0x' + parsed.value.toString(16) : undefined,
        data: parsed.data,
      };

      const signature = await provider.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
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

      const hexMessage = bytesToHex(message);

      const signature = await provider.request({
        method: 'personal_sign',
        params: [hexMessage, accounts[0]],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  signTypedData = async (typedData: ITypedData): Promise<Uint8Array> => {
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

      typedData.types = {
        EIP712Domain: [
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...(typedData.primaryType === 'MigrationPayload'
          ? { MigrationPayload: typedData.types['MigrationPayload'] }
          : { UniversalPayload: typedData.types['UniversalPayload'] }),
      };

      const safeTypedData = JSON.parse(
        JSON.stringify(typedData, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        )
      );

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [accounts[0], JSON.stringify(safeTypedData)],
      });

      return hexToBytes(signature as `0x${string}`);
    } catch (error) {
      console.error('MetaMask signing error:', error);
      throw error;
    }
  };

  signAuthorization = async (
    params: SignAuthorizationParams
  ): Promise<SignedAuthorization> => {
    const signer = await this.getSigner();
    return signAuthorizationWithEthersSigner(signer, params);
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
