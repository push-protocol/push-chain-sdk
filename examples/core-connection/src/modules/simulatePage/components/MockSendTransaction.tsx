import React, { useState } from 'react';
import { Alert, Box, Button, Front, Text } from 'shared-components';
import { css } from 'styled-components';
import { TransactionSnippet } from '../../../common/components';
import { useGlobalContext } from '../../../context/GlobalContext';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';
import { centerMaskString } from '../../../helpers';
import { usePushWalletContext } from '../../../../../../packages/ui-kit/src';

const MockSendTransaction = () => {
  const { pushNetwork, mockTx, account } = useGlobalContext();

  const { handleSendSignRequestToPushWallet } = usePushWalletContext();

  const [isSendingTxn, setIsSendingTxn] = useState(false);
  const [txnHash, setTxnHash] = useState<string | null>(null);
  const [txnError, setTxnError] = useState<unknown | null>(null);

  const handleSendTransaction = async (mockTx: Transaction) => {
    try {
      if (pushNetwork && account) {
        setIsSendingTxn(true);
        const txHash = await pushNetwork.tx.send(mockTx, {
          account,
          signMessage: async (data: Uint8Array) => {
            return await handleSendSignRequestToPushWallet(data);
          },
        });

        setTxnHash(txHash);
        setIsSendingTxn(false);
        setTxnError(null);
      }
    } catch (error) {
      setIsSendingTxn(false);
      setTxnError(error);
      setTxnHash(null);
      console.log('Error in sending Transaction', error);
    }
  };

  const handleViewOnScan = () => {
    if (txnHash) {
      window.open(`https://scan.push.org/transactions/${txnHash}`, '_blank');
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-lg"
      backgroundColor="surface-primary"
      border="border-sm solid stroke-tertiary"
      borderRadius="radius-lg"
      alignSelf="stretch"
      alignItems="center"
      justifyContent="center"
      padding={{ initial: 'spacing-lg', ml: 'spacing-sm' }}
    >
      {txnHash && (
        <Box width="100%">
          <Alert
            variant="info"
            description={`Tx sent - ${centerMaskString(txnHash)}`}
            actionText="View on Scan"
            onAction={handleViewOnScan}
            onClose={() => {
              setTxnHash(null);
            }}
          />
        </Box>
      )}

      {txnError !== null && (
        <Box width="100%">
          <Alert
            variant="error"
            heading="Error in sending Transaction"
            onClose={() => {
              setTxnError(null);
            }}
          />
        </Box>
      )}

      <TransactionSnippet
        heading="Mock Unsigned Transaction Data"
        transactionData={mockTx}
      />
      <Box width={{ initial: '350px', ml: '300px' }}>
        {mockTx && (
          <Button
            variant="primary"
            size="large"
            block
            disabled={isSendingTxn}
            onClick={() => handleSendTransaction(mockTx)}
          >
            {isSendingTxn ? 'Sending Transaction' : 'Send Transaction'}
          </Button>
        )}
      </Box>
      <a href="https://scan.push.org/transactions" target="_blank">
        <Box
          display="flex"
          flexDirection="row"
          gap="spacing-xxs"
          width="100%"
          justifyContent="center"
          cursor="pointer"
          css={css`
            &:hover {
              text-decoration: underline;
            }
          `}
        >
          <Text variant="bl-semibold" color="text-brand-medium">
            See all txs on Push Network using Push Scan
          </Text>
          <Front color="icon-brand-medium" size={24} />
        </Box>
      </a>
    </Box>
  );
};

export { MockSendTransaction };
