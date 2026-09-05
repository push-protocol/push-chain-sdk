import { PushChain } from '@pushchain/core';
import { PROGRESS_HOOK, ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import { usePushWalletContext } from './usePushWallet';
import { useEffect, useState, useRef } from 'react';
import { createGuardedPushChain } from '../helpers/txnAuthGuard';
import { constructPushChainSigner } from './constructPushChainSigner';

export const usePushChainClient = (uid?: string) => {
  const {
    universalAccount,
    handleSignMessage,
    handleSignAndSendTransaction,
    handleSignTypedData,
    handleSignAuthorization,
    handleExternalWalletConnection,
    requestPushWalletConnection,
    config,
    setProgress,
    isReadOnly,
    setIsReadOnly,
    checkAndShowUpgradeIfNeeded,
  } = usePushWalletContext(uid);

  const [pushChain, setPushChain] = useState<PushChain | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const MIN_VISIBLE_MS = 50;
  const SUCCESS_HIDE_MS = 10000;

  const queueRef = useRef<ProgressEvent[]>([]);
  const lockRef = useRef(false);
  const upgradeCheckRef = useRef(false);

  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearProgressTimers = () => {
    if (minTimerRef.current) {
      clearTimeout(minTimerRef.current);
      minTimerRef.current = null;
    }
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  };

  const showProgress = (p: ProgressEvent) => {
    clearProgressTimers();

    setProgress(p);

    lockRef.current = true;
    minTimerRef.current = setTimeout(() => {
      lockRef.current = false;
      minTimerRef.current = null;

      if (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (next) showProgress(next);
      }
    }, MIN_VISIBLE_MS);

    if (
      p.id === PROGRESS_HOOK.SEND_TX_199_01 ||
      p.id === PROGRESS_HOOK.SEND_TX_299_01 ||
      p.id === PROGRESS_HOOK.SEND_TX_399_01 ||
      p.id === PROGRESS_HOOK.SEND_TX_999_01 ||
      p.id === PROGRESS_HOOK.UEA_MIG_9901
    ) {
      successTimerRef.current = setTimeout(() => setProgress(null), SUCCESS_HIDE_MS);
    }
  };

  useEffect(() => {
    const initializePushChain = async () => {
      if (!universalAccount) {
        setPushChain(null);
        return;
      }

      const CHAINS = PushChain.CONSTANTS.CHAIN;

      const isSolana = [
        CHAINS.SOLANA_DEVNET,
        CHAINS.SOLANA_MAINNET,
        CHAINS.SOLANA_TESTNET,
      ].includes(universalAccount.chain);

      try {
        const signerSkeleton = constructPushChainSigner(
          universalAccount,
          isSolana,
          {
            signMessage: handleSignMessage,
            signAndSendTransaction: handleSignAndSendTransaction,
            signTypedData: handleSignTypedData,
            signAuthorization: handleSignAuthorization,
          }
        );

        const universalSigner = await PushChain.utils.signer.toUniversal(signerSkeleton);

        const intializeProps = {
          network: config.network,

          progressHook: async (progress: ProgressEvent) => {
            if (successTimerRef.current) {
              clearTimeout(successTimerRef.current);
            }
            setProgress(progress);
            console.log("Progress:", progress);
            if (
              progress.id === PROGRESS_HOOK.SEND_TX_199_01 ||
              progress.id === PROGRESS_HOOK.SEND_TX_299_01 ||
              progress.id === PROGRESS_HOOK.SEND_TX_399_01 ||
              progress.id === PROGRESS_HOOK.SEND_TX_999_01 ||
              progress.id === PROGRESS_HOOK.UEA_MIG_9901
            ) {
              successTimerRef.current = setTimeout(() => setProgress(null), SUCCESS_HIDE_MS);
            }
          },

          rpcUrls: config.chainConfig?.rpcUrls,
          blockExplorers: config.chainConfig?.blockExplorers,
          printTraces: config.chainConfig?.printTraces,
        };

        let pushChainClient: PushChain;

        if (isReadOnly) {
          pushChainClient = await PushChain.initialize(universalAccount, {
            network: config.network,
          });

          
        } else {
          pushChainClient = await PushChain.initialize(universalSigner, intializeProps);
        }

        const guardedPushChainClient = createGuardedPushChain(
          pushChainClient,
          handleExternalWalletConnection,
          requestPushWalletConnection,
          checkAndShowUpgradeIfNeeded,
          universalSigner,
          intializeProps,
          config?.uid || 'default',
          () => {
            setIsReadOnly(false);
          },
        )

        setPushChain(guardedPushChainClient);

        if (!upgradeCheckRef.current) {
          upgradeCheckRef.current = true;
          await checkAndShowUpgradeIfNeeded(guardedPushChainClient);
        }

        setError(null);
      } catch (err) {
        console.log('Error occurred when initialising Push chain', err);
        setError(err instanceof Error ? err : new Error('Failed to initialize PushChain'));
        setPushChain(null);
      }
    };

    initializePushChain();

    return () => {
      clearProgressTimers();
      queueRef.current = [];
      lockRef.current = false;
    };
  }, [universalAccount, config, isReadOnly]);

  return {
    pushChainClient: pushChain,
    error,
    isInitialized: !!pushChain,
  };
};
