import { FC } from 'react';
import { usePushWalletContext } from './WalletProvider';
import { walletConnectionButtonStatusMapper } from '../wallet.constants';
import { Box, Button, Dash, PushLogo } from 'shared-components';
import config from '../../config';

export type ConnectPushWalletButtonProps = {
  showLogOutButton?: boolean;
};

const ConnectPushWalletButton: FC<ConnectPushWalletButtonProps> = () => {
  const {
    connectionStatus,
    env,
    iframeRef,
    isWalletVisible,
    isWalletMinimised,
    handleConnectToPushWallet,
    handleNewConnectionRequest,
    setMinimiseWallet,
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
      {isWalletVisible ? (
        <div
          style={{
            position: 'fixed',
            right: '24px',
            top: '24px',
            width: isWalletMinimised ? '50px' : '450px',
            height: isWalletMinimised ? '50px' : '710px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {isWalletMinimised && (
            <div
              onClick={() => setMinimiseWallet(false)}
              style={{
                borderRadius: 100,
                backgroundColor: 'var(--surface-primary-inverse)',
                display: 'flex',
                alignItems: 'center',
                height: 50,
                justifyContent: 'center',
              }}
            >
              <PushLogo height={30} width={30} />
            </div>
          )}

          <div
            style={{
              width: '-webkit-fill-available',
              height: '-webkit-fill-available',
              display: isWalletMinimised ? 'none' : 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                height: 20,
                width: '-webkit-fill-available',
                backgroundColor: 'var(--surface-tertiary)',
                borderTopRightRadius: '10px',
                borderTopLeftRadius: '10px',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: '0px 8px',
              }}
            >
              <div
                style={{
                  padding: '0.5px',
                  backgroundColor: 'lightgreen',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  borderRadius: '100px',
                  cursor: 'pointer',
                }}
                onClick={() => setMinimiseWallet(true)}
              >
                <Dash />
              </div>
            </div>
            <iframe
              src={`${config.WALLET_URL[env]}/wallet?app=${window.location.origin}`}
              allow="publickey-credentials-create; publickey-credentials-get"
              ref={iframeRef}
              style={{
                border: 'none',
                width: '-webkit-fill-available',
                height: '-webkit-fill-available',
                borderBottomRightRadius: '10px',
                borderBottomLeftRadius: '10px',
              }}
            />
          </div>
        </div>
      ) : null}
      <Button
        block
        onClick={handleConnectWalletButton}
        disabled={isConnectButtonDisbaled}
        loading={isLoading}
      >
        {walletConnectionButtonStatusMapper[connectionStatus]}
      </Button>
    </>
  );
};

export { ConnectPushWalletButton };
