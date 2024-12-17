import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { Transaction } from '@pushprotocol/push-chain/src/lib/generated/tx';
import React, {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { usePushWalletContext } from '../../../../packages/ui-kit';

// Define a type for the context value
type GlobalContextType = {
  account: string | null;
  pushNetwork: PushNetwork | null;
  mockTx: Transaction | null;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>; // Add type for the function
};

// Create context with the defined type
const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

export const GlobalProvider = ({ children }: { children: ReactNode }) => {
  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [mockTx, setMockTx] = useState<Transaction | null>(null);

  console.log('Account changed >>>', account);

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

  return (
    <GlobalContext.Provider
      value={{
        account,
        pushNetwork,
        mockTx,
        handleSendSignRequestToPushWallet,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
};

export const useGlobalContext = () => {
  const context = useContext(GlobalContext);
  if (context === undefined) {
    throw new Error('useGlobalContext must be used within a GlobalProvider');
  }
  return context;
};
