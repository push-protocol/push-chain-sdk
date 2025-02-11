import { css } from 'styled-components';
import { Box, Button, Front, Sale, Text } from 'shared-components';
import { useGlobalContext } from '../../../context/GlobalContext';
import { LandingPageBanner } from './LandingPageBanner';
import { SimulateTxText } from './SimulateTxText';
import {
  PushWalletButton,
  usePushWalletContext,
} from '@pushprotocol/pushchain-ui-kit';

const LandingPageLeftComponent = () => {
  const { pushNetwork, mockTx } = useGlobalContext();

  const { universalAddress } = usePushWalletContext();

  const featuresCard = [
    {
      id: 1,
      text: (
        <>
          Simulate transactions on the Push chain and see them on{' '}
          <a href="https://scan.push.org/" target="_blank">
            <Text variant="h4-regular" color="text-brand-medium" as="span">
              Push Scan
            </Text>
          </a>
        </>
      ),
    },
    {
      id: 2,
      text: 'Send tx from any chain of your choice(ETH, Solana, Push)',
    },
    {
      id: 3,
      text: 'Experience wallet abstraction and the future of web3',
    },
  ];

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-xxl"
      maxWidth={{ initial: '475px', ml: 'auto' }}
    >
      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-md"
        alignItems={{ ml: 'center' }}
      >
        <a
          href="https://snapshot.box/#/s:pushdao.eth/proposal/0xa4a301c9a346356326d59e425245459d9fbde71b02aabc49a4ce191f0504f66a"
          target="_blank"
        >
          <Box display={{ initial: 'flex', ml: 'none' }}>
            <Button trailingIcon={<Front />} variant="outline" size="small">
              Push Chain proposal has successfully passed.
            </Button>
          </Box>
          <Box display={{ initial: 'none', ml: 'flex' }}>
            <Button
              trailingIcon={<Front />}
              variant="outline"
              size="extraSmall"
            >
              Push Chain proposal has successfully passed.
            </Button>
          </Box>
        </a>

        <a href="https://push.org/chain" target="_blank">
          <Box display={{ initial: 'flex', ml: 'none' }}>
            <SimulateTxText height="80px" width="400px" />
          </Box>
          <Box display={{ initial: 'none', ml: 'flex' }}>
            <SimulateTxText height="80px" width="300px" />
          </Box>
        </a>

        <Box display={{ initial: 'flex', ml: 'none' }}>
          <Text variant="h4-regular">
            An app that lets you simulate transactions on the Push chain, test
            signing, and send mock data with ease.
          </Text>
        </Box>

        <Box display={{ initial: 'none', ml: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            An app that lets you simulate transactions on the Push chain, test
            signing, and send mock data with ease.
          </Text>
        </Box>

        <Box
          display={{ initial: 'none', ml: 'flex' }}
          alignItems="center"
          justifyContent="center"
        >
          <LandingPageBanner height="290px" width="175px" />
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing-sm">
        <Box display="flex" flexDirection="column" gap="spacing-sm">
          {pushNetwork && mockTx && (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              width="-webkit-fill-available"
            >
              <PushWalletButton
                universalAddress={universalAddress}
                title="Connect Push Wallet"
                styling={{
                  width: 'inherit',
                }}
              />
            </Box>
          )}

          <a href="https://push.org/chain" target="_blank">
            <Box
              display={{ initial: 'flex', ml: 'none' }}
              flexDirection="row"
              gap="spacing-xxs"
              width="100%"
              justifyContent="center"
            >
              <Text variant="bl-semibold" color="text-brand-medium">
                Learn more about Push Chain
              </Text>
              <Front color="icon-brand-medium" size={24} />
            </Box>
            <Box
              flexDirection="row"
              gap="spacing-xxs"
              width="100%"
              justifyContent="center"
              display={{ initial: 'none', ml: 'flex' }}
            >
              <Text variant="bl-semibold" color="text-brand-medium">
                Learn more about Push Chain
              </Text>
              <Front color="icon-brand-medium" size={24} />
            </Box>
          </a>
        </Box>

        <Box>
          {featuresCard.map((item) => (
            <Box
              key={item.id}
              display="flex"
              flexDirection="row"
              gap="spacing-md"
              padding="spacing-md spacing-none"
              css={css`
                border-bottom: 1px solid #000;
              `}
            >
              <Sale size={28} color="icon-brand-medium" />
              <Text variant="h4-regular" as="span">
                {item.text}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export { LandingPageLeftComponent };
