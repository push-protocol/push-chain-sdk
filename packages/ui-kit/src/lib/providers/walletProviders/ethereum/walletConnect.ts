import { EthereumProvider } from '@walletconnect/ethereum-provider';
import { getAddress } from 'ethers';
import { BaseWalletProvider } from '../BaseWalletProvider';
import { ChainType } from '../../../types/wallet.types';
import * as chains from 'viem/chains';
import { toHex } from 'viem';

export class WalletConnectProvider extends BaseWalletProvider {
    private provider: InstanceType<typeof EthereumProvider> | null = null;

    constructor() {
        super('WalletConnect', 'https://walletconnect.com/walletconnect-logo.svg', [
            ChainType.WALLET_CONNECT,
        ]);
    }

    isInstalled = async (): Promise<boolean> => {
        return true; // WalletConnect doesn't require installation
    };

    getProvider = () => {
        if (!this.provider) {
            throw new Error('WalletConnect provider not initialized');
        }
        return this.provider;
    };

    private async initProvider(chainId: number) {
        console.log("Provder >>", this.provider);

        if (this.provider) {
            return;
        }

        console.log("Provider intiialisation started", chainId);

        this.provider = await EthereumProvider.init({
            projectId: "575a3e339ad56f54669c32264c133172",
            chains: [chainId],
            methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData'],
            showQrModal: true,
        });

        console.log("This,provider ", this.provider);

        await this.provider.enable();

    }

    async connect(): Promise<{ caipAddress: string }> {
        const chain = chains['mainnet'] as chains.Chain;
        const chainId = chain.id;

        console.log("Chain Id", chain);
        console.log("Initialising provider");

        await this.initProvider(chainId);

        console.log("Provider initialised", this.provider);

        const accounts = await this.provider!.request({ method: 'eth_requestAccounts' });

        const rawAddress = accounts[0];
        const checksumAddress = getAddress(rawAddress);

        const caipAddress = this.formatAddress(checksumAddress, ChainType.ETHEREUM, chainId);
        return caipAddress;
    }

    getChainId = async (): Promise<number> => {
        const provider = this.getProvider();
        const hexChainId = await provider.request({ method: 'eth_chainId' });
        return parseInt(hexChainId.toString(), 16);
    };

    switchNetwork = async (chainType: ChainType) => {
        const validatedChain = this.validateChainType(chainType);
        const provider = this.getProvider();
        const network = (chains as Record<string, chains.Chain>)[validatedChain];
        const hexChainId = toHex(network.id);

        try {
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: hexChainId }],
            });
        } catch (err: any) {
            if (err.code === 4902) {
                try {
                    await provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [
                            {
                                chainId: hexChainId,
                                chainName: network.name,
                                rpcUrls: network.rpcUrls.default.http,
                                nativeCurrency: network.nativeCurrency,
                                blockExplorerUrls: [network?.blockExplorers?.default.url],
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

    signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
        const provider = this.getProvider();
        const accounts = await provider.request({ method: 'eth_accounts' });

        if (!accounts || accounts.length === 0) {
            throw new Error('No connected account');
        }

        const hexMessage = '0x' + Buffer.from(message).toString('hex');

        const signature = await provider.request({
            method: 'personal_sign',
            params: [hexMessage, accounts[0]],
        });

        return new Uint8Array(Buffer.from((signature as string).slice(2), 'hex'));
    };

    disconnect = async () => {
        const provider = this.getProvider();
        if (provider && typeof provider.disconnect === 'function') {
            await provider.disconnect();
        }
    };

}
