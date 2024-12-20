import React from 'react';
import { Card } from './ui/card';
import { IEmail } from '@/types';
import { useAppContext } from '@/context/app-context';
import { formatTimestamp, trimAddress } from '@/lib/utils';
import { EMAIL_BOX } from '@/constants';
import BlockiesSvg from 'blockies-react-svg';
import { Box, Text } from 'shared-components';
import { css } from 'styled-components';
import { useNavigate } from 'react-router-dom';

const EmailCard: React.FC<IEmail> = ({
  from,
  to,
  subject,
  timestamp,
  body,
  type,
  attachments,
  txHash,
}) => {
  const navigate = useNavigate();
  const { currTab, setSelectedEmail, selectedEmail } = useAppContext();

  return (
    <Card
      onClick={() => {
        setSelectedEmail({
          from,
          to,
          subject,
          timestamp,
          body,
          attachments,
          txHash,
        });
        navigate(`/${currTab}/${txHash}`);
      }}
      className={`cursor-pointer ${
        type === EMAIL_BOX.INBOX
          ? selectedEmail?.from === from && 'bg-secondary-foreground'
          : selectedEmail?.to === to && 'bg-primary-foreground'
      }`}
    >
      <Box
        display="flex"
        alignItems="flex-start"
        justifyContent="space-between"
        width="100%"
      >
        <Box display="flex" alignItems="center" gap="spacing-xs">
          <Box
            width="32px"
            height="32px"
            borderRadius="radius-round"
            overflow="hidden"
            alignSelf="center"
          >
            <BlockiesSvg address={from} />
          </Box>
          <Box>
            <Text variant="h5-bold">{subject}</Text>
            <Text variant="bes-semibold" color="text-tertiary">
              {trimAddress(from)}
            </Text>
          </Box>
        </Box>
        <Text variant="c-regular">{formatTimestamp(timestamp.toString())}</Text>
      </Box>
      <Box>
        <Text
          variant="bs-regular"
          css={css`
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
          `}
        >
          {body}
        </Text>
      </Box>
    </Card>
  );
};

export default EmailCard;
