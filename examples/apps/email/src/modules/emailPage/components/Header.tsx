import { FC } from 'react';
import { Box, css } from 'shared-components';
import {
  PushWalletButton,
  TogglePushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const Header: FC = () => {
  const { universalAddress } = usePushWalletContext();

  return (
    <Box
      position="sticky"
      width="100%"
      display="flex"
      padding="spacing-xs spacing-xs"
      alignItems="center"
      justifyContent="space-between"
      backgroundColor="surface-primary"
      css={css`
        border-bottom: 1px solid var(--stroke-secondary);
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xs">
        <Box display="flex" alignItems="center" gap="spacing-xxs">
          <img src="/EmailLogo.png" width={34} height={34} />
        </Box>
        <Box display={{ initial: 'block', tb: 'none' }}>
          <img src="/EmailText.png" height={28} width={84} />
        </Box>
      </Box>
      <Box>
        <PushWalletButton universalAddress={universalAddress} />
      </Box>
    </Box>
  );
};

export { Header };
