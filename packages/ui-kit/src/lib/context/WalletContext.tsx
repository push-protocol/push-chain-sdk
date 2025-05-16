import React, { createContext, FC, useEffect, useRef, useState } from 'react';
import {
  ChainType,
  ConnectionStatus,
  IWalletProvider,
  ModalAppDetails,
  PushWalletProviderProps,
  UniversalAddress,
  WalletEventRespoonse,
  WalletInfo,
  WalletAppDetails,
} from '../types';
import {
  APP_TO_WALLET_ACTION,
  WALLET_CONFIG_URL,
  WALLET_TO_APP_ACTION,
} from '../constants';
import { getWalletDataFromAccount } from '../helpers';
import { walletRegistry } from '../providers/walletProviders/WalletProviderRegistry';
import { PushWalletToast } from '../components/PushWalletToast';
import { LoginModal } from '../components/LoginModal';
import { getWalletContext } from './WalletContextMap';

export type WalletContextType = {
  universalAddress: UniversalAddress | null;
  connectionStatus: ConnectionStatus;

  isWalletMinimised: boolean;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;

  handleConnectToPushWallet: () => void;
  handleUserLogOutEvent: () => void;
  handleSignMessage: (data: Uint8Array) => Promise<Uint8Array>;

  config: PushWalletProviderProps['config'];
  app?: PushWalletProviderProps['app'];
  buttonDefaults?: PushWalletProviderProps['buttonDefaults'];
  modalDefaults?: PushWalletProviderProps['modalDefaults'];

  modalAppData: ModalAppDetails | undefined;
  updateModalAppData: (newData: Partial<ModalAppDetails>) => void;

  walletAppData: WalletAppDetails | undefined;
  updateWalletAppData: (newData: Partial<WalletAppDetails>) => void;
}

export const WalletContext = createContext<WalletContextType | null>(null);

export const WalletContextProvider: FC<PushWalletProviderProps> = ({
  children,
  config,
  app,
  themeMode,
  buttonDefaults,
  modalDefaults,
}) => {
  const [universalAddress, setUniversalAddress] =
    useState<WalletContextType['universalAddress']>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isWalletVisible, setWalletVisibility] = useState(false); // to display the iframe as connect button is clicked

  const [isWalletMinimised, setMinimiseWallet] = useState(false); // to display/hide minimized wallet modal

  const [isIframeLoading, setIframeLoading] = useState(true);

  const [connectionStatus, setConnectionStatus] =
    useState<WalletContextType['connectionStatus']>('notConnected');

  const [externalWallet, setExternalWallet] = useState<WalletInfo | null>(null); // to connect with external wallet

  const [showToast, setShowToast] = useState(false);

  const signatureResolverRef = useRef<{
    success?: (data: WalletEventRespoonse) => void;
    error?: (data: WalletEventRespoonse) => void;
  } | null>(null);

  const [modalAppData, setModalAppData] = useState<ModalAppDetails | undefined>(app ? {
    title: app?.title,
    logoURL: app?.logoUrl,
    description: app?.description
  } : undefined);

  const [walletAppData, setWalletAppData] = useState<WalletAppDetails | undefined>(app ? {
    title: app?.title,
    logoURL: app?.logoUrl,
    description: app?.description
  } : undefined);

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
    setConnectionStatus('connecting');
  };

  // sending wallet config to the Push wallet
  const sendWalletConfig = () => {
    const walletConfig = {
      loginDefaults: config.login,
      themeMode,
      appMetadata: walletAppData,
    };

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.WALLET_CONFIG,
      data: {
        ...walletConfig,
      },
    });
  };

  const handleUserLogOutEvent = () => {
    setConnectionStatus('notConnected');
    setUniversalAddress(null);
    setMinimiseWallet(false);
    setWalletVisibility(false);
  };

  // sending events to wallet from dapp
  const sendMessageToPushWallet = (message: any) => {
    if (iframeRef?.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          message,
          WALLET_CONFIG_URL[config.env]
        );
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  // response when the wallet sends logged in action
  const handleIsLoggedInAction = () => {
    handleNewConnectionRequest();
    setExternalWallet(null);
  };

  // sending a new connection request as soon as wallet gets connected
  const handleNewConnectionRequest = () => {
    setConnectionStatus('authenticating');
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleAppConnectionSuccess = (response: WalletEventRespoonse) => {
    setConnectionStatus('connected');
    setMinimiseWallet(true);
    if (response.account) {
      const result = getWalletDataFromAccount(response.account);
      setUniversalAddress({
        chainId: result.chainId,
        chain: result.chain,
        address: result.address,
      });
    }
  };

  const handleAppConnectionRejection = () => {
    setConnectionStatus('retry');
    setUniversalAddress(null);
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

      setConnectionStatus('connected');
      setMinimiseWallet(true);

      const result = getWalletDataFromAccount(walletInfo.caipAddress);

      setUniversalAddress({
        chainId: result.chainId,
        chain: result.chain,
        address: result.address,
      });

      const connectedWallet: WalletInfo = {
        address: walletInfo.caipAddress,
        providerName: data.provider,
        chainType: data.chain,
      };

      setExternalWallet(connectedWallet);

      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.CONNECTION_STATUS,
        data: {
          status: 'successful',
          ...connectedWallet,
        },
      });
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

    setShowToast(true);

    try {
      const providerReceived = walletRegistry.getProvider(
        externalWallet.providerName
      );

      if (!providerReceived) {
        setShowToast(false);
        throw new Error('Provider not found');
      }

      const signature = await providerReceived.signMessage(data);

      return signature;
    } catch (error) {
      console.log('Error in generating signature', error);
      throw new Error('Signature request failed');
    } finally {
      setShowToast(false);
    }
  };

  // handles Push wallet signature request
  const handleSendSignRequestToPushWallet = (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      setShowToast(true);
      if (signatureResolverRef.current) {
        setShowToast(false);
        reject(new Error('Another sign request is already in progress'));
        return;
      }

      signatureResolverRef.current = {
        success: (response: WalletEventRespoonse) => {
          resolve(response.signature!);
          setShowToast(false);
          signatureResolverRef.current = null; // Clean up
        },
        error: (response: WalletEventRespoonse) => {
          signatureResolverRef.current = null; // Clean up
          setShowToast(false);
          reject(new Error('Signature request failed'));
        },
      };

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });
    });
  };

  // sending Message sign request to wallet based on which wallet is connected (external or pushwallet)
  const handleSignMessage = async (data: Uint8Array): Promise<Uint8Array> => {
    let signature;
    if (externalWallet) {
      signature = await handleExternalWalletSignRequest(data);
    } else {
      signature = await handleSendSignRequestToPushWallet(data);
    }

    return signature;
  };

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow !== event.source) return;

      switch (event.data.type) {
        case WALLET_TO_APP_ACTION.CONNECT_EXTERNAL_WALLET:
          console.log('External wallet connection req');
          handleExternalWalletConnection(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
          console.log('wallet connected successfully', event.data);
          handleIsLoggedInAction();
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
          handleAppConnectionSuccess(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
          handleAppConnectionRejection();
          break;
        case WALLET_TO_APP_ACTION.SIGNATURE:
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
          handleUserLogOutEvent();
          break;
        case WALLET_TO_APP_ACTION.ERROR:
          signatureResolverRef?.current?.error?.(event.data.data);
          break;
        default:
          console.warn('Unknown message type:', event.data.type);
      }
    };

    window.addEventListener('message', messageHandler);

    return () => window.removeEventListener('message', messageHandler);
  }, []);

  const WalletContext = getWalletContext(config?.uid || 'default');

  return (
    <WalletContext.Provider
      value={{
        app,
        config,
        connectionStatus,
        universalAddress,
        isWalletMinimised,
        buttonDefaults,
        modalDefaults,
        modalAppData,
        updateModalAppData,
        walletAppData,
        updateWalletAppData,
        setMinimiseWallet,
        handleConnectToPushWallet,
        handleUserLogOutEvent,
        handleSignMessage,
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
        universalAddress={universalAddress}
        isWalletMinimised={isWalletMinimised}
        setMinimiseWallet={setMinimiseWallet}
        handleUserLogOutEvent={handleUserLogOutEvent}
        modalDefaults={modalDefaults}
        buttonDefaults={buttonDefaults}
      />
      {isWalletVisible && showToast && <PushWalletToast />}
      {children}
    </WalletContext.Provider>
  );
};
