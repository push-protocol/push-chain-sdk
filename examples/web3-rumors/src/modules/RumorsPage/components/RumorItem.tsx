import {
  extractWalletAddress,
  formatTimestamp,
  markdownToPlainText,
  trimAddress,
} from '@/common';
import {
  Box,
  CaretDown,
  CaretUp,
  css,
  Text,
  ThumbsUp,
} from 'shared-components';
import ReactMarkdown from 'react-markdown';
import { RumorType } from '@/services/getConfessions';
import { useMemo, useState } from 'react';
import { performUpVote } from '@/services/performUpVote';
import { useAppContext } from '@/context/AppContext';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

const RumorItem: React.FC<RumorType> = ({
  upVoteCount,
  address,
  markdownPost,
  txnHash,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpvote, setIsUpvote] = useState(false);

  const { setMinimiseWallet } = usePushWalletContext();

  const {
    account,
    pushNetwork,
    setConfessions,
    handleSendSignRequestToPushWallet,
  } = useAppContext();

  const postLength = useMemo(() => {
    return markdownToPlainText(markdownPost).length;
  }, []);

  const handleUpvote = async () => {
    try {
      if (pushNetwork && account) {
        await performUpVote(
          pushNetwork,
          account,
          upVoteCount,
          txnHash,
          handleSendSignRequestToPushWallet
        );
        setConfessions((prev) =>
          prev.map((c) =>
            c.txnHash === txnHash ? { ...c, upVoteCount: c.upVoteCount + 1 } : c
          )
        );
        setMinimiseWallet(true);
        setIsUpvote(true);
      }
    } catch (error) {
      console.error('Error performing upvote:', error);
      setIsUpvote(false);
    }
  };

  return (
    <Box
      display="flex"
      padding="spacing-md"
      gap="spacing-md"
      alignItems="flex-start"
      border="border-sm solid stroke-secondary"
      borderRadius="radius-md"
      width="100%"
      css={css`
        box-sizing: border-box;
      `}
    >
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        gap="spacing-xxxs"
        height="100%"
      >
        <Box cursor="pointer" onClick={handleUpvote}>
          <ThumbsUp
            size={24}
            color={isUpvote ? 'icon-state-info-bold' : 'icon-tertiary'}
          />
        </Box>
        <Text variant="bs-semibold" color="text-tertiary">
          {upVoteCount}
        </Text>
      </Box>
      <Box width="100%">
        <Box display="flex" flexDirection="column" alignItems="flex-start">
          <Box
            display="flex"
            alignItems="center"
            gap="spacing-sm"
            justifyContent="space-between"
            width="100%"
          >
            <Text color="text-tertiary" variant="bm-semibold">
              {address && trimAddress(extractWalletAddress(address))}
            </Text>
            {/* <Text color="text-tertiary" variant="bs-regular">
              {formatTimestamp(timestamp)}
            </Text> */}
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            alignItems="flex-start"
            gap="spacing-xxxs"
          >
            <Text variant="bm-regular">
              <ReactMarkdown>
                {isOpen ? markdownPost : `${markdownPost.slice(0, 280)}...`}
              </ReactMarkdown>
            </Text>
            {markdownPost.length > 280 && (
              <Box
                display="flex"
                alignItems="center"
                gap="spacing-xxxs"
                cursor="pointer"
                onClick={() => setIsOpen((prev) => !prev)}
              >
                {isOpen ? (
                  <>
                    <Text variant="bm-semibold" color="text-state-info-bold">
                      Show Less
                    </Text>
                    <CaretUp color="icon-state-info-bold" />
                  </>
                ) : (
                  <>
                    <Text variant="bm-semibold" color="text-state-info-bold">
                      Show More
                    </Text>
                    <CaretDown color="icon-state-info-bold" />
                  </>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default RumorItem;
