import { FC } from 'react';
import { usePushWalletContext } from './PushWalletProvider';
import config from '../../config';
import styled from 'styled-components';
import { CrossIcon, DashIcon, Spinner } from '../../common';

const PushWalletIFrame: FC = () => {
  const {
    env,
    universalAddress,
    iframeRef,
    isWalletMinimised,
    isWalletVisible,
    setMinimiseWallet,
    handleUserLogOutEvent,
    isIframeLoading,
    setIframeLoading,
  } = usePushWalletContext();

  const account = universalAddress ? universalAddress?.address : null;

  return (
    <>
      {isWalletVisible ? (
        <FrameContainer isWalletMinimised={isWalletMinimised} account={account}>
          {isIframeLoading && (
            <FrameLoadingContainer>
              <CloseButtonContainer
                onClick={() => {
                  handleUserLogOutEvent();
                }}
              >
                <CrossIcon />
              </CloseButtonContainer>
              <LoadingTextContainer>
                <LoadingText>Loading...</LoadingText>
                <Spinner />
              </LoadingTextContainer>
            </FrameLoadingContainer>
          )}

          <FrameSubContainer
            isWalletMinimised={isWalletMinimised}
            isIframeLoading={isIframeLoading}
          >
            <AccountContainer account={account}>
              {account ? (
                <DashButtonContainer onClick={() => setMinimiseWallet(true)}>
                  <DashIcon />
                </DashButtonContainer>
              ) : (
                <CloseButtonContainer
                  onClick={() => {
                    handleUserLogOutEvent();
                  }}
                >
                  <CrossIcon />
                </CloseButtonContainer>
              )}
            </AccountContainer>
            <iframe
              src={`${config.WALLET_URL[env]}/auth?app=${window.location.origin}`}
              allow="publickey-credentials-create; publickey-credentials-get"
              ref={iframeRef}
              style={{
                border: 'none',
                width: '-webkit-fill-available',
                height: '100vh',
                borderBottomRightRadius: account ? '10px' : '0px',
                borderBottomLeftRadius: account ? '10px' : '0px',
              }}
              onLoad={() => setIframeLoading(false)}
            />
          </FrameSubContainer>
        </FrameContainer>
      ) : null}
    </>
  );
};

export { PushWalletIFrame };

const FrameContainer = styled.div<{
  account: string | null;
  isWalletMinimised: boolean;
}>`
  position: fixed;
  display: flex;
  flex-direction: column;
  background-color: #17181b;
  border-radius: 10px;
  z-index: 99;

  width: ${({ account, isWalletMinimised }) =>
    isWalletMinimised ? '0px' : account ? '450px' : '100%'};
  height: ${({ account, isWalletMinimised }) =>
    isWalletMinimised ? '0px' : account ? '710px' : '100%'};
  right: ${({ account }) => (account ? '24px' : '0')};
  top: ${({ account }) => (account ? '24px' : '0')};

  @media (max-width: 425px) {
    width: ${({ account, isWalletMinimised }) =>
      isWalletMinimised ? '0px' : account ? '96%' : '100%'};
    right: ${({ account }) => (account ? '2%' : '0')};
    top: ${({ account }) => (account ? '8%' : '0')};
  }
`;

const CloseButtonContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  cursor: pointer;
  padding: 0 16px;
`;

const DashButtonContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 1000px;
  height: 14px;
  width: 14px;
  background-color: #ffbb16;
`;

const LoadingTextContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: -webkit-fill-available;
  height: -webkit-fill-available;
`;

const LoadingText = styled.p`
  font-size: 18px;
  font-weight: 500;
  line-height: 27px;
  color: rgba(255, 255, 255, 1);
  font-family: FK Grotesk Neu;
  margin: 0px;
  width: auto;
`;

const FrameLoadingContainer = styled.div`
  height: -webkit-fill-available;
  width: -webkit-fill-available;
  flex-direction: column;
  display: flex;
  padding: 8px;
  background-color: #17181b;
`;

const FrameSubContainer = styled.div<{
  isWalletMinimised: boolean;
  isIframeLoading: boolean;
}>`
  display: ${({ isWalletMinimised, isIframeLoading }) =>
    isWalletMinimised || isIframeLoading ? 'none' : 'flex'};
  width: -webkit-fill-available;
  height: -webkit-fill-available;
  flex-direction: column;
`;

const AccountContainer = styled.div<{ account: string | null }>`
  width: -webkit-fill-available;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: var(--spacing-xxs) var(--spacing-xxs);
  border-top-right-radius: ${({ account }) => (account ? '10px' : '0px')};
  border-top-left-radius: ${({ account }) => (account ? '10px' : '0px')};
  background-color: ${({ account }) => (account ? '#e3e3e3' : '#17181B')};
`;
