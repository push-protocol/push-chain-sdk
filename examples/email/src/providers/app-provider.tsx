'use client';
import { AppContext } from '@/context/app-context';
import { IEmail } from '@/types';
import { usePrivy } from '@privy-io/react-auth';
import { PushNetwork } from '@pushprotocol/push-chain';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import PushMail from 'push-mail';

import { ReactNode, useEffect, useState } from 'react';

export function AppProvider({ children }: { children: ReactNode }) {
  const [searchInput, setSearchInput] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<IEmail | null>(null);
  const [pushNetwork, setPushNetwork] = useState<PushNetwork | null>(null);
  const [pushAccount, setPushAccount] = useState<any>(null);
  const [emails, setEmails] = useState<{
    sent: IEmail[];
    inbox: IEmail[];
  }>({
    sent: [],
    inbox: [],
  });

  const { user } = usePrivy();

  const getEmails = async () => {
    const address = pushAccount
      ? pushAccount
      : user?.wallet?.chainType === 'solana'
      ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
      : `${user?.wallet?.chainId}:${user?.wallet?.address}`;

    const pushMail = await PushMail.initialize(ENV.DEV);
    const [sent, received] = await Promise.all([
      pushMail.getBySender(address),
      pushMail.getByRecipient(address),
    ]);

    setEmails({
      sent: sent.map((email: any) => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        timestamp: email.ts,
        body: email.body.content,
        attachments: email.attachments,
      })),
      inbox: received.map((email: any) => ({
        from: email.from,
        to: email.to,
        subject: email.subject,
        timestamp: email.ts,
        body: email.body.content,
        attachments: email.attachments,
      })),
    });
  };

  useEffect(() => {
    getEmails();
  }, [pushNetwork, pushAccount, user]);

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
        searchInput,
        setSearchInput,
        selectedEmail,
        setSelectedEmail,
        pushNetwork,
        setPushNetwork,
        pushAccount,
        setPushAccount,
        emails,
        setEmails,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
