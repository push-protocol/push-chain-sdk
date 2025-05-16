import React, { FC } from 'react';
import styled from 'styled-components';
import { usePushWalletContext } from '../../hooks/usePushWallet';
import { Button, Spinner } from '../common';

export type ConnectPushWalletButtonProps = {
  uid?: string;
  connectButtonText?: string;
  connectBgColor?: string;
  connectButtonTextColor?: string;
  connectButtonStyle?: React.CSSProperties;

  connectButtonCustom?: React.ReactNode;

  loadingComponent?: React.ReactNode;
};

const ConnectWalletButton: FC<ConnectPushWalletButtonProps> = ({
  uid,
  connectButtonText,
  connectBgColor,
  connectButtonTextColor,
  connectButtonStyle,

  connectButtonCustom,
  loadingComponent,
}) => {
  const { connectionStatus, handleConnectToPushWallet } =
    usePushWalletContext(uid);

  const isConnectButtonDisbaled =
    connectionStatus === 'connected' ||
    connectionStatus === 'authenticating' ||
    connectionStatus === 'connecting';

  const isLoading =
    connectionStatus === 'connecting' || connectionStatus === 'authenticating';

  const handleConnectWalletButton = () => handleConnectToPushWallet();

  if (connectButtonCustom) {
    return <>{connectButtonCustom}</>;
  } else {
    return (
      <Button
        bgColor={connectBgColor}
        textColor={connectButtonTextColor}
        customStyle={connectButtonStyle}
        onClick={handleConnectWalletButton}
        disabled={isConnectButtonDisbaled || isLoading}
      >
        {connectionStatus === 'notConnected'
          ? connectButtonText
          : connectionStatus}
        {isLoading &&
          (loadingComponent ? (
            loadingComponent
          ) : (
            <SpinnerContainer>
              <Spinner />
            </SpinnerContainer>
          ))}
      </Button>
    );
  }
};

export { ConnectWalletButton };

const SpinnerContainer = styled.div`
  padding: 4px;
`;
