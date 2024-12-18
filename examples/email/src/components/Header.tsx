import { useAppContext } from '@/context/app-context';
import { trimAddress } from '@/lib/utils';
import { usePrivy } from '@privy-io/react-auth';
import { TokenBNB, TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { MenuIcon } from 'lucide-react';
import { FC } from 'react';
import {
  Box,
  PushLogo,
  Text,
  Button,
  Menu,
  Dropdown,
  MenuItem,
} from 'shared-components';
import { css } from 'styled-components';

const Header: FC = () => {
  const { user, authenticated, logout } = usePrivy();
  const { pushAccount, setPushAccount, setSelectedEmail } = useAppContext();

  const logoutHandler = () => {
    if (pushAccount) {
      setPushAccount(null);
    } else if (authenticated) {
      logout();
    }
    setSelectedEmail(null);
  };

  return (
    <Box
      display="flex"
      padding="spacing-none spacing-xs"
      alignItems="center"
      justifyContent="space-between"
      height="68px"
      css={css`
        border-bottom: 1px solid var(--stroke-secondary);
      `}
    >
      <Box display="flex" alignItems="center" gap="spacing-xs">
        <Box display="flex" alignItems="center" gap="spacing-xxs">
          <PushLogo height={40} />
          <Text variant="h2-bold">Push</Text>
        </Box>
        <Text
          variant="h4-semibold"
          css={css`
            display: block;
            @media (max-width: 768px) {
              display: none;
            }
          `}
        >
          Email
        </Text>
      </Box>
      <Dropdown
        trigger="click"
        overlay={
          <Menu>
            <MenuItem
              label={
                (pushAccount || (authenticated && user)) && (
                  <span className="text-sm">
                    {pushAccount
                      ? trimAddress(pushAccount.split(':')[2])
                      : user?.wallet?.address &&
                        trimAddress(user.wallet.address)}
                  </span>
                )
              }
              icon={
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  width="20px"
                  height="20px"
                  borderRadius="radius-xxs"
                  backgroundColor="surface-tertiary"
                >
                  {pushAccount ? (
                    <TokenPUSH color="#202124" />
                  ) : user?.wallet?.chainType === 'solana' ? (
                    <TokenSOL color="#202124" />
                  ) : user?.wallet?.chainId === 'eip155:56' ? (
                    <TokenBNB color="#202124" />
                  ) : (
                    <TokenETH color="#202124" />
                  )}
                </Box>
              }
            />
            <MenuItem label="Logout" onClick={logoutHandler} />
          </Menu>
        }
      >
        <Box
          display="flex"
          cursor="pointer"
          alignItems="center"
          css={css`
            display: none;
            @media (max-width: 768px) {
              display: block;
            }
          `}
        >
          <MenuIcon height={32} width={32} />
        </Box>
      </Dropdown>
      <Box
        display="flex"
        alignItems="center"
        gap="spacing-xs"
        css={css`
          @media (max-width: 768px) {
            display: none;
          }
        `}
      >
        <Button
          variant="tertiary"
          css={css`
            padding: var(--spacing-xs) var(--spacing-sm);
            gap: var(--spacing-xxs);
            height: 40px;
            cursor: default;
          `}
          leadingIcon={
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="20px"
              height="20px"
              borderRadius="radius-xxs"
              backgroundColor="surface-tertiary"
            >
              {pushAccount ? (
                <TokenPUSH color="#202124" />
              ) : user?.wallet?.chainType === 'solana' ? (
                <TokenSOL color="#202124" />
              ) : user?.wallet?.chainId === 'eip155:56' ? (
                <TokenBNB color="#202124" />
              ) : (
                <TokenETH color="#202124" />
              )}
            </Box>
          }
        >
          {(pushAccount || (authenticated && user)) && (
            <span className="text-sm">
              {pushAccount
                ? trimAddress(pushAccount.split(':')[2])
                : user?.wallet?.address && trimAddress(user.wallet.address)}
            </span>
          )}
        </Button>
        <Button
          variant="tertiary"
          css={css`
            padding: var(--spacing-xs) var(--spacing-md);
            font-size: 14px;
            height: 40px;
          `}
          onClick={logoutHandler}
        >
          Logout
        </Button>
      </Box>
    </Box>
  );
};

export { Header };
