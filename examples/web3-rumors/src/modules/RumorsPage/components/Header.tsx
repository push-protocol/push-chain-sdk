import { FC } from 'react';
import { Box, PushLogo, Text, css } from 'shared-components';
import {
  TogglePushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const Header: FC = () => {
  const { account } = usePushWalletContext();

  return (
    <Box
      position="sticky"
      display="flex"
      padding="spacing-xs spacing-xs"
      alignItems="center"
      justifyContent="space-between"
      backgroundColor="surface-primary"
      css={css`
        border-bottom: 1px solid var(--stroke-secondary);
        margin-bottom: 16px;
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xs">
        <Box display="flex" alignItems="center" gap="spacing-xxs">
          <img src="/RumorLogo.png" width={34} height={34} />
        </Box>
        <Box display={{ initial: 'block', ml: 'none' }}>
          <img src="/RumorsText.png" height={20} />
        </Box>
      </Box>
      <Box>{account && <TogglePushWalletButton account={account} />}</Box>
    </Box>
  );
};

export { Header };
