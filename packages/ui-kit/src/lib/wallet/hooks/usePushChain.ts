import { useEffect, useState } from 'react';
import { CONSTANTS, PushChain, createUniversalSigner } from '@pushchain/devnet';
import { usePushWalletContext } from '../components/PushWalletProvider';
import { ENV } from '../../config';

export const usePushChain = (custom_rpc_url?: string) => {
    const { universalAddress, handleSignMessage, env } = usePushWalletContext();
    const [pushChain, setPushChain] = useState<PushChain | null>(null);
    const [error, setError] = useState<Error | null>(null);



    useEffect(() => {
        const initializePushChain = async () => {
            if (!universalAddress) {
                setPushChain(null);
                return;
            }

            try {
                const signer = createUniversalSigner({
                    address: universalAddress.address,
                    chain: universalAddress.chain,
                    chainId: universalAddress.chainId,
                    signMessage: async (data: Uint8Array) => {
                        return await handleSignMessage(data);
                    },
                });

                // Push Chain is only initialized at devnet and mainnet
                const pushChainNetwork = env === ENV.LOCAL || env === ENV.TESTNET ? CONSTANTS.ENV.DEVNET : env;

                const instance = await PushChain.initialize(signer, {
                    network: pushChainNetwork,
                    ...(custom_rpc_url && { rpcUrl: custom_rpc_url })
                });

                setPushChain(instance);
                setError(null);
            } catch (err) {
                console.log("Error occured when initialising Push chain", err);
                setError(err instanceof Error ? err : new Error('Failed to initialize PushChain'));
                setPushChain(null);
            }
        };

        initializePushChain();
    }, [universalAddress, custom_rpc_url]);

    return {
        pushChain,
        error,
        isLoading: !pushChain && !error,
    };
};
