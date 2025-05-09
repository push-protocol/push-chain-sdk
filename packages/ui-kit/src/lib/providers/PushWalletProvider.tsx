import React, { FC } from 'react';
import { PushWalletProviderProps } from "../types/index"
import { WalletContextProvider } from "../context/WalletContext"

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
    config,
    app,
    themeMode,
    themeOverrides,
    buttonDefaults,
    modalDefaults,
    children
}) => {
    return (
        <WalletContextProvider value={{ config, app, buttonDefaults, modalDefaults }}>
            {children}
        </WalletContextProvider>
    );
};