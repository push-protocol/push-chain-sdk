import { BrowserProvider, getAddress } from 'ethers';
import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';
import {
  bytesToHex,
  hexToBytes,
  parseTransaction,
  toHex,
  type Chain,
} from 'viem';

import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType, ITypedData } from '../../../types/wallet.types';
import { chains } from './chains';
import { getEIP6963ProviderByRdns } from '../utils/eip6963';
import { signAuthorizationWithEthersSigner } from './signAuthorization';

export class ZerionProvider extends BaseWalletProvider {
  constructor() {
    super('Zerion', 'https://zerion.io/favicon.ico', [
      ChainType.ETHEREUM,
      ChainType.ARBITRUM,
      ChainType.BASE,
      ChainType.BINANCE,
      ChainType.PUSH_WALLET,
    ]);
  }

  isInstalled = async (): Promise<boolean> => {
    try {
      return !!this.getProvider();
    } catch {
      return false;
    }
  };

  private getProvider = () => {
    const provider = getEIP6963ProviderByRdns('io.zerion.wallet');
    if (!provider) {
      throw new Error('Zerion provider not found via EIP-6963');
    }
    return provider;
  };

  getSigner = async () => {
    const provider = this.getProvider();
    const browserProvider = new BrowserProvider(provider);
    return await browserProvider.getSigner();
  };

  getChainId = async (): Promise<number> => {
    const provider = this.getProvider();
    const hexChainId = await provider.request({
      method: 'eth_chainId',
      params: [],
    });

    return parseInt(hexChainId.toString(), 16);
  };

  connect = async (chainType: ChainType): Promise<{ caipAddress: string }> => {
    const provider = this.getProvider();

    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
      params: [],
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No Zerion account returned');
    }

    const checksumAddress = getAddress(accounts[0]);

    await this.switchNetwork(chainType);
    const chainId = await this.getChainId();

    const caipAddress = this.formatAddress(
      checksumAddress,
      ChainType.ETHEREUM,
      chainId
    );

    return caipAddress;
  };

  switchNetwork = async (chainName: ChainType) => {
    const network = chains[chainName] as Chain;
    const provider = this.getProvider();

    const hexNetworkId = toHex(network.id);

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexNetworkId }],
      });
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      const needAdd =
        err?.code === 4902 ||
        err?.code === -32603 ||
        msg.includes('Unrecognized chain ID');

      if (!needAdd) {
        console.error('Zerion: error switching network:', err);
        throw err;
      }

      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexNetworkId,
              chainName: network.name,
              rpcUrls: network.rpcUrls.default.http,
              nativeCurrency: network.nativeCurrency,
              blockExplorerUrls: network.blockExplorers?.default?.url
                ? [network.blockExplorers.default.url]
                : [],
            },
          ],
        });

        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexNetworkId }],
        });
      } catch (addError) {
        console.error('Zerion: error adding network:', addError);
        throw addError;
      }
    }
  };

  signAndSendTransaction = async (txn: Uint8Array): Promise<Uint8Array> => {
    const provider = this.getProvider();

    const accounts = (await provider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No connected Zerion account');
    }

    const hex = bytesToHex(txn);
    const parsed = parseTransaction(hex);

    // Deliberately omit gas / maxFeePerGas / maxPriorityFeePerGas: those were
    // estimated by Core against its own RPC, which can disagree with (or go
    // stale relative to) whatever RPC Zerion itself broadcasts through,
    // causing spurious -32003 "Transaction rejected" errors after the user
    // has already approved. Letting Zerion estimate gas/fees itself, against
    // its own RPC, right before it broadcasts, avoids that estimate-vs-
    // broadcast mismatch entirely.
    const txParams = {
      from: accounts[0],
      to: parsed.to,
      value: parsed.value ? '0x' + parsed.value.toString(16) : undefined,
      data: parsed.data,
    };

    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [txParams],
    });

    return hexToBytes(txHash as `0x${string}`);
  };

  signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    const provider = this.getProvider();

    const accounts = (await provider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No connected Zerion account');
    }

    const hexMessage = bytesToHex(message);

    const signature = await provider.request({
      method: 'personal_sign',
      params: [hexMessage, accounts[0]],
    });

    return hexToBytes(signature as `0x${string}`);
  };

  signTypedData = async (typedData: ITypedData): Promise<Uint8Array> => {
    const provider = this.getProvider();

    const accounts = (await provider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No connected Zerion account');
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
  };

  signAuthorization = async (
    params: SignAuthorizationParams
  ): Promise<SignedAuthorization> => {
    const signer = await this.getSigner();
    return signAuthorizationWithEthersSigner(signer, params);
  };

  disconnect = async () => {
    const provider = getEIP6963ProviderByRdns('io.zerion.wallet');
    if (!provider) return;

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
