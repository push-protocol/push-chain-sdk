'use client';
import { PushNetwork } from '@pushprotocol/push-chain';
import React, { createContext, useContext } from 'react';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';
import PushMail from 'push-mail';
import { ReactNode, useEffect, useState } from 'react';
import { extractWalletAddress, TABS } from '../common';
import { getConfessions, RumorType } from '@/services/getConfessions';
import { getSentConfessions } from '@/services/getSentConfessions';

interface AppContextType {
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  currTab: TABS;
  setCurrTab: React.Dispatch<React.SetStateAction<TABS>>;
  account: string | null;
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>;
  confessions: RumorType[];
  setConfessions: React.Dispatch<React.SetStateAction<RumorType[]>>;
  sentConfessions: RumorType[];
  setSentConfessions: React.Dispatch<React.SetStateAction<RumorType[]>>;
  upvotes: {
    [key: string]: number;
  };
  setUpvotes: React.Dispatch<
    React.SetStateAction<{
      [key: string]: number;
    }>
  >;
  isRumorLoading: boolean;
  isMyRumorLoading: boolean;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [currTab, setCurrTab] = useState<TABS>(TABS.TRENDING);
  const [confessions, setConfessions] = useState<RumorType[]>([]);
  const [sentConfessions, setSentConfessions] = useState<RumorType[]>([]);
  const [upvotes, setUpvotes] = useState<{ [key: string]: number }>({});
  const [isRumorLoading, setIsRumorLoading] = useState(false);
  const [isMyRumorLoading, setIsMyRumorLoading] = useState(false);

  const { account, handleSendSignRequestToPushWallet } = usePushWalletContext();

  const fetchConfessions = async () => {
    try {
      setIsRumorLoading(true);
      const fetchedConfessions = await getConfessions();
      setConfessions(fetchedConfessions);

      const upvoteMap: { [key: string]: number } = {};
      fetchedConfessions.forEach((confession) => {
        upvoteMap[confession.address] = confession.upVoteCount || 0;
      });
      setUpvotes(upvoteMap);
    } catch (error) {
      console.error('Error fetching confessions:', error);
    } finally {
      setIsRumorLoading(false);
    }
  };

  const fetchSentConfessions = async () => {
    if (!account) return;
    try {
      setIsMyRumorLoading(true);
      const address = extractWalletAddress(account);
      if (!address) {
        throw new Error('No wallet connected');
      }
      const data = await getSentConfessions(address);
      setSentConfessions(data || []);
    } catch (error) {
      console.error('Error fetching sent confessions:', error);
    } finally {
      setIsMyRumorLoading(false);
    }
  };

  useEffect(() => {
    fetchConfessions();
    fetchSentConfessions();
  }, []);

  useEffect(() => {
    const setNetwork = async () => {
      try {
        const pushNetworkInstance = await PushNetwork.initialize(ENV.DEV);
        console.log('Push Network initialized:', pushNetworkInstance);
        setPushNetwork(pushNetworkInstance);
      } catch (error) {
        console.error('Error initializing Push Network:', error);
      }
    };
    setNetwork();
  }, []);

  return (
    <AppContext.Provider
      value={{
        pushNetwork,
        setPushNetwork,
        currTab,
        setCurrTab,
        account,
        handleSendSignRequestToPushWallet,
        confessions,
        setConfessions,
        sentConfessions,
        setSentConfessions,
        upvotes,
        setUpvotes,
        isRumorLoading,
        isMyRumorLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
