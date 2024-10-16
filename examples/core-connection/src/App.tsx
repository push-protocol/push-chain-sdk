import React, { useEffect, useState } from 'react';
import PushNetwork, { Tx } from '@pushprotocol/node-core/src/lib';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import './App.css';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';

enum TxCategory {
  INIT_DID = 'INIT_DID',
  INIT_SESSION_KEY = 'INIT_SESSION_KEY',
}

// Mock data for testing
const mockInitDidTxData = {
  did: 'did:example:123',
  masterPubKey: 'master_pub_key',
  derivedKeyIndex: 0,
  derivedPubKey: 'derived_pub_key',
  walletToEncDerivedKey: {
    'push:devnet:push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux': {
      encDerivedPrivKey: {
        ciphertext: 'qwe',
        salt: 'qaz',
        nonce: '',
        version: 'push:v5',
        preKey: '',
      },
      signature: new Uint8Array([1, 2, 3]),
    },
  },
};

const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

const App: React.FC = () => {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [mockTx, setMockTx] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [account, setAccount] = useState<string>('');

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        setPushNetwork(pushNetworkInstance);

        const unsignedTx = pushNetworkInstance.tx.createUnsigned(
          TxCategory.INIT_DID,
          mockRecipients,
          Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
        );
        setMockTx(unsignedTx);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);

  const connectWallet = async () => {
    try {
      if (pushNetwork) {
        const acc = await pushNetwork.wallet.connect();
        setAccount(acc);
      }
    } catch (err) {
      alert(err);
    }
  };

  const sendTransaction = async () => {
    setLoading(true);
    try {
      if (pushNetwork && mockTx) {
        const txHash = await pushNetwork.tx.send(mockTx, {
          account,
          signMessage: async (data: Uint8Array) => {
            return await pushNetwork.wallet.sign(data);
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

  return (
    <div className="app-container">
      <h1>Send Transaction to Push Network</h1>
      {pushNetwork && account === '' && (
        <button
          className="send-button"
          onClick={connectWallet}
          disabled={loading}
        >
          Connect Push Wallet
        </button>
      )}
      {mockTx && account !== '' && (
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

export default App;
