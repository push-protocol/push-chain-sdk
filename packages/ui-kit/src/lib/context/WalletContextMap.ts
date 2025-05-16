import { createContext } from 'react';
import { WalletContextType } from './WalletContext';

const WalletContextMap = new Map<
  string,
  React.Context<WalletContextType | null>
>();

export const getWalletContext = (uid = 'default') => {
  let ctx = WalletContextMap.get(uid);

  if (!ctx) {
    ctx = createContext<WalletContextType | null>(null);
    WalletContextMap.set(uid, ctx);
  }

  return ctx;
};
