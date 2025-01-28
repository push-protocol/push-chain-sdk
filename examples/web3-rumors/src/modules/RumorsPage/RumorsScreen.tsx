import { Box, css, Tabs, Text } from 'shared-components';
import { Header } from './components/Header';
import { TABS } from '@/common';
import { useAppContext } from '@/context/AppContext';
import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import RumorsList from './components/RumorsList';
import NewRumor from './components/NewRumor';
import { useEffect, useState } from 'react';

const RumorsScreen = () => {
  const { currTab, setCurrTab } = useAppContext();
  const [isTablet, setIsTablet] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsTablet(window.innerWidth < 1024);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Box
      position="relative"
      width="100%"
      height="100vh"
      display="flex"
      flexDirection="column"
    >
      <Header />
      <NewRumor />
      <Box
        alignSelf="center"
        display="flex"
        flexDirection="column"
        alignItems="center"
        width="100%"
      >
        <Box
          padding="spacing-xs"
          width={{ initial: '50%', tb: '70%', ml: '100%' }}
          css={css`
            box-sizing: border-box;
          `}
        >
          <Tabs
            variant="fill"
            activeKey={currTab}
            onChange={(tab) => setCurrTab(tab as TABS)}
            items={[
              {
                key: TABS.TRENDING,
                label: (
                  <Text variant="h5-semibold">
                    {isTablet ? 'Trending' : 'Trending Rumors'}
                  </Text>
                ),
                children: null,
              },
              {
                key: TABS.LATEST,
                label: (
                  <Text variant="h5-semibold">
                    {isTablet ? 'New' : 'Latest Rumors'}
                  </Text>
                ),
                children: null,
              },
              {
                key: TABS.MY_RUMORS,
                label: <Text variant="h5-semibold">My Rumors</Text>,
                children: null,
              },
            ]}
          />
        </Box>
        <Box
          padding="spacing-xs"
          width={{ initial: '70%', tb: '90%', ml: '100%' }}
          css={css`
            box-sizing: border-box;
          `}
        >
          <RumorsList />
        </Box>
      </Box>
    </Box>
  );
};

export default RumorsScreen;
