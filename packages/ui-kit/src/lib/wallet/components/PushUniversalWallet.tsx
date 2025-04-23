import React, { ReactNode } from 'react';
import { ConnectPushWalletButton } from './ConnectPushWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { UniversalAddress } from '../wallet.types';
import { usePushWalletContext } from './PushWalletProvider';

type PushUniversalWalletProps = {
  component?: ReactNode;
  title?: string;
  styling?: React.CSSProperties;
};

type RenderWalletProps = {
  universalAddress: UniversalAddress | null;
  component?: ReactNode;
  title?: string;
  styling?: React.CSSProperties;
}

const RenderWallet: React.FC<RenderWalletProps> = ({
  universalAddress,
  component,
  title = 'Login',
  styling
}) => {

  if (universalAddress) {
    return <TogglePushWalletButton universalAddress={universalAddress} />;
  } else if (component) {
    // If no UA and custom component, then render the component
    return <>{component}</>;
  } else return <ConnectPushWalletButton title={title} styling={styling} />;
}

const PushUniversalWallet: React.FC<PushUniversalWalletProps> = ({
  component,
  title = 'Login',
  styling,
}) => {

  const { universalAddress } = usePushWalletContext();
  return (
    <RenderWallet universalAddress={universalAddress} component={component} title={title} styling={styling} />
  )
};



export { PushUniversalWallet };