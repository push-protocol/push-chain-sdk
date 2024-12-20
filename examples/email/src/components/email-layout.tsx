import React from 'react';

import { IEmail } from '@/types';

import EmailViewer from './email-viewer';
import { useAppContext } from '@/context/app-context';

const EmailLayout: React.FC = () => {
  const { setReplyTo } = useAppContext();

  const handleReply = (email: IEmail) => {
    setReplyTo(email);
  };

  return (
    <div className="flex flex-col h-full w-full flex-1 ">
      <EmailViewer onReply={handleReply} />
    </div>
  );
};

export default EmailLayout;
