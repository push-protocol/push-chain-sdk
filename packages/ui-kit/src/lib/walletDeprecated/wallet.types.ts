export enum WALLET_TO_APP_ACTION {
  AUTH_STATUS = 'authStatus',
  IS_LOGGED_IN = 'isLoggedIn',

  APP_CONNECTION_REJECTED = 'appConnectionRejected',
  APP_CONNECTION_SUCCESS = 'appConnectionSuccess',
  APP_CONNECTION_RETRY = 'appConnectionRetry',

  IS_LOGGED_OUT = 'loggedOut',
  TAB_CLOSED = 'tabClosed',

  SIGNATURE = 'signature',
  ERROR = 'error',

  CONNECT_WALLET = 'connectWallet',
}

export enum APP_TO_WALLET_ACTION {
  NEW_CONNECTION_REQUEST = 'newConnectionRequest',
  SIGN_MESSAGE = 'signMessage',
  LOG_OUT = 'logOut',

  CONNECTION_STATUS = 'connectionStatus',
}

export type ConnectionStatus =
  | 'notConnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'retry';

export type UniversalAddress = {
  chainId: string;
  chain: string;
  address: string;
};

export type WalletEventRespoonse = {
  signature?: Uint8Array;
  account?: string;
};
