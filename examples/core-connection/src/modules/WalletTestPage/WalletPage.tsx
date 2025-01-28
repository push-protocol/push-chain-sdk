import React from 'react';
import {
  usePushWalletContext,
  centerMaskString,
  PushWalletButton,
} from '../../../../../packages/ui-kit/src';
import { Box, Button, Text } from 'shared-components';

const WalletPage = () => {
  const { universalAddress } = usePushWalletContext();
  console.log('Universal Address', universalAddress);

  return (
    <Box display="flex" flexDirection="column" gap="spacing-lg">
      <Text variant="h3-bold">Wallet Page Example</Text>
      <Box display="flex" flexDirection="column" gap="spacing-lg">
        <Box display="flex" flexDirection="column" gap="spacing-xxs">
          <Text variant="h6-regular">Default Button:</Text>
          <PushWalletButton universalAddress={universalAddress} />
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing-xxs">
          <Text variant="h6-regular">Custom Title:</Text>
          <PushWalletButton
            universalAddress={universalAddress}
            title="Connect Wallet"
          />
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing-xxs">
          <Text variant="h6-regular">Custom Style Button:</Text>
          <PushWalletButton
            universalAddress={universalAddress}
            styling={{
              backgroundColor: '#10B981',
              borderRadius: '9999px',
              padding: '12px 24px',
            }}
          />
        </Box>
        <Box display="flex" flexDirection="column" gap="spacing-xxs">
          <Text variant="h6-regular">Custom Component Button:</Text>
          <PushWalletButton
            universalAddress={universalAddress}
            component={
              <Button variant="secondary">
                {universalAddress ? (
                  <>{centerMaskString(universalAddress.address)}</>
                ) : (
                  <> Connect With Push Wallet</>
                )}
              </Button>
            }
          />
        </Box>
      </Box>
    </Box>
  );
};

export default WalletPage;
