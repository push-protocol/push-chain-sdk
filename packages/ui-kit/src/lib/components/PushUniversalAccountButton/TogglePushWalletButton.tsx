import React from 'react';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { UniversalAddress } from '../../types';
import { Button, PushLogo, PushMonotone } from '../common';
import { centerMaskString } from '../../helpers';
import { CHAIN_LOGO } from '../../constants';

type TogglePushWalletButtonProps = {
  uid?: string;
  universalAddress: UniversalAddress;

  connectedButtonBgColor?: string;
  connectedButtonTextColor?: string;
  connectedButtonStyle?: React.CSSProperties;

  connectedButtonCustom?: React.ReactNode;
};
const TogglePushWalletButton: React.FC<TogglePushWalletButtonProps> = ({
  uid,
  universalAddress,

  connectedButtonBgColor,
  connectedButtonTextColor,
  connectedButtonStyle,
  connectedButtonCustom,
}) => {
  const { setMinimiseWallet, isWalletMinimised } = usePushWalletContext(uid);
  const { chainId, address } = universalAddress;

  function getChainIcon(chainId: string | null) {
    if (!chainId) {
      return <PushMonotone />;
    }
    const IconComponent = CHAIN_LOGO[chainId];
    if (IconComponent) {
      return <IconComponent />;
    } else {
      return <PushMonotone />;
    }
  }

  const maskedAddress = centerMaskString(address);

  if (connectedButtonCustom) {
    return <>{connectedButtonCustom}</>;
  } else {
    return (
      <>
        <Button
          onClick={() => setMinimiseWallet(!isWalletMinimised)}
          bgColor={connectedButtonBgColor || '#17181b'}
          textColor={connectedButtonTextColor}
          customStyle={connectedButtonStyle}
        >
          {getChainIcon(chainId)}
          {maskedAddress}
          <PushLogo />
        </Button>
      </>
    );
  }
};

export { TogglePushWalletButton };
