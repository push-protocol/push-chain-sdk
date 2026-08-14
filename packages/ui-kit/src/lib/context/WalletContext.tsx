import React, { createContext, FC, useEffect, useRef, useState } from 'react';
import {
  PushChain,
  type SignAuthorizationParams,
  type SignedAuthorization,
} from '@pushchain/core';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '@pushchain/core/src/lib/progress-hook/progress-hook.types';
import {
  ChainType,
  ConnectionStatus,
  IWalletProvider,
  ModalAppDetails,
  PushWalletProviderProps,
  UniversalAccount,
  WalletEventRespoonse,
  WalletInfo,
  WalletAppDetails,
  ThemeMode,
  ITypedData,
} from '../types';
import {
  APP_TO_WALLET_ACTION,
  PushUI,
  WALLET_CONFIG_URL,
  WALLET_TO_APP_ACTION,
} from '../constants';
import { walletRegistry } from '../providers/walletProviders/WalletProviderRegistry';
import { PushWalletToast } from '../components/PushWalletToast';
import { LoginModal } from '../components/LoginModal';
import { getWalletContext } from './WalletContextMap';
import { ThemeOverrides } from '../styles/token';
import { useWaapAuth } from '../providers/waap/useWaapAuth';
import {
  waapSignAndSendTransaction,
  waapSignAuthorization,
  waapSignMessage,
  waapSignTypedData,
} from '../providers/waap/waapProvider';
import { TypedData, TypedDataDomain } from 'viem';
import {
  consumePhantomMobileConnectRequest,
  hasPhantomMobileConnectRequest,
  PHANTOM_PROVIDER_NAME,
} from '../providers/walletProviders/solana/phantomMobile';
import { signAuthorizationForWalletConnection } from './walletAuthorization';

export type WalletContextType = {
  universalAccount: UniversalAccount | null;
  connectionStatus: ConnectionStatus;

  isWalletMinimised: boolean;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;

  handleConnectToPushWallet: () => void;
  handleUserLogOutEvent: () => void;
  handleSignMessage: (data: Uint8Array) => Promise<Uint8Array>;
  handleSignAndSendTransaction: (data: Uint8Array) => Promise<Uint8Array>;
  handleSignTypedData: (data: ITypedData) => Promise<Uint8Array>;
  handleSignAuthorization?: (
    params: SignAuthorizationParams
  ) => Promise<SignedAuthorization>;
  handleExternalWalletConnection: (data: {
    chain: ChainType;
    provider: IWalletProvider['name'];
  }) => Promise<void>;

  config: PushWalletProviderProps['config'];
  app?: PushWalletProviderProps['app'];

  modalAppData: ModalAppDetails | undefined;
  updateModalAppData: (newData: Partial<ModalAppDetails>) => void;

  walletAppData: WalletAppDetails | undefined;
  updateWalletAppData: (newData: Partial<WalletAppDetails>) => void;

  themeMode: ThemeMode;
  themeOverrides: ThemeOverrides;

  progress: ProgressEvent | null;
  setProgress: React.Dispatch<React.SetStateAction<ProgressEvent | null>>;

  isReadOnly: boolean;
  setIsReadOnly: React.Dispatch<React.SetStateAction<boolean>>;
  requestPushWalletConnection: () => Promise<{
    chain: ChainType;
    provider: IWalletProvider['name'];
  }>;
  checkAndShowUpgradeIfNeeded: (pushChainClient: PushChain) => Promise<boolean>;

  activeTriggerId: string | undefined;
  setActiveTriggerId: React.Dispatch<React.SetStateAction<string | undefined>>;
  toggleButtonRefs: React.MutableRefObject<
    Record<string, HTMLDivElement | null>
  >;

  connectionType: 'social' | 'external';
};

export const WalletContext = createContext<WalletContextType | null>(null);

export const WalletContextProvider: FC<PushWalletProviderProps> = ({
  children,
  config,
  app,
  themeMode = PushUI.CONSTANTS.THEME.DARK,
  themeOverrides,
}) => {
  const [universalAccount, setUniversalAccount] =
    useState<WalletContextType['universalAccount']>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isWalletVisible, setWalletVisibility] = useState(false); // to display the iframe as connect button is clicked

  const [isWalletMinimised, setMinimiseWallet] = useState(false); // to display/hide minimized wallet modal

  const [isIframeLoading, setIframeLoading] = useState(true);
  const isIframeLoadingRef = useRef(isIframeLoading);

  const [isReadOnly, setIsReadOnly] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState<
    WalletContextType['connectionStatus']
  >(ConnectionStatus.NOT_CONNECTED);

  const [externalWallet, setExternalWallet] = useState<WalletInfo | null>(null); // to connect with external wallet

  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  const upgradeResolverRef = useRef<{
    success?: () => void;
    error?: (error: Error) => void;
  } | null>(null);

  const pendingExternalWalletStatusRef = useRef<WalletInfo | null>(null);

  const pushChainClientRef = useRef<PushChain | null>(null);

  const setPushChainClient = (client: PushChain | null) => {
    pushChainClientRef.current = client;
  };

  const [modalAppData, setModalAppData] = useState<ModalAppDetails | undefined>(
    app
      ? {
          title: app?.title,
          logoURL: app?.logoUrl,
          description: app?.description,
        }
      : undefined
  );

  const [walletAppData, setWalletAppData] = useState<
    WalletAppDetails | undefined
  >(
    app
      ? {
          title: app?.title,
          logoURL: app?.logoUrl,
          description: app?.description,
        }
      : undefined
  );

  const [activeTriggerId, setActiveTriggerId] = useState<string>();

  const { loginWithWaapSocial } = useWaapAuth();

  const toggleButtonRefs = React.useRef<Record<string, HTMLDivElement | null>>(
    {}
  );

  const updateModalAppData = (newData: Partial<ModalAppDetails>) => {
    setModalAppData((prevData) => ({
      ...prevData,
      ...newData,
    }));
  };

  const updateWalletAppData = (newData: Partial<WalletAppDetails>) => {
    setWalletAppData((prevData) => ({
      ...prevData,
      ...newData,
    }));
  };

  const handleConnectToPushWallet = () => {
    setWalletVisibility(true);
    setConnectionStatus(ConnectionStatus.CONNECTING);
  };

  // sending wallet config to the Push wallet
  const sendWalletConfig = () => {
    const walletConfig = {
      loginDefaults: config.login,
      themeMode,
      appMetadata: walletAppData,
      themeOverrides: themeOverrides || {},
    };

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.WALLET_CONFIG,
      data: {
        ...walletConfig,
      },
    });
  };

  const handleUserLogOutEvent = () => {
    if (externalWallet) {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );
      providerReceived?.disconnect();
    }
    setConnectionStatus(ConnectionStatus.NOT_CONNECTED);
    setUniversalAccount(null);
    setMinimiseWallet(false);
    setWalletVisibility(false);
    setIframeLoading(true);
    setExternalWallet(null);
    pendingExternalWalletStatusRef.current = null;
    setIsReadOnly(false);
    localStorage.removeItem(`walletInfo_${config?.uid || 'default'}`);
    document.body.style.overflow = '';
  };

  // sending events to wallet from dapp
  const sendMessageToPushWallet = (message: any) => {
    if (iframeRef?.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          message,
          WALLET_CONFIG_URL[config.network]
        );
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  const sendExternalWalletConnectionStatus = (connectedWallet: WalletInfo) => {
    if (isIframeLoadingRef.current || !iframeRef?.current?.contentWindow) {
      pendingExternalWalletStatusRef.current = connectedWallet;
      return;
    }

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
      data: {
        status: 'successful',
        ...connectedWallet,
      },
    });
  };

  // response when the wallet sends logged in action
  const handleIsLoggedInAction = () => {
    handleNewConnectionRequest();
    // setExternalWallet(null);
  };

  // sending a new connection request as soon as wallet gets connected
  const handleNewConnectionRequest = () => {
    setConnectionStatus(ConnectionStatus.AUTHENTICATING);
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleAppConnectionSuccess = (response: WalletEventRespoonse) => {
    setConnectionStatus(ConnectionStatus.CONNECTED);
    setMinimiseWallet(true);
    // setIsReadOnly(false);
    if (response.account) {
      setUniversalAccount(response.account);
    }
    localStorage.setItem(
      `walletInfo_${config?.uid || 'default'}`,
      JSON.stringify({
        account: response.account,
        uid: config?.uid || 'default',
      })
    );
  };

  const handleAppConnectionRejection = () => {
    setConnectionStatus(ConnectionStatus.RETRY);
    setUniversalAccount(null);
  };

  // Connect external wallet
  const handleExternalWalletConnection = async (data: {
    chain: ChainType;
    provider: IWalletProvider['name'];
  }) => {
    try {
      const providerReceived = walletRegistry.getProvider(data.provider);

      if (!providerReceived) {
        return;
      }

      const walletInfo = await providerReceived.connect(data.chain);

      setConnectionStatus(ConnectionStatus.CONNECTED);
      setMinimiseWallet(true);

      const result = PushChain.utils.account.fromChainAgnostic(
        walletInfo.caipAddress
      );

      setUniversalAccount(result);

      const connectedWallet: WalletInfo = {
        address: walletInfo.caipAddress,
        providerName: data.provider,
        chainType: data.chain,
      };

      localStorage.setItem(
        `walletInfo_${config?.uid || 'default'}`,
        JSON.stringify({
          wallet: connectedWallet,
          uid: config?.uid || 'default',
        })
      );

      setExternalWallet(connectedWallet);

      sendExternalWalletConnectionStatus(connectedWallet);
    } catch (error) {
      console.log('Failed to connect to provider', error);
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
        data: {
          status: 'rejected',
        },
      });
      throw new Error('Failed to connect to provider');
    }
  };

  // handles external wallet signature request
  const handleExternalWalletSignRequest = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signMessage(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  const handleExternalWalletSignTransactionRequest = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signAndSendTransaction(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  const handleExternalWalletSignTypedDataRequest = async (
    data: ITypedData
  ): Promise<Uint8Array> => {
    if (!externalWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signTypedData(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    }
  };

  const handleSocialConnection = async () => {
    const result = await loginWithWaapSocial();
    if (!result) return;

    console.log(result);

    const w = await PushChain.utils.account.convertExecutorToOriginAccount(
      result.address as `0x${string}`
    );

    if (!w.account) return;

    // setUniversalAccount(w.account);

    // localStorage.setItem(
    //   `walletInfo_${config?.uid || 'default'}`,
    //   JSON.stringify({
    //     account: w.account,
    //     uid: config?.uid || 'default'
    //   })
    // );

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.SOCIAL_CONNECTION_STATUS,
      data: {
        account: w.account,
      },
    });
  };

  const handleSocialSignAndSendMessage = async (message: Uint8Array) => {
    try {
      const signature = await waapSignMessage(message);

      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data: { signature },
      });
    } catch (error) {
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.ERROR,
        data: {
          error: error,
        },
      });
    }
  };

  const handleSocialSignAndSendTransaction = async (txn: Uint8Array) => {
    try {
      const signature = await waapSignAndSendTransaction(txn);

      sendMessageToPushWallet({
        type: WALLET_TO_APP_ACTION.SIGN_TRANSACTION,
        data: { signature },
      });
    } catch (error) {
      sendMessageToPushWallet({
        type: WALLET_TO_APP_ACTION.ERROR,
        data: {
          error: error,
        },
      });
    }
  };

  const handleSocialSignTypedData = async (typedData: {
    domain: TypedDataDomain;
    types: TypedData;
    primaryType: string;
    message: Record<string, unknown>;
  }) => {
    try {
      const signature = await waapSignTypedData(typedData);

      sendMessageToPushWallet({
        type: WALLET_TO_APP_ACTION.SIGN_TYPED_DATA,
        data: { signature },
      });
    } catch (error) {
      sendMessageToPushWallet({
        type: WALLET_TO_APP_ACTION.ERROR,
        data: {
          error: error,
        },
      });
    }
  };

  const handleSignMessage = async (data: Uint8Array): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignRequest(data);
    } else {
      signature = await waapSignMessage(data);
    }

    return signature;
  };

  const handleSignAndSendTransaction = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignTransactionRequest(data);
    } else {
      signature = await waapSignAndSendTransaction(data);
    }

    return signature;
  };

  const handleSignTypedData = async (data: ITypedData): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignTypedDataRequest(data);
    } else {
      signature = await waapSignTypedData(data);
    }

    return signature;
  };

  const handleSignAuthorization = async (
    params: SignAuthorizationParams
  ): Promise<SignedAuthorization> => {
    return signAuthorizationForWalletConnection(
      externalWallet,
      params,
      walletRegistry,
      waapSignAuthorization
    );
  };

  const getAuthWindowConfig = () => {
    // Calculate the screen width and height
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;

    const width = 500;
    const height = 600;

    // Calculate the position to center the window
    const left = (screenWidth - width) / 2;
    const top = (screenHeight - height) / 2;

    // Open a new window with the calculated position
    const windowFeatures = `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`;

    return windowFeatures;
  };

  const requestPushWalletConnection = () => {
    setMinimiseWallet(false);
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.RECONNECT_WALLET,
    });

    // Wait for a response from the Push Wallet iframe
    return new Promise<{ chain: ChainType; provider: IWalletProvider['name'] }>(
      (resolve, reject) => {
        const handleMessage = (event: MessageEvent) => {
          if (event.data.type === WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS) {
            window.removeEventListener('message', handleMessage);
            if (event.data.error) {
              reject(new Error(event.data.error));
            } else {
              resolve(event.data);
            }
          }
          if (
            event.data.type === WALLET_TO_APP_ACTION.APP_CONNECTION_CANCELLED
          ) {
            window.removeEventListener('message', handleMessage);
            reject(new Error('Push Wallet connection failed'));
            setMinimiseWallet(true);
          }
        };

        window.addEventListener('message', handleMessage);

        setTimeout(() => {
          window.removeEventListener('message', handleMessage);
          reject(new Error('Push Wallet connection timed out'));
          setMinimiseWallet(true);
        }, 100000);
      }
    );
  };

  const checkAndShowUpgradeIfNeeded = async (pushChainClient: PushChain) => {
    setPushChainClient(pushChainClient);

    if (!pushChainClient) {
      return false;
    }

    try {
      await pushChainClient.accountStatusReady;
      if (
        !pushChainClient.isReadMode &&
        pushChainClient.accountStatus.uea.loaded &&
        pushChainClient.accountStatus.uea.requiresUpgrade
      ) {
        setMinimiseWallet(false);
        sendMessageToPushWallet({
          type: APP_TO_WALLET_ACTION.SHOW_UPGRADE_DRAWER,
          data: {
            currentVersion: pushChainClient.accountStatus.uea.version,
            newVersion: pushChainClient.accountStatus.uea.minRequiredVersion,
          },
        });

        // Wait for upgrade button click from iframe
        return new Promise<boolean>((resolve, reject) => {
          upgradeResolverRef.current = {
            success: () => {
              upgradeResolverRef.current = null;
              resolve(true);
            },
            error: (error: Error) => {
              upgradeResolverRef.current = null;
              resolve(false);
            },
          };
        });
      }

      return true;
    } catch (error) {
      console.error('Error checking upgrade status:', error);
      return false;
    }
  };

  const handleUpgradeAccountSuccess = () => {
    setMinimiseWallet(true);

    // Resolve any pending upgrade promise
    if (upgradeResolverRef.current?.success) {
      upgradeResolverRef.current.success();
      upgradeResolverRef.current = null;
    }
  };

  const handleUpgradeAccountError = (error?: any) => {
    setMinimiseWallet(true);

    // Reject any pending upgrade promise
    if (upgradeResolverRef.current?.error) {
      upgradeResolverRef.current.error(
        error instanceof Error ? error : new Error('Upgrade failed')
      );
      upgradeResolverRef.current = null;
    }
  };

  const handleUpgradeAccount = async () => {
    const pushChainClient = pushChainClientRef.current;
    if (!pushChainClient) {
      throw new Error('PushChain client not initialized');
    }

    try {
      await pushChainClient.upgradeAccount({
        progressHook: (progress: ProgressEvent) => {
          setProgress(progress);
          if (progress.id === PROGRESS_HOOK.UEA_MIG_9901) {
            setTimeout(() => setProgress(null), 10000);
          }
        },
      });

      // Send success response to iframe
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.UPGRADE_ACCOUNT_RESPONSE,
        data: { success: true },
      });

      handleUpgradeAccountSuccess();
    } catch (error) {
      console.error('Error upgrading account:', error);

      // Send error response to iframe
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.UPGRADE_ACCOUNT_RESPONSE,
        data: {
          success: false,
          error: error instanceof Error ? error.message : 'Upgrade failed',
        },
      });

      // Reject the upgrade promise
      if (upgradeResolverRef.current?.error) {
        upgradeResolverRef.current.error(
          error instanceof Error ? error : new Error('Upgrade failed')
        );
      }
    }
  };

  useEffect(() => {
    isIframeLoadingRef.current = isIframeLoading;
  }, [isIframeLoading]);

  useEffect(() => {
    if (hasPhantomMobileConnectRequest()) return;

    const walletInfo = localStorage.getItem(
      `walletInfo_${config?.uid || 'default'}`
    );
    const walletData = walletInfo ? JSON.parse(walletInfo) : null;
    if (!walletData) return;
    if (walletData.uid !== config?.uid) return;
    if (walletData?.wallet && walletData.wallet?.providerName) {
      setUniversalAccount(
        PushChain.utils.account.fromChainAgnostic(walletData.wallet.address)
      );
      setExternalWallet(walletData.wallet);
    } else {
      setUniversalAccount(walletData.account);
    }
    setIsReadOnly(true);
    setMinimiseWallet(true);
    setWalletVisibility(true);
    setConnectionStatus(ConnectionStatus.CONNECTED);
  }, []);

  useEffect(() => {
    const requestedChain = consumePhantomMobileConnectRequest();
    if (!requestedChain) return;

    setWalletVisibility(true);
    setConnectionStatus(ConnectionStatus.CONNECTING);
    setIsReadOnly(false);

    handleExternalWalletConnection({
      chain: requestedChain,
      provider: PHANTOM_PROVIDER_NAME,
    }).catch((error) => {
      console.log('Failed to resume Phantom mobile connection', error);
      setConnectionStatus(ConnectionStatus.RETRY);
    });
  }, []);

  useEffect(() => {
    if (isIframeLoading || !pendingExternalWalletStatusRef.current) return;

    const connectedWallet = pendingExternalWalletStatusRef.current;
    pendingExternalWalletStatusRef.current = null;

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
      data: {
        status: 'successful',
        ...connectedWallet,
      },
    });
  }, [isIframeLoading]);

  useEffect(() => {
    if (isIframeLoading) return;
    if (!isReadOnly) return;
    if (externalWallet) {
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.READ_ONLY_CONNECTION_STATUS,
        data: {
          status: 'successful',
          ...externalWallet,
        },
      });
    } else if (universalAccount) {
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.READ_ONLY_CONNECTION_STATUS,
        data: {
          status: 'successful',
          ...universalAccount,
        },
      });
    }
  }, [isIframeLoading, externalWallet]);

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow !== event.source) return;

      switch (event.data.type) {
        case WALLET_TO_APP_ACTION.CONNECT_EXTERNAL_WALLET:
          handleExternalWalletConnection(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.CONNECT_SOCIAL:
          handleSocialConnection();
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
          handleIsLoggedInAction();
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
          handleAppConnectionSuccess(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
          handleAppConnectionRejection();
          break;
        case APP_TO_WALLET_ACTION.SIGN_MESSAGE:
          handleSocialSignAndSendMessage(event.data.data);
          break;
        case APP_TO_WALLET_ACTION.SIGN_TRANSACTION:
          handleSocialSignAndSendTransaction(event.data.data);
          break;
        case APP_TO_WALLET_ACTION.SIGN_TYPED_DATA:
          handleSocialSignTypedData(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
          handleUserLogOutEvent();
          break;
        case WALLET_TO_APP_ACTION.CLOSE_IFRAME:
          if (universalAccount) setMinimiseWallet(true);
          else handleUserLogOutEvent();
          break;
        case WALLET_TO_APP_ACTION.UPGRADE_ACCOUNT_REQUEST:
          handleUpgradeAccount();
          break;
        case WALLET_TO_APP_ACTION.UPGRADE_ACCOUNT_SUCCESS:
          handleUpgradeAccountSuccess();
          break;
        case WALLET_TO_APP_ACTION.UPGRADE_ACCOUNT_ERROR:
          handleUpgradeAccountError();
          break;
        default:
          console.warn('Unknown message type:', event.data.type);
      }
    };

    window.addEventListener('message', messageHandler);

    return () => window.removeEventListener('message', messageHandler);
  }, [universalAccount]);

  const WalletContext = getWalletContext(config?.uid || 'default');

  return (
    <WalletContext.Provider
      value={{
        app,
        config,
        connectionStatus,
        universalAccount,
        isWalletMinimised,
        modalAppData,
        themeMode,
        themeOverrides: {},
        updateModalAppData,
        walletAppData,
        updateWalletAppData,
        setMinimiseWallet,
        handleConnectToPushWallet,
        handleUserLogOutEvent,
        handleSignMessage,
        handleSignAndSendTransaction,
        handleSignTypedData,
        handleSignAuthorization,
        progress,
        setProgress,
        isReadOnly,
        setIsReadOnly,
        handleExternalWalletConnection,
        requestPushWalletConnection,
        checkAndShowUpgradeIfNeeded,
        activeTriggerId,
        setActiveTriggerId,
        toggleButtonRefs,
        connectionType: externalWallet ? 'external' : 'social',
      }}
    >
      <LoginModal
        iframeRef={iframeRef}
        themeMode={themeMode}
        modalAppData={modalAppData}
        isWalletVisible={isWalletVisible}
        isIframeLoading={isIframeLoading}
        setIframeLoading={setIframeLoading}
        sendWalletConfig={sendWalletConfig}
        config={config}
        universalAccount={universalAccount}
        isWalletMinimised={isWalletMinimised}
        setMinimiseWallet={setMinimiseWallet}
        handleUserLogOutEvent={handleUserLogOutEvent}
        sendMessageToPushWallet={sendMessageToPushWallet}
        isReadOnly={isReadOnly}
        toggleButtonRefs={toggleButtonRefs}
        activeTriggerId={activeTriggerId}
      />
      {progress && (
        <PushWalletToast
          progress={progress}
          setProgress={setProgress}
          initialChain={universalAccount?.chain}
          toastPosition={config?.toast?.position}
          hidden={config?.toast?.hidden}
        />
      )}
      {children}
    </WalletContext.Provider>
  );
};
