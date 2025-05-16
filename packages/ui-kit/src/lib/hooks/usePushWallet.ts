import { useContext } from 'react';
import { WalletContextType } from '../context/WalletContext';
import { getWalletContext } from '../context/WalletContextMap';

// Custom hook to use WalletContext
export const usePushWalletContext = (uid?: string): WalletContextType => {
  const context = useContext(getWalletContext(uid || 'default'));
  if (!context) {
    throw new Error(
      'usePushWalletContext must be used within a PushWalletProvider'
    );
  }
  return context;
};
