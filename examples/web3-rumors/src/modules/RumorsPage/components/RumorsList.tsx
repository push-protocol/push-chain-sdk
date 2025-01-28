import { Box, Spinner } from 'shared-components';
import RumorItem from './RumorItem';
import { useAppContext } from '@/context/AppContext';
import { useMemo } from 'react';
import { TABS } from '@/common';

const RumorsList = () => {
  const {
    currTab,
    account,
    confessions,
    sentConfessions,
    isRumorLoading,
    isMyRumorLoading,
  } = useAppContext();

  console.log(currTab, confessions);

  const list = useMemo(() => {
    if (currTab === TABS.LATEST) {
      return confessions;
    } else if (currTab === TABS.TRENDING) {
      return [...confessions].sort((a, b) => b.upVoteCount - a.upVoteCount);
    } else if (currTab === TABS.MY_RUMORS) {
      return sentConfessions;
    }
    return [];
  }, [confessions, currTab]);

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      gap="spacing-md"
    >
      {currTab === TABS.MY_RUMORS &&
        isMyRumorLoading &&
        sentConfessions.length === 0 && <Spinner size="large" />}
      {currTab !== TABS.MY_RUMORS &&
        isRumorLoading &&
        confessions.length === 0 && <Spinner size="large" />}
      {list.map((item) => (
        <RumorItem key={item.txnHash} {...item} />
      ))}
    </Box>
  );
};

export default RumorsList;
