import { ConnectionStatus } from './wallet.types';

export const walletConnectionButtonStatusMapper: Record<
  ConnectionStatus,
  string
> = {
  notConnected: 'Connect to Push Wallet',
  connecting: 'Connecting to Push Wallet',
  authenticating: 'Authenticating Push Wallet',
  connected: 'Connected to Push Wallet',
  retry: 'Retry Connecting to Push Wallet',
};
