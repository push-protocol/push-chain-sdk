import React, { FC, useEffect, useRef } from 'react';
import { ExecuteParams } from '@pushchain/core/src/lib/orchestrator/orchestrator.types';
import styled from 'styled-components';
import { CrossIcon, Spinner } from '../../components/common';
import { APP_TO_WALLET_ACTION, PushUI, WALLET_CONFIG_URL, WALLET_TO_APP_ACTION } from '../../constants';
import {
  ModalAppDetails,
  ModalProps,
  ProviderConfigProps,
  UniversalAccount,
} from '../../types';
import { useSmartModalPosition } from './useSmartModalPosition';
import { usePushChainClient } from '../../hooks/usePushChainClient';

type LoginModalProps = {
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  themeMode?:
    | typeof PushUI.CONSTANTS.THEME.LIGHT
    | typeof PushUI.CONSTANTS.THEME.DARK;
  isWalletVisible: boolean;
  isIframeLoading: boolean;
  setIframeLoading: (isIframeLoading: boolean) => void;
  sendWalletConfig: () => void;
  modalAppData: ModalAppDetails | undefined;
  config: ProviderConfigProps;
  universalAccount: UniversalAccount | null;
  isWalletMinimised: boolean;
  setMinimiseWallet: (isWalletMinimised: boolean) => void;
  handleUserLogOutEvent: () => void;
  sendMessageToPushWallet: (message: any) => void;
  isReadOnly: boolean;
  toggleButtonRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  activeTriggerId: string | undefined;
};

const LoginModal: FC<LoginModalProps> = ({
  iframeRef,
  isWalletVisible,
  isIframeLoading,
  themeMode = PushUI.CONSTANTS.THEME.DARK,
  modalAppData,
  setIframeLoading,
  sendWalletConfig,
  universalAccount,
  isWalletMinimised,
  setMinimiseWallet,
  handleUserLogOutEvent,
  config,
  sendMessageToPushWallet,
  isReadOnly,
  toggleButtonRefs,
  activeTriggerId,
}) => {
  const [version, setVersion] = React.useState<number>(8);

  const { modal } = config;
  const { pushChainClient } = usePushChainClient(config?.uid || 'default');

  const { top, left } = useSmartModalPosition(
    activeTriggerId || null,
    toggleButtonRefs,
    450,
    675,
    config.uid,
  );

  const handleSendTransaction = async (data: ExecuteParams) => {
    if (!pushChainClient) return;

    const res = await pushChainClient.universal.sendTransaction({
      ...data,
      value: data.value ? BigInt(data.value) : data.value
    });

    sendMessageToPushWallet({
      type: APP_TO_WALLET_ACTION.PUSH_SEND_TRANSACTION_RESPONSE,
      data: res.hash,
    });
  }

  useEffect(() => {
    if (config.version) {
      setVersion(config.version);
    }
  }, [config])

  useEffect(() => {
    const pushMessageHandler = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow !== event.source || !pushChainClient) return;

      switch (event.data.type) {
        case WALLET_TO_APP_ACTION.PUSH_SEND_TRANSACTION:
          handleSendTransaction(event.data.data);
          break;
        default:
          console.warn('Unknown message type:', event.data.type);
      }
    };

    window.addEventListener('message', pushMessageHandler);

    return () => window.removeEventListener('message', pushMessageHandler);
  }, [pushChainClient]);

  return (
    <>
      {!isWalletMinimised &&
        universalAccount &&
        config.modal?.connectedLayout ===
          PushUI.CONSTANTS.CONNECTED.LAYOUT.HOVER &&
        config.modal?.connectedInteraction ===
          PushUI.CONSTANTS.CONNECTED.INTERACTION.BLUR && (
          <BlurBackground
            onClick={() => setMinimiseWallet(!isWalletMinimised)}
          />
        )}
      {isWalletVisible ? (
        <FrameContainer
          $isWalletMinimised={isWalletMinimised}
          $universalAccount={universalAccount}
          $accountMenuVariant={modal?.connectedLayout}
          $modalDefaults={modal}
          $style={{ top, left }}
        >
          {(isIframeLoading && !isReadOnly) && (
            <FrameLoadingContainer>
              <CloseButtonContainer
                onClick={() => {
                  handleUserLogOutEvent();
                }}
              >
                <CrossIcon
                  height="20px"
                  width="20px"
                  color={
                    themeMode === PushUI.CONSTANTS.THEME.LIGHT ? '#000' : '#FFF'
                  }
                />
              </CloseButtonContainer>
              <LoadingTextContainer>
                <LoadingText>Loading...</LoadingText>
                <Spinner color="var(--pw-int-brand-primary-color)" />
              </LoadingTextContainer>
            </FrameLoadingContainer>
          )}

          {isIframeLoading && isReadOnly && !isWalletMinimised &&(
            <FrameLoadingContainerSecondary>
              <CloseButtonContainer
                onClick={() => {
                  setMinimiseWallet(true);
                }}
              >
                <CrossIcon
                  height="20px"
                  width="20px"
                  color={
                    themeMode === PushUI.CONSTANTS.THEME.LIGHT ? '#000' : '#FFF'
                  }
                />
              </CloseButtonContainer>
              <LoadingTextContainerSecondary>
                <LoadingText>Loading...</LoadingText>
                <Spinner color="var(--pw-int-brand-primary-color)" />
              </LoadingTextContainerSecondary>
            </FrameLoadingContainerSecondary>
          )}

          <FrameSubContainer
            $isWalletMinimised={isWalletMinimised}
            $isIframeLoading={isIframeLoading}
          >
            {/* <AccountContainer $universalAccount={universalaccount}>
              {universalAccount ? (
                <DashButtonContainer onClick={() => setMinimiseWallet(true)}>
                  <CrossIcon
                    height="20px"
                    width="20px"
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
            </AccountContainer> */}

            <SplitContainer>
              {modal?.appPreview &&
                modalAppData &&
                modal?.loginLayout === PushUI.CONSTANTS.LOGIN.LAYOUT.SPLIT && (
                  <AppPreviewContainer $universalAccount={universalAccount}>
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
                        $themeMode={
                          themeMode ? themeMode : PushUI.CONSTANTS.THEME.DARK
                        }
                        $textColor={
                          themeMode === PushUI.CONSTANTS.THEME.LIGHT
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
              {(
                <MainFrameContainer>
                  <iframe
                    src={`
                      ${WALLET_CONFIG_URL[config.network]}/auth?app=${window.location.origin}&version=${version}
                    `}
                    allow="clipboard-write; clipboard-read; publickey-credentials-create; publickey-credentials-get; display-capture; *"
                    ref={iframeRef}
                    style={{
                      border: 'none',
                      width: '100%',
                      height: universalAccount
                        ? modal?.connectedLayout ===
                          PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
                          ? '100vh'
                          : '675px'
                        : '100vh',
                      borderRadius: universalAccount ? '10px' : '0px',
                    }}
                    onLoad={() => {
                      setTimeout(() => {
                        setIframeLoading(false);
                        sendWalletConfig();
                      }, 100);
                    }}
                  />
                </MainFrameContainer>
              )}
            </SplitContainer>
          </FrameSubContainer>
        </FrameContainer>
      ) : null}
    </>
  );
};

export { LoginModal };

const BlurBackground = styled.div`
  position: fixed;
  top: 0px;
  bottom: 0px;
  left: 0px;
  right: 0px;
  backdrop-filter: blur(8px);
  z-index: 999999998;
`;

const FrameContainer = styled.div<{
  $universalAccount: UniversalAccount | null;
  $isWalletMinimised: boolean;
  $accountMenuVariant: ModalProps['connectedLayout'];
  $modalDefaults?: ModalProps;
  $style?: Record<'top' | 'left', number>;
}>`
  position: fixed;
  top: ${({ $universalAccount, $accountMenuVariant, $style }) =>
    $universalAccount
      ? $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
        ? '0'
        : $style?.top != null
        ? `${$style.top}px`
        : '50px'
      : '0'};
  left: ${({ $style }) => ($style?.left != null ? `${$style.left}px` : 'auto')};
  right: ${({ $style, $universalAccount, $accountMenuVariant }) =>
    $style?.left != null
      ? 'auto'
      : $universalAccount
      ? $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
        ? '0'
        : '10px'
      : '0'};
  display: flex;
  flex-direction: column;
  background-image: url(${({ $modalDefaults }) => $modalDefaults?.bgImage});
  background-size: cover;
  background-color: ${({$universalAccount, $accountMenuVariant}) => 
    $universalAccount && $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.HOVER ?
    'transparent' :
    'var(--pw-int-bg-primary-color)'
  };
  border-radius: ${({ $universalAccount }) =>
    $universalAccount ? '10px' : 'unset'};
  z-index: 999999999;

  width: ${({ $universalAccount, $isWalletMinimised, $accountMenuVariant }) =>
    $isWalletMinimised
      ? '0px'
      : $universalAccount
      ? $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
        ? '100%'
        : '450px'
      : '100vw'};
  height: ${({ $universalAccount, $isWalletMinimised, $accountMenuVariant }) =>
    $isWalletMinimised
      ? '0px'
      : $universalAccount
      ? $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
        ? '100vw'
        : '675px'
      : '100vh'};

  @media (max-width: 425px) {
    width: ${({ $universalAccount, $isWalletMinimised }) =>
      $isWalletMinimised ? '0px' : $universalAccount ? '100%' : '100%'};
    right: ${({ $universalAccount }) => ($universalAccount ? '2%' : '0')};
    top: ${({ $universalAccount, $accountMenuVariant }) =>
      $universalAccount
        ? $accountMenuVariant === PushUI.CONSTANTS.CONNECTED.LAYOUT.FULL
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
  padding: 8px 16px;
`;

const LoadingTextContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
`;

const LoadingTextContainerSecondary = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 600px;
`;

const LoadingText = styled.p`
  font-size: 18px;
  font-weight: 500;
  line-height: 27px;
  color: inherit;
  font-family: var(--pw-int-font-family);
  margin: 0px;
  width: auto;
`;

const FrameLoadingContainer = styled.div`
  height: 100%;
  width: 100%;
  flex-direction: column;
  display: flex;
  padding: var(--spacing-xxs) var(--spacing-xxs);
  color: var(--pw-int-text-primary-color);
  background-color: var(--pw-int-bg-primary-color);
  box-sizing: border-box;
`;

const FrameLoadingContainerSecondary = styled.div`
  height: 600px;
  width: 85%;
  margin-top: 25px;
  align-self: center;
  border-radius: 24px;
  flex-direction: column;
  display: flex;
  padding: var(--spacing-xxs) var(--spacing-xxs);
  color: var(--pw-int-text-primary-color);
  background-color: var(--pw-int-bg-primary-color);
  box-sizing: border-box;
`;

const FrameSubContainer = styled.div<{
  $isWalletMinimised: boolean;
  $isIframeLoading: boolean;
}>`
  display: ${({ $isWalletMinimised, $isIframeLoading }) =>
    $isWalletMinimised || $isIframeLoading ? 'none' : 'flex'};
  width: 100%;
  height: 100%;
  flex-direction: column;
`;

const AccountContainer = styled.div<{
  $universalAccount: UniversalAccount | null;
}>`
  width: 100%;
  display: flex;
  align-items: center;
  position: absolute;
  top: 8px;
  right: 8px;
  justify-content: flex-end;
  // padding: var(--spacing-xxs) var(--spacing-xxs);
  border-top-right-radius: ${({ $universalAccount }) =>
    $universalAccount ? '10px' : '0px'};
  border-top-left-radius: ${({ $universalAccount }) =>
    $universalAccount ? '10px' : '0px'};
  background-color: transparent;
`;

const SplitContainer = styled.div`
  display: flex;
`;

const AppPreviewContainer = styled.div<{
  $universalAccount: UniversalAccount | null;
}>`
  display: ${({ $universalAccount }) => ($universalAccount ? 'none' : 'flex')};
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
  $themeMode:
    | typeof PushUI.CONSTANTS.THEME.LIGHT
    | typeof PushUI.CONSTANTS.THEME.DARK;
  $textColor: string;
}>`
  font-family: var(--pw-int-font-family);
  src: url('./assets/fonts/FKGroteskNeue-Regular.woff2') format('woff2'),
    url('./assets/fonts/FKGroteskNeue-Regular.woff') format('woff');
  font-style: normal;
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
  text-align: left;
  color: ${({ $themeMode, $textColor }) =>
    $themeMode === PushUI.CONSTANTS.THEME.LIGHT
      ? $textColor
        ? $textColor
        : '#17181b'
      : $textColor
      ? $textColor
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
