import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from 'react';
import {
  ConnectionStatus,
  UniversalAddress,
  WalletEventRespoonse,
} from '../wallet.types';
import { CONSTANTS } from '../../constants';
import config, { ENV } from '../../config';
import { getWalletDataFromAccount } from '../wallet.utils';

// Define the context shape
export type PushWalletContextType = {
  universalAddress: UniversalAddress | null;
  connectionStatus: ConnectionStatus;
  env: ENV;
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  isWalletVisible: boolean;
  isWalletMinimised: boolean;
  setWalletVisibility: (isWalletVisible: boolean) => void;
  handleConnectToPushWallet: () => void;
  handleNewConnectionRequest: () => void;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;
  handleUserLogOutEvent: () => void;
  isIframeLoading: boolean;
  setIframeLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
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
      type: CONSTANTS.APP_TO_WALLET_ACTION.NEW_CONNECTION_REQUEST,
    });
  };

  const handleIsLoggedInAction = (response: WalletEventRespoonse) => {
    if (response?.account) {
      setConnectionStatus('connected');
      setMinimiseWallet(true);

      const result = getWalletDataFromAccount(response.account);

      setUniversalAddress({
        chainId: result.chainId,
        chain: result.chain,
        address: result.address,
      });
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
        type: CONSTANTS.APP_TO_WALLET_ACTION.SIGN_MESSAGE,
        data,
      });
    });
  };

  useEffect(() => {
    const messageHandler = (event: MessageEvent) => {
      switch (event.data.type) {
        case CONSTANTS.WALLET_TO_APP_ACTION.IS_LOGGED_IN:
          console.log('User has logged In');
          handleIsLoggedInAction(event.data.data);
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.APP_CONNECTION_SUCCESS:
          console.log('App Connection Success');
          handleAppConnectionSuccess(event.data.data);
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.APP_CONNECTION_REJECTED:
          console.log('App Connection Rejected');
          handleAppConnectionRejection();
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.APP_CONNECTION_RETRY:
          console.log('App Connection Retry');
          handleAppConnectionRetry();
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.SIGNATURE:
          console.log('Signature received');
          if (signatureResolverRef.current) {
            signatureResolverRef?.current?.success?.(event.data.data);
          }
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.IS_LOGGED_OUT:
          console.log('User loggged out');
          handleUserLogOutEvent();
          break;
        case CONSTANTS.WALLET_TO_APP_ACTION.ERROR:
          console.log('Error from the child tab');
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
        handleSendSignRequestToPushWallet,
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
