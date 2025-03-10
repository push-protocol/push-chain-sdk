import { useState } from 'react';
import { Alert, Box, Button, TextInput } from 'shared-components';
import { TransactionSnippet } from '../../../common/components';
import { toHex } from 'viem';
import { useGlobalContext } from '../../../context/GlobalContext';
import { usePushWalletContext } from '../../../../../../packages/ui-kit/src';

const MockSignTransaction = () => {
  const { pushChain } = useGlobalContext();
  const { handleSignMessage } = usePushWalletContext();
  const [textInput, setTextInput] = useState('');
  const [signedData, setSignedData] = useState<Uint8Array | null>(null);

  const [signatureError, setSignatureError] = useState<unknown | null>(null);

  const handleSignMessageRequest = async () => {
    if (!textInput) return;
    try {
      if (pushChain) {
        const signedData = await handleSignMessage(
          new TextEncoder().encode(textInput)
        );
        setSignedData(signedData);
        setSignatureError(null);
        setTimeout(() => {
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth',
          });
        }, 1500);
      }
    } catch (error) {
      setSignatureError(error);
      console.error('Sign message error:', error);
    }
  };

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap="spacing-sm"
      padding={{ initial: 'spacing-lg', ml: 'spacing-lg spacing-sm' }}
      justifyContent="center"
      alignItems="center"
      alignSelf="stretch"
      backgroundColor="surface-primary"
      borderRadius="radius-lg"
      border="border-sm solid stroke-tertiary"
    >
      {signatureError !== null && (
        <Box width="100%">
          <Alert
            variant="error"
            heading="Error in signing Message"
            onClose={() => {
              setSignatureError(null);
            }}
          />
        </Box>
      )}

      <Box
        display="flex"
        flexDirection={{ initial: 'row', ml: 'column' }}
        width="100%"
        gap="spacing-xxs"
      >
        <TextInput
          placeholder="Enter message to send"
          value={textInput}
          onChange={(e) => {
            setTextInput(e.target.value);
          }}
        />
        <Button variant="tertiary" onClick={handleSignMessageRequest}>
          Sign Message
        </Button>
      </Box>

      {signedData !== null && (
        <TransactionSnippet
          heading="Signed Data"
          signature={toHex(signedData)}
          transactionData={null}
        />
      )}
    </Box>
  );
};

export { MockSignTransaction };
