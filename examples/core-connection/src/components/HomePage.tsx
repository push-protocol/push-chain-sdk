import React, { useEffect, useState } from 'react';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import '../App.css';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';
import { toHex } from 'viem';
import { PushNetwork } from '@pushprotocol/push-chain';
import {
  ConnectPushWalletButton,
  usePushWalletContext,
} from '../../../../packages/ui-kit';

// Mock data for testing
const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

const HomePage: React.FC = () => {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);

  const [mockTx, setMockTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // For signing message
  const [userInput, setUserInput] = useState<string>('');
  const [signedData, setSignedData] = useState<Uint8Array | null>(null);

  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);

        const unsignedTx = pushNetworkInstance.tx.createUnsigned(
          'CUSTOM:SAMPLE_TX',
          mockRecipients,
          new Uint8Array([1, 2, 3, 4, 5])
        );
        setMockTx(unsignedTx);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);

  const sendTransaction = async () => {
    setLoading(true);
    try {
      if (pushNetwork && mockTx && account) {
        const txHash = await pushNetwork.tx.send(mockTx, {
          account,
          signMessage: async (data: Uint8Array) => {
            return await handleSendSignRequestToPushWallet(data);
          },
        });
        alert(`Tx Sent - ${txHash}`);
      } else {
        console.error('Push Network or Transaction not initialized');
      }
    } catch (error) {
      alert(error);
      console.error('Transaction error:', error);
    }
    setLoading(false);
  };

  const signMessage = async () => {
    try {
      if (pushNetwork) {
        const signedData = await handleSendSignRequestToPushWallet(
          new TextEncoder().encode(userInput)
        );
        setSignedData(signedData);
      }
    } catch (error) {
      alert(error);
      console.error('Sign message error:', error);
    }
  };

  return (
    <div className="app-container">
      <h1>Send Transaction to Push Network</h1>

      <ConnectPushWalletButton />

      {account && (
        <div className="account-info">
          <h2>Connected Account:</h2>
          <p>{account}</p>
        </div>
      )}

      {account && (
        <div className="sign-message-container">
          <div>
            <input
              type="text"
              value={userInput}
              onChange={(e) => {
                setUserInput(e.target.value);
              }}
              placeholder="Enter data to send"
            />
            <button onClick={signMessage}>SignMessage</button>
          </div>
          {signedData && (
            <div className="transaction-card">
              <h2>Signed Data:</h2>
              <pre>{toHex(signedData)}</pre>
            </div>
          )}
        </div>
      )}
      {mockTx && account && (
        <>
          <button
            className="send-button"
            onClick={sendTransaction}
            disabled={loading}
          >
            {loading ? 'Sending' : 'Send'} Transaction
          </button>

          <div className="transaction-card">
            <h2>Mock Unsigned Transaction Data:</h2>
            <pre>{JSON.stringify(mockTx, null, 2)}</pre>
          </div>
        </>
      )}
    </div>
  );
};

export { HomePage };
