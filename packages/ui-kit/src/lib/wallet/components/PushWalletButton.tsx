import React, { ReactNode } from 'react';
import { ConnectPushWalletButton } from './ConnectPushWalletButton';
import { TogglePushWalletButton } from './TogglePushWalletButton';
import { UniversalAddress } from '../wallet.types';

type PushWalletButtonProps = {
  universalAddress: UniversalAddress | null;
  component?: ReactNode;
  title?: string;
  styling?: React.CSSProperties;
};

const PushWalletButton: React.FC<PushWalletButtonProps> = ({
  universalAddress,
  component,
  title = 'Login',
  styling,
}) => {
  // If a custom component is provided, render it
  if (component) {
    return <>{component}</>;
  }

  return (
    <div>
      {universalAddress ? (
        <TogglePushWalletButton universalAddress={universalAddress} />
      ) : (
        <ConnectPushWalletButton title={title} styling={styling} />
      )}
    </div>
  );
};

export { PushWalletButton };
