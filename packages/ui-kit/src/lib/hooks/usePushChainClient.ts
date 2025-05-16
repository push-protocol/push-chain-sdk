// hooks/usePushChainClient.ts (use uid?:string in the future as prop)

import { CONSTANTS, PushChain, createUniversalSigner } from '@pushchain/devnet';
import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState } from 'react';
import { ENV } from '../constants';

export const usePushChainClient = (uid?: string) => {
  const { config, universalAddress, handleSignMessage } =
    usePushWalletContext(uid);
  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // initialise Push Chain instance here and export that
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
        const pushChainNetwork =
          config.env === ENV.LOCAL || config.env === ENV.TESTNET
            ? CONSTANTS.ENV.DEVNET
            : config.env;

        const instance = await PushChain.initialize(signer, {
          network: pushChainNetwork,
          rpcUrl: config.rpcURL,
        });

        console.log('Push Chain Initialised', instance);

        setPushChain(instance);
        setError(null);
      } catch (err) {
        console.log('Error occured when initialising Push chain', err);
        setError(
          err instanceof Error
            ? err
            : new Error('Failed to initialize PushChain')
        );
        setPushChain(null);
      }
    };

    initializePushChain();
  }, [universalAddress]);

  return {
    pushChain,
    error,
    isLoading: !pushChain && !error,
  };
};
