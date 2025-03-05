import { FC } from 'react';
import { usePushWalletContext } from './PushWalletProvider';
import styled from 'styled-components';
import { Spinner } from '../../common';

export type ConnectPushWalletButtonProps = {
  showLogOutButton?: boolean;
  title?: string;
  styling?: React.CSSProperties;
};

const ConnectPushWalletButton: FC<ConnectPushWalletButtonProps> = ({
  title,
  styling,
}) => {
  const {
    connectionStatus,
    handleConnectToPushWallet,
    handleNewConnectionRequest,
  } = usePushWalletContext();

  const isConnectButtonDisbaled =
    connectionStatus === 'connected' ||
    connectionStatus === 'authenticating' ||
    connectionStatus === 'connecting';

  const isLoading =
    connectionStatus === 'connecting' || connectionStatus === 'authenticating';

  const handleConnectWalletButton = () => {
    connectionStatus === 'retry'
      ? handleNewConnectionRequest()
      : handleConnectToPushWallet();
  };

  return (
    <>
      <ConnectButton
        onClick={handleConnectWalletButton}
        disabled={isConnectButtonDisbaled || isLoading}
        customStyle={styling}
      >
        {connectionStatus === 'notConnected' ? title : connectionStatus}
        {isLoading && (<SpinnerContainer><Spinner /></SpinnerContainer>)}
      </ConnectButton>
    </>
  );
};

export { ConnectPushWalletButton };

const ConnectButton = styled.button<{ customStyle?: React.CSSProperties }>`
  align-items: center;
  cursor: pointer;
  display: flex;
  justify-content: center;
  white-space: nowrap;
  flex-shrink: 0;
  border: none;
  background-color: #d548ec;
  color: rgba(255, 255, 255, 1);
  border-radius: 12px;
  gap: 4px;
  height: 48px;
  padding: 16px 24px;
  min-width: 100px;
  leading-trim: both;
  text-edge: cap;
  font-family: FK Grotesk Neu;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 16px;
  width: inherit;

  ${(props) =>
    props.customStyle &&
    Object.entries(props.customStyle)
      .map(
        ([key, value]) =>
          `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`
      )
      .join('\n')}
`;
const SpinnerContainer = styled.div`
  padding: 4px;
`;
