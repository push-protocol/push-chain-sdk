import { PushChain, CONSTANTS, createUniversalSigner } from '@pushchain/devnet';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { UniversalAddress, usePushWalletContext } from '../../../../packages/ui-kit';

type GlobalContextType = {
  pushChain: PushChain | null;
  universalAddress: UniversalAddress | null;
};

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

export const GlobalProvider = ({ children }: { children: ReactNode }) => {
  const {
    universalAddress,
    handleSignMessage,
  } = usePushWalletContext();

  const [pushChain, setPushChain] = useState<PushChain | null>(null);

  useEffect(() => {
    const setNetwork = async () => {
      if (!universalAddress) {
        return;
      }

      try {

        const signer = createUniversalSigner({
          address: universalAddress.address,
          chain: universalAddress?.chain,
          chainId: universalAddress?.chainId,
          signMessage: async (data: Uint8Array) => {
            return await handleSignMessage(data);
          },
        });

        const pushChainInstance = await PushChain.initialize(signer, {
          network: CONSTANTS.ENV.DEVNET,
        });

        setPushChain(pushChainInstance);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
        throw new Error(`Error initializing Push Network`)
      }
    };
    setNetwork();
  }, [universalAddress]);

  return (
    <GlobalContext.Provider
      value={{
        pushChain,
        universalAddress,
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
