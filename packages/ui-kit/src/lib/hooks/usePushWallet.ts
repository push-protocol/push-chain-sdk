import { useContext } from 'react';
import { WalletContext, WalletContextType } from "../context/WalletContext"

// Custom hook to use WalletContext
export const usePushWalletContext = (): WalletContextType => {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};