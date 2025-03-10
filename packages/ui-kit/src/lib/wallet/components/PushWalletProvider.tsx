import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import {
  APP_TO_WALLET_ACTION,
  ConnectionStatus,
  UniversalAddress,
  WALLET_TO_APP_ACTION,
  WalletEventRespoonse,
} from '../wallet.types';
import config, { ENV } from '../../config';
import { walletRegistry } from '../../providers/WalletProviderRegistry';
import {
  ChainType,
  IWalletProvider,
  WalletInfo,
} from '../../providers/types/wallet.types';
import { getWalletDataFromAccount } from '../wallet.utils';

// Define the context shape
export type PushWalletContextType = {
  universalAddress: UniversalAddress | null; // required
  connectionStatus: ConnectionStatus; // required
  env: ENV;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  isWalletVisible: boolean;
  isWalletMinimised: boolean;
  setWalletVisibility: (isWalletVisible: boolean) => void;
  handleConnectToPushWallet: () => void; // required
  handleNewConnectionRequest: () => void;
  handleSignMessage: (data: Uint8Array) => Promise<Uint8Array>; // required
  setMinimiseWallet: React.Dispatch<React.SetStateAction<boolean>>;
  handleUserLogOutEvent: () => void;
  isIframeLoading: boolean;
  setIframeLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

export type WalletProviderProps = { children: ReactNode; env: ENV };

// Create the WalletContext
const PushWalletContext = createContext<PushWalletContextType | undefined>(
  undefined
);

// WalletProvider component
export const PushWalletProvider: React.FC<WalletProviderProps> = ({
  children,
  env,
}) => {
  const [universalAddress, setUniversalAddress] =
    useState<PushWalletContextType['universalAddress']>(null);

  const [isWalletVisible, setWalletVisibility] = useState(false);

  const [isWalletMinimised, setMinimiseWallet] = useState(false);

  const [isIframeLoading, setIframeLoading] = useState(true);

  const [currentWallet, setCurrentWallet] = useState<WalletInfo | null>(null);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('notConnected');

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const signatureResolverRef = useRef<{
    success?: (data: WalletEventRespoonse) => void;
    error?: (data: WalletEventRespoonse) => void;
  } | null>(null);

  const handleConnectToPushWallet = () => {
    setWalletVisibility(true);
    setConnectionStatus('connecting');
  };

  const sendMessageToPushWallet = (message: any) => {
    if (iframeRef?.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          message,
          config.WALLET_URL[env]
        );
      } catch (error) {
        console.error('Error sending message to push wallet tab:', error);
      }
    }
  };

  const handleNewConnectionRequest = () => {
    setMinimiseWallet(false);
    setConnectionStatus('authenticating');
    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleIsLoggedInAction = (response: WalletEventRespoonse) => {
    if (response?.account) {
      setConnectionStatus('connected');
      const result = getWalletDataFromAccount(response.account);
      setUniversalAddress({
        chainId: result.chainId,
        chain: result.chain,
        address: result.address,
      });
      setMinimiseWallet(true);
    } else {
      handleNewConnectionRequest();
    }
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

  const handleAppConnectionRetry = () => {
    setMinimiseWallet(true);
  };

  const handleUserLogOutEvent = () => {
    setConnectionStatus('notConnected');
    setUniversalAddress(null);
    setMinimiseWallet(false);
    setWalletVisibility(false);
    setIframeLoading(true);
  };

  const handleSendSignRequestToPushWallet = (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      if (signatureResolverRef.current) {
        reject(new Error('Another sign request is already in progress'));
        return;
      }

      signatureResolverRef.current = {
        success: (response: WalletEventRespoonse) => {
          resolve(response.signature!);
          signatureResolverRef.current = null; // Clean up
        },
        error: (response: WalletEventRespoonse) => {
          signatureResolverRef.current = null; // Clean up
          reject(new Error('Signature request failed'));
        },
      };

      setMinimiseWallet(false);

      // Send the sign request to the wallet tab
      sendMessageToPushWallet({
        type: APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });
    });
  };

  const handleSignMessage = async (data: Uint8Array): Promise<Uint8Array> => {
    let signature;
    if (currentWallet) {
      signature = await handleExternalWalletSignRequest(data)
    } else {
      signature = await handleSendSignRequestToPushWallet(data)
    }

    return signature

  }

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

      setCurrentWallet(connectedWallet);

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

  const handleExternalWalletSignRequest = async (
    data: Uint8Array
  ): Promise<Uint8Array> => {
    if (!currentWallet) {
      throw new Error('No External wallet connected');
    }

    try {
      const providerReceived = walletRegistry.getProvider(
        currentWallet.providerName
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

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      switch (event.data.type) {
        case WALLET_TO_APP_ACTION.CONNECT_WALLET:
          handleExternalWalletConnection(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.IS_LOGGED_IN:
          handleIsLoggedInAction(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
          handleAppConnectionSuccess(event.data.data);
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
          handleAppConnectionRejection();
          break;
        case WALLET_TO_APP_ACTION.APP_CONNECTION_RETRY:
          handleAppConnectionRetry();
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

  return (
    <PushWalletContext.Provider
      value={{
        universalAddress,
        connectionStatus,
        env,
        iframeRef,
        isWalletVisible,
        setWalletVisibility,
        isWalletMinimised,
        setMinimiseWallet,
        isIframeLoading,
        setIframeLoading,
        handleConnectToPushWallet,
        handleNewConnectionRequest,
        handleSignMessage,
        handleUserLogOutEvent,
      }}
    >
      {children}
    </PushWalletContext.Provider>
  );
};

// Custom hook to use WalletContext
export const usePushWalletContext = (): PushWalletContextType => {
  const context = useContext(PushWalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
