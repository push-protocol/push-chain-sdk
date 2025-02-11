import {
  Box,
  Button,
  Front,
  Sale,
  Text,
  Spinner,
  css,
} from 'shared-components';
import { ConnectPushWalletButton } from '@pushprotocol/pushchain-ui-kit';
import { SimulateTxText } from './SimulateTxText';
import { useAppContext } from '@/context/AppContext';
import { LandingPageBanner } from './LandingPageBanner';

const LandingPageLeftComponent = () => {
  const { pushNetwork } = useAppContext();

  const featuresCard = [
    {
      id: 1,
      text: 'Send and receive emails across multiple blockchain networks without barriers.',
    },
    {
      id: 2,
      text: 'Push Mail brings a seamless web2 experience to web3.',
    },
    {
      id: 3,
      text: 'Maintain a unified inbox across chains for an effortless user experience.',
    },
  ];

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-xxl"
      maxWidth={{ initial: '475px', tb: 'auto' }}
      margin="spacing-xxs"
    >
      <Box
        display="flex"
        flexDirection="column"
        gap="spacing-md"
        alignItems={{ tb: 'center' }}
      >
        <a
          href="https://snapshot.box/#/s:pushdao.eth/proposal/0xa4a301c9a346356326d59e425245459d9fbde71b02aabc49a4ce191f0504f66a"
          target="_blank"
        >
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <Button trailingIcon={<Front />} variant="outline" size="small">
              Push Chain proposal has successfully passed.
            </Button>
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <Button
              trailingIcon={<Front />}
              variant="outline"
              size="extraSmall"
            >
              Push Chain proposal has successfully passed
            </Button>
          </Box>
        </a>

        <a href="https://push.org/chain" target="_blank">
          <Box display={{ initial: 'flex', tb: 'none' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
          <Box display={{ initial: 'none', tb: 'flex' }}>
            <SimulateTxText height="124px" width="343px" />
          </Box>
        </a>

        <Box display={{ initial: 'flex', tb: 'none' }}>
          <Text variant="h4-regular">
            Push Mail enables seamless communication across any chain. Shared
            state email ensures secure, transparent, and interoperable
            messaging.
          </Text>
        </Box>

        <Box display={{ initial: 'none', tb: 'flex' }}>
          <Text variant="h4-regular" textAlign="center">
            Push Mail enables seamless communication across any chain. Shared
            state email ensures secure, transparent, and interoperable
            messaging.
          </Text>
        </Box>
        <Box
          display={{ initial: 'none', tb: 'flex' }}
          alignItems="center"
          justifyContent="center"
        >
          <LandingPageBanner height="343px" />
        </Box>
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing-sm">
        <Box display="flex" flexDirection="column" gap="spacing-sm">
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="-webkit-fill-available"
          >
            {pushNetwork ? (
              <ConnectPushWalletButton />
            ) : (
              <Spinner size="medium" variant="primary" />
            )}
          </Box>

          <a href="https://push.org/chain" target="_blank">
            <Box
              display={{ initial: 'flex', tb: 'none' }}
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
              display={{ initial: 'none', tb: 'flex' }}
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
              alignItems="center"
            >
              <Box height="28px" width="28px">
                <Sale size={28} color="icon-brand-medium" />
              </Box>
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
