import React, { FC, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { CrossIcon, Spinner } from '../../components/common';
import { CONSTANTS, WALLET_CONFIG_URL } from '../../constants';
import {
  ModalAppDetails,
  ModalProps,
  ProviderConfigProps,
  UniversalAddress,
} from '../../types';

type LoginModalProps = {
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  themeMode?: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
  isWalletVisible: boolean;
  isIframeLoading: boolean;
  setIframeLoading: (isIframeLoading: boolean) => void;
  sendWalletConfig: () => void;
  modalAppData: ModalAppDetails | undefined;
  config: ProviderConfigProps;
  universalAddress: UniversalAddress | null;
  isWalletMinimised: boolean;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;
  handleUserLogOutEvent: () => void;
};

const LoginModal: FC<LoginModalProps> = ({
  iframeRef,
  isWalletVisible,
  isIframeLoading,
  themeMode = CONSTANTS.THEME.DARK,
  modalAppData,
  setIframeLoading,
  sendWalletConfig,
  universalAddress,
  isWalletMinimised,
  setMinimiseWallet,
  handleUserLogOutEvent,
  config,
}) => {
  const { modal } = config;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setMinimiseWallet(!isWalletMinimised);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <>
      {isWalletVisible ? (
        <FrameContainer
          ref={containerRef}
          isWalletMinimised={isWalletMinimised}
          universalAddress={universalAddress}
          themeMode={themeMode ? themeMode : CONSTANTS.THEME.DARK}
          accountMenuVariant={modal?.connectedLayout}
          modalDefaults={modal}
        >
          {isIframeLoading && (
            <FrameLoadingContainer
              themeMode={themeMode ? themeMode : CONSTANTS.THEME.DARK}
            >
              <CloseButtonContainer
                onClick={() => {
                  handleUserLogOutEvent();
                }}
              >
                <CrossIcon
                  height="20px"
                  width="20px"
                  color={themeMode === CONSTANTS.THEME.LIGHT ? '#000' : '#FFF'}
                />
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
            <AccountContainer universalAddress={universalAddress}>
              {universalAddress ? (
                <DashButtonContainer onClick={() => setMinimiseWallet(true)}>
                  <CrossIcon
                    height="18px"
                    width="18px"
                    color="var(--pw-int-text-primary-color)"
                  />
                </DashButtonContainer>
              ) : (
                <CloseButtonContainer
                  onClick={() => {
                    handleUserLogOutEvent();
                  }}
                >
                  <CrossIcon
                    height="20px"
                    width="20px"
                    color="var(--pw-int-text-primary-color)"
                  />
                </CloseButtonContainer>
              )}
            </AccountContainer>

            <SplitContainer>
              {modal?.appPreview &&
                modalAppData &&
                modal?.loginLayout === CONSTANTS.LOGIN.SPLIT && (
                  <AppPreviewContainer universalAddress={universalAddress}>
                    <AppContainer>
                      {modalAppData?.logoURL && (
                        <ImageContainer>
                          <Image
                            src={modalAppData?.logoURL}
                            alt={modalAppData.title}
                          />
                        </ImageContainer>
                      )}

                      <TextContainer
                        themeMode={themeMode ? themeMode : CONSTANTS.THEME.DARK}
                        textColor={
                          themeMode === CONSTANTS.THEME.LIGHT
                            ? '#F5F6F8'
                            : '#17181b'
                        }
                      >
                        <Heading>{modalAppData.title}</Heading>
                        <Description>{modalAppData?.description}</Description>
                      </TextContainer>
                    </AppContainer>
                  </AppPreviewContainer>
                )}

              <MainFrameContainer>
                <iframe
                  src={`${WALLET_CONFIG_URL[config.env]}/auth?app=${window.location.origin
                    }`}
                  allow="publickey-credentials-create; publickey-credentials-get; display-capture; *"
                  ref={iframeRef}
                  style={{
                    border: 'none',
                    width: '-webkit-fill-available',
                    height: universalAddress
                      ? modal?.connectedLayout === CONSTANTS.CONNECTED.FULL
                        ? '100vh'
                        : '675px'
                      : '100vh',
                    borderRadius: universalAddress ? '10px' : '0px',
                  }}
                  onLoad={() => {
                    setIframeLoading(false);
                    sendWalletConfig();
                  }}
                />
              </MainFrameContainer>
            </SplitContainer>
          </FrameSubContainer>
        </FrameContainer>
      ) : null}
    </>
  );
};

export { LoginModal };

const FrameContainer = styled.div<{
  universalAddress: UniversalAddress | null;
  isWalletMinimised: boolean;
  themeMode: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
  accountMenuVariant: ModalProps['connectedLayout'];
  modalDefaults?: ModalProps;
}>`
  position: fixed;
  display: flex;
  flex-direction: column;
  background-image: url(${({ modalDefaults }) => modalDefaults?.bgImage});
  background-size: cover;
  background-color: var(--pw-int-bg-primary-color);
  border-radius: ${({ universalAddress }) =>
    universalAddress ? '10px' : 'unset'};
  z-index: 999;

  width: ${({ universalAddress, isWalletMinimised, accountMenuVariant }) =>
    isWalletMinimised
      ? '0px'
      : universalAddress
        ? accountMenuVariant === CONSTANTS.CONNECTED.FULL
          ? '100%'
          : '450px'
        : '100vw'};
  height: ${({ universalAddress, isWalletMinimised, accountMenuVariant }) =>
    isWalletMinimised
      ? '0px'
      : universalAddress
        ? accountMenuVariant === CONSTANTS.CONNECTED.FULL
          ? '100vw'
          : '675px'
        : '100vh'};
  right: ${({ universalAddress, accountMenuVariant }) =>
    universalAddress
      ? accountMenuVariant === CONSTANTS.CONNECTED.FULL
        ? '0'
        : '10px'
      : '0'};
  top: ${({ universalAddress, accountMenuVariant }) =>
    universalAddress
      ? accountMenuVariant === CONSTANTS.CONNECTED.FULL
        ? '0'
        : '70px'
      : '0'};

  @media (max-width: 425px) {
    width: ${({ universalAddress, isWalletMinimised }) =>
    isWalletMinimised ? '0px' : universalAddress ? '96%' : '100%'};
    right: ${({ universalAddress }) => (universalAddress ? '2%' : '0')};
    top: ${({ universalAddress, accountMenuVariant }) =>
    universalAddress
      ? accountMenuVariant === CONSTANTS.CONNECTED.FULL
        ? '0'
        : '8%'
      : '0'};
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
  height: 20px;
  width: 20px;
  padding: 2px;
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
  color: inherit;
  font-family: FK Grotesk Neu;
  margin: 0px;
  width: auto;
`;

const FrameLoadingContainer = styled.div<{
  themeMode: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
}>`
  height: -webkit-fill-available;
  width: -webkit-fill-available;
  flex-direction: column;
  display: flex;
  padding: 8px;
  color: var(--pw-int-text-primary-color);
  background-color: var(--pw-int-bg-primary-color);
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

const AccountContainer = styled.div<{
  universalAddress: UniversalAddress | null;
}>`
  width: -webkit-fill-available;
  display: flex;
  align-items: center;
  position: absolute;
  top: 4px;
  right: 4px;
  justify-content: flex-end;
  padding: var(--spacing-xxs) var(--spacing-xxs);
  border-top-right-radius: ${({ universalAddress }) =>
    universalAddress ? '10px' : '0px'};
  border-top-left-radius: ${({ universalAddress }) =>
    universalAddress ? '10px' : '0px'};
  background-color: transparent;
`;

const SplitContainer = styled.div`
  display: flex;
`;

const AppPreviewContainer = styled.div<{
  universalAddress: UniversalAddress | null;
}>`
  display: ${({ universalAddress }) => (universalAddress ? 'none' : 'flex')};
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 100px 10px 10px 10px;
  background-color: transparent;

  @media (max-width: 1024px) {
    display: none;
  }
`;

const AppContainer = styled.div`
  width: 300px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  align-self: stretch;
  height: 700px;
  justify-content: center;
`;

const MainFrameContainer = styled.div`
  flex: 1;
`;
const ImageContainer = styled.div`
  width: 64px;
  height: 64px;
`;

const Image = styled.img`
  width: inherit;
  height: inherit;
  border-radius: 16px;
  border: 1px solid var(--stroke-secondary, #313338);
`;
const TextContainer = styled.div<{
  themeMode: typeof CONSTANTS.THEME.LIGHT | typeof CONSTANTS.THEME.DARK;
  textColor: string;
}>`
  font-family: 'FK Grotesk Neu';
  src: url('./assets/fonts/FKGroteskNeue-Regular.woff2') format('woff2'),
    url('./assets/fonts/FKGroteskNeue-Regular.woff') format('woff');
  font-style: normal;
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
  color: ${({ themeMode, textColor }) =>
    themeMode === CONSTANTS.THEME.LIGHT
      ? textColor
        ? textColor
        : '#17181b'
      : textColor
        ? textColor
        : '#F5F6F8'};
`;

const Heading = styled.h1`
  font-size: var(--pw-int-text-heading-xsmall-size);
  font-weight: 500;
  line-height: 27px;
  color: var(--pw-int-text-primary-color);
`;

const Description = styled.p`
  font-size: var(--pw-int-text-body-large-size);
  line-height: 22px;
  font-weight: 400;
  color: var(--pw-int-text-secondary-color);
`;
