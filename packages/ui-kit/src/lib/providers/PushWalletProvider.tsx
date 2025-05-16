import React, { FC } from 'react';
import {
  PushWalletProviderConfig,
  PushWalletProviderProps,
  ModalDefaultsProps,
} from '../types/index';
import { WalletContextProvider } from '../context/WalletContext';
import { CONSTANTS } from '../constants';

const loginDefaultConfig = {
  email: true,
  google: true,
  wallet: {
    enabled: true,
  },
};

const PushWalletConfigDefault: PushWalletProviderConfig = {
  uid: 'default',
  login: loginDefaultConfig,
  env: CONSTANTS.ENV.DEVNET,
};

const modalDefaultsDefault: ModalDefaultsProps = {
  loginLayout: CONSTANTS.LOGIN.SIMPLE,
  showModalAppPreview: false,
  bgColor: 'transparent',
  textColor: '#ffffff',
};

export const PushWalletProvider: FC<PushWalletProviderProps> = ({
  config,
  app,
  themeMode = CONSTANTS.THEME.DARK,
  themeOverrides,
  buttonDefaults,
  modalDefaults,
  children,
}) => {
  const mergedConfig: PushWalletProviderConfig = {
    ...PushWalletConfigDefault,
    ...config,
    login: {
      ...loginDefaultConfig,
      ...(config?.login || {}),
      wallet: {
        ...loginDefaultConfig.wallet,
        ...(config?.login?.wallet || {}),
      },
    },
  };

  const mergedModalDefaults = {
    ...modalDefaultsDefault,
    ...modalDefaults,
  };

  return (
    <WalletContextProvider
      config={mergedConfig}
      app={app}
      buttonDefaults={buttonDefaults}
      modalDefaults={mergedModalDefaults}
      themeMode={themeMode}
      themeOverrides={themeOverrides}
    >
      {children}
    </WalletContextProvider>
  );
};
