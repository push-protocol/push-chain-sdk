import React, { ReactNode } from 'react';
import { ConnectPushWalletButton } from './ConnectPushWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { UniversalAddress } from '../wallet.types';

type PushUniversalWalletProps = {
  universalAddress: UniversalAddress | null;
  component?: ReactNode;
  title?: string;
  styling?: React.CSSProperties;
};

const RenderWallet: React.FC<PushUniversalWalletProps> = ({
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
  universalAddress,
  component,
  title = 'Login',
  styling,
}) => {
  return (
    <RenderWallet universalAddress={universalAddress} component={component} title={title} styling={styling} />
  )
};



export { PushUniversalWallet };