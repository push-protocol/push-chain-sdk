import React, { useState } from 'react';
import { Alert, Box, Button, Front, Text } from 'shared-components';
import { css } from 'styled-components';
import { centerMaskString } from '../../../helpers';
import { CONSTANTS, createUniversalAccount } from '@pushchain/devnet';
import { TransactionSnippet } from '../../../common/components';
import { mockTransaction } from '../../../common/constants';
import { usePushChain, usePushWalletContext } from '../../../../../../../packages/ui-kit';

const MockSendTransaction = () => {

  const { pushChain, isLoading, error } = usePushChain();
  const { universalAddress } = usePushWalletContext();

  const [isSendingTxn, setIsSendingTxn] = useState(false);
  const [txnHash, setTxnHash] = useState<string | null>(null);
  const [txnError, setTxnError] = useState<unknown | null>(null);

  const handleSendTransaction = async () => {
    try {
      if (pushChain && universalAddress) {
        setIsSendingTxn(true);
        const { txHash } = await pushChain.tx.send(
          [
            createUniversalAccount({
              address: '0x22B173e0596c6723dD1A95817052D96b97176Dd8',
            }),
            createUniversalAccount({
              chain: CONSTANTS.CHAIN.SOLANA,
              chainId: CONSTANTS.CHAIN_ID.SOLANA.TESTNET,
              address: 'ySYrGNLLJSK9hvGGpoxg8TzWfRe8ftBtDSMECtx2eJR',
            }),
          ],
          {
            category: 'CUSTOM:SAMPLE_TX',
            data: 'Hello world',
          }
        );

        setTxnHash(txHash);
        setIsSendingTxn(false);
        setTxnError(null);
      }
    } catch (error) {
      console.log('Error in sending transaction', error);
      setIsSendingTxn(false);
      setTxnError(error);
      setTxnHash(null);
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
        transactionData={mockTransaction}
      />

      <Box width={{ initial: '350px', ml: '300px' }}>
        {!isLoading && <Button
          variant="primary"
          size="large"
          block
          disabled={isSendingTxn}
          onClick={() => handleSendTransaction()}
        >
          {isSendingTxn ? 'Sending Transaction' : 'Send Transaction'}
        </Button>}
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
