import React, { createContext, ReactNode } from 'react';
import { AppMetadata, ButtonDefaultsProps, ModalDefaultsProps, PushWalletProviderConfig } from '../types';

export type WalletContextType = {
    config: PushWalletProviderConfig;
    app?: AppMetadata;
    buttonDefaults?: ButtonDefaultsProps;
    modalDefaults?: ModalDefaultsProps;
}

export const WalletContext = createContext<WalletContextType | null>(null);

export const WalletContextProvider = ({ value, children }: {
    value: WalletContextType,
    children: ReactNode
}) => {

    return (
        <WalletContext.Provider value={value}>
            {children}
        </WalletContext.Provider>
    )
}