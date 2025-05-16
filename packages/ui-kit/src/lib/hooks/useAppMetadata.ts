// hooks/useAppMetadata.ts
import { useContext } from 'react';
import { WalletContext } from '../context/WalletContext';
export const useAppMetadata = (uid?: string) => useContext(WalletContext)?.app;