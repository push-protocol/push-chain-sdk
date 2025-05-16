import React, { FC, useEffect, useMemo } from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { ConnectWalletButton } from './ConnectWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import {
  loginAppOverrides,
  modalAppOverrides,
} from '../../types/UniversalWallet.types';

type PushUniversalAccountButtonProps = {
  uid?: string;

  connectButtonText?: string;
  connectButtonBgColor?: string;
  connectButtonTextColor?: string;
  connectButtonStyle?: React.CSSProperties;

  connectButtonCustom?: React.ReactNode;

  loadingComponent?: React.ReactNode;

  connectedButtonBgColor?: string;
  connectedButtonTextColor?: string;
  connectedButtonStyle?: React.CSSProperties;

  connectedButtonCustom?: React.ReactNode;

  modalAppOverride?: modalAppOverrides;
  loginAppOverride?: loginAppOverrides;
};

const PushUniversalAccountButton: FC<PushUniversalAccountButtonProps> = ({
  uid = 'default',
  connectButtonText = 'Connect Push Wallet',
  connectButtonBgColor,
  connectButtonTextColor,
  connectButtonStyle,
  connectButtonCustom,
  loadingComponent,
  connectedButtonBgColor,
  connectedButtonTextColor,
  connectedButtonStyle,
  connectedButtonCustom,
  modalAppOverride,
  loginAppOverride,
}) => {
  // TODO: login App Overrides is not done yet.

  const {
    universalAddress,
    buttonDefaults,
    updateModalAppData,
    updateWalletAppData,
  } = usePushWalletContext(uid);

  useEffect(() => {
    if (modalAppOverride) updateModalAppData(modalAppOverride);
    if (loginAppOverride) updateWalletAppData(loginAppOverride);
  }, []);

  if (universalAddress) {
    // Merge props with buttonDefaults, giving priority to direct props
    const toggleButtonProps = {
      uid: uid,
      universalAddress: universalAddress,
      connectedButtonBgColor:
        connectedButtonBgColor || buttonDefaults?.connectedButtonBgColor,
      connectedButtonTextColor:
        connectedButtonTextColor || buttonDefaults?.connectedButtonTextColor,
      connectedButtonStyle:
        connectedButtonStyle || buttonDefaults?.connectedButtonStyle,
      connectedButtonCustom,
    };

    return <TogglePushWalletButton {...toggleButtonProps} />;
  } else {
    // Merge props with buttonDefaults, giving priority to direct props
    const connectButtonProps = {
      uid: uid,
      connectButtonText: connectButtonText || buttonDefaults?.connectButtonText,
      connectBgColor:
        connectButtonBgColor || buttonDefaults?.connectButtonBgColor,
      connectButtonTextColor:
        connectButtonTextColor || buttonDefaults?.connectButtonTextColor,
      connectButtonStyle:
        connectButtonStyle || buttonDefaults?.connectButtonStyle,
      connectButtonCustom,
      loadingComponent,
    };

    return <ConnectWalletButton {...connectButtonProps} />;
  }
};

export { PushUniversalAccountButton };
