'use client';
import { IEmail } from '@/types';
import { PushNetwork } from '@pushprotocol/push-chain';
import React, { createContext, useContext } from 'react';

interface AppContextType {
  searchInput: string;
  setSearchInput: React.Dispatch<React.SetStateAction<string>>;
  selectedEmail: IEmail | null; // this is the email that is currently selected by the user
  setSelectedEmail: React.Dispatch<React.SetStateAction<IEmail | null>>;
  pushNetwork: PushNetwork | null;
  setPushNetwork: React.Dispatch<React.SetStateAction<PushNetwork | null>>;
  pushAccount: any;
  setPushAccount: React.Dispatch<React.SetStateAction<any>>;
  emails: {
    sent: IEmail[];
    inbox: IEmail[];
  };
  setEmails: React.Dispatch<
    React.SetStateAction<{
      sent: IEmail[];
      inbox: IEmail[];
    }>
  >;
  currTab: 'inbox' | 'sent';
  setCurrTab: React.Dispatch<React.SetStateAction<'inbox' | 'sent'>>;
  replyTo: IEmail | undefined;
  setReplyTo: React.Dispatch<React.SetStateAction<IEmail | undefined>>;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
