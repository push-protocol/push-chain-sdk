import React, { ChangeEvent, useState, useCallback, useEffect } from 'react';
import PushMail from 'push-mail';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { useAppContext } from '@/context/AppContext';
import { TokenBNB, TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { PaperclipIcon } from 'lucide-react';
import {
  trimAddress,
  getChainFromCAIP,
  extractWalletAddress,
  getInCAIP,
  formatReplyBody,
  Email,
} from '@/common';
import {
  Box,
  Button,
  SendNotification,
  Text,
  TextArea,
  TextInput,
  css,
  FileUpload,
  Select,
} from 'shared-components';
import { Cross1Icon } from '@radix-ui/react-icons';
import styled from 'styled-components';

import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

type FileData = {
  filename: string;
  type: string;
  content: string;
};

type Recipient = {
  address: string;
  chain: string;
};

type NewEmailProps = {
  replyTo?: Email;
};

const NewEmail: React.FC<NewEmailProps> = ({ replyTo }) => {
  const [emailData, setEmailData] = useState({
    subject: '',
    message: '',
  });
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [newRecipient, setNewRecipient] = useState<Recipient>({
    address: '',
    chain: 'eth',
  });
  const [fileAttachment, setFileAttachment] = useState<FileData[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const {
    pushNetwork,
    setEmails,
    setReplyTo,
    account,
    handleSendSignRequestToPushWallet,
    getEmails,
    currTab,
  } = useAppContext();
  const [sendingMail, setSendingMail] = useState(false);

  const { setMinimiseWallet } = usePushWalletContext();

  useEffect(() => {
    if (replyTo) {
      setIsOpen(true);
      setEmailData({
        subject: `Re: ${replyTo.subject}`,
        message: formatReplyBody(replyTo),
      });
      if (currTab === 'sent') {
        setRecipients(
          replyTo.to.map((recipient) => ({
            address: extractWalletAddress(recipient),
            chain: getChainFromCAIP(recipient),
          }))
        );
      } else {
        setRecipients([
          {
            address: extractWalletAddress(replyTo.from),
            chain: getChainFromCAIP(replyTo.from),
          },
        ]);
      }
    }
  }, [replyTo]);

  const handleSubjectChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setEmailData((prev) => ({ ...prev, subject: e.target.value }));
    },
    []
  );

  const handleMessageChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setEmailData((prev) => ({ ...prev, message: e.target.value }));
    },
    []
  );

  const handleNewRecipientChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setNewRecipient((prev) => ({ ...prev, address: e.target.value.trim() }));
    },
    []
  );

  const handleAddRecipient = useCallback(() => {
    if (newRecipient.address) {
      if (newRecipient.address.length < 25) {
        alert('The recipient address should have a minimum length of 25.');
      } else {
        setRecipients((prev) => [...prev, newRecipient]);
        setNewRecipient({ address: '', chain: 'eth' });
      }
    }
  }, [newRecipient]);

  const handleAddRecipientOnEnter = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Enter') {
      handleAddRecipient();
    }
  };

  const handleAddRecipientOnBlur = () => {
    if (newRecipient.address) {
      handleAddRecipient();
    }
  };

  const handleRemoveRecipient = useCallback((index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const MAX_FILE_SIZE = 0.5 * 1024 * 1024; // 0.5MB

      if (file.size > MAX_FILE_SIZE) {
        alert('File size exceeds 0.5MB. Please select a smaller file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          setFileAttachment((prevAttachments) => [
            ...prevAttachments,
            {
              filename: file.name,
              type: file.type,
              content: result.split(',')[1],
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleFileRemove = useCallback((filename: string) => {
    setFileAttachment((prevAttachments) =>
      prevAttachments.filter((attachment) => attachment.filename !== filename)
    );
  }, []);

  const sendHandler = useCallback(async () => {
    if (!account) throw new Error('No account connected');
    if (!recipients.length) {
      alert('Please specify at least one recipient.');
      return;
    }
    if (!emailData.subject) {
      alert('Please add subject.');
      return;
    }
    setSendingMail(true);
    try {
      const pushMail = await PushMail.initialize(ENV.DEV);
      const { subject, message } = emailData;

      const toInCAIP = recipients.map((recipient) =>
        getInCAIP(recipient.address, recipient.chain)
      );

      const signer = {
        account,
        signMessage: async (data: Uint8Array) => {
          try {
            return await handleSendSignRequestToPushWallet(data);
          } catch (error) {
            console.error('Error signing with Push Wallet:', error);
            throw error;
          }
        },
      };

      const txHash = await pushMail.send(
        subject,
        { content: message, format: 0 },
        fileAttachment,
        [{ key: 'Priority', value: 'High' }],
        toInCAIP,
        signer
      );
      if (txHash) {
        setEmails(
          (prevEmails: {
            sent: Email[];
            inbox: Email[];
          }): { sent: Email[]; inbox: Email[] } => ({
            sent: [
              {
                from: account,
                to: toInCAIP,
                subject,
                timestamp: Date.now(),
                body: message,
                attachments: fileAttachment,
                txHash: txHash,
              },
              ...prevEmails.sent,
            ],
            inbox: prevEmails.inbox,
          })
        );
      }
      console.log('Email sent:', txHash);
      setTimeout(() => {
        getEmails();
      }, 5000);
      setEmailData({ subject: '', message: '' });
      setRecipients([]);
      setFileAttachment([]);
      setIsOpen(false);
      setMinimiseWallet(true);
    } catch (error) {
      console.error('Failed to send email:', error);
      alert('Failed to send email');
    } finally {
      setSendingMail(false);
    }
  }, [
    emailData,
    recipients,
    fileAttachment,
    account,
    pushNetwork,
    handleSendSignRequestToPushWallet,
  ]);

  const handleOpenChange = () => {
    setIsOpen(!isOpen);
    if (isOpen && replyTo) {
      console.log('Popover closed');
      setEmailData({
        subject: '',
        message: '',
      });
      setRecipients([]);
      setReplyTo(undefined);
      setFileAttachment([]);
    }
  };

  return (
    <Box position="fixed" className="z-10 right-5 bottom-5 ml-5">
      <Button
        size="large"
        leadingIcon={<SendNotification width={24} height={24} />}
        css={css`
          border-radius: var(--radius-md);
          background: #e21d48 !important;
        `}
        onClick={() => setIsOpen(true)}
      >
        <Text
          variant="h5-regular"
          color="text-primary-inverse"
          display={{ initial: 'block', ml: 'none' }}
        >
          Compose
        </Text>
      </Button>
      {
        <Box
          backgroundColor="surface-primary"
          boxShadow="-2px 2px 7.8px 0px rgba(0, 0, 0, 0.25)"
          borderRadius="radius-sm"
          position="fixed"
          css={css`
            z-index: 999;
            right: 1.25rem;
            bottom: 1.25rem;

            opacity: 0;
            transform: translate(20px, 20px) scale(0.9);
            visibility: hidden;

            transition: opacity 0.2s ease-out, transform 0.2s ease-out,
              visibility 0.2s ease-out;

            ${isOpen &&
            `
              opacity: 1;
              transform: translate(0, 0) scale(1);
              visibility: visible;
            `}
          `}
        >
          <Box
            display="flex"
            height="48px"
            padding="spacing-none spacing-sm"
            alignItems="center"
            justifyContent="space-between"
            backgroundColor="surface-secondary"
            borderRadius="radius-xs radius-xs radius-none radius-none"
          >
            <Text variant="bs-semibold">Compose an Email</Text>
            <Cross1Icon
              width={18}
              height={18}
              onClick={handleOpenChange}
              cursor="pointer"
            />
          </Box>
          <Box
            display="flex"
            padding="spacing-sm"
            flexDirection="column"
            alignItems="flex-start"
            gap="spacing-xs"
            alignSelf="stretch"
          >
            <Box
              display="flex"
              alignItems="flex-start"
              gap="spacing-xs"
              alignSelf="stretch"
              width="100%"
            >
              <Box
                display="flex"
                padding="spacing-xs"
                alignItems="center"
                gap="spacing-xs"
                border="border-xmd solid stroke-secondary"
                borderRadius="radius-xs"
                width="100%"
                css={css`
                  flex-wrap: wrap;
                `}
              >
                <Text
                  variant="bs-regular"
                  css={css`
                    padding: 2px 0;
                  `}
                >
                  To
                </Text>
                {recipients.map((recipient, index) => (
                  <Box
                    key={index}
                    display="flex"
                    padding="spacing-xxxs spacing-xxs"
                    gap="spacing-xxs"
                    borderRadius="radius-xxs"
                    border="border-sm solid stroke-tertiary"
                    alignItems="center"
                    height="100%"
                  >
                    <Text variant="bes-semibold">
                      {trimAddress(recipient.address)}
                    </Text>
                    <Cross1Icon
                      onClick={() => handleRemoveRecipient(index)}
                      width={12}
                      height={12}
                      cursor="pointer"
                    />
                  </Box>
                ))}
                <Input
                  value={newRecipient.address}
                  onChange={handleNewRecipientChange}
                  onKeyDown={handleAddRecipientOnEnter}
                  onBlur={handleAddRecipientOnBlur}
                  className="outline-none focus:outline-none w-[80%]"
                />
              </Box>
              <Box>
                <Select
                  value={newRecipient.chain}
                  onSelect={(value) =>
                    setNewRecipient((prev) => ({ ...prev, chain: value }))
                  }
                  options={[
                    {
                      icon: <TokenETH className="w-6 h-6" />,
                      label: 'Ethereum',
                      value: 'eth',
                    },
                    {
                      icon: <TokenSOL className="w-6 h-6" />,
                      label: 'Solana',
                      value: 'sol',
                    },
                    {
                      icon: <TokenPUSH className="w-6 h-6" />,
                      label: 'Push',
                      value: 'push',
                    },
                    {
                      icon: <TokenBNB className="w-6 h-6" />,
                      label: 'BNB',
                      value: 'bnb',
                    },
                  ]}
                />
              </Box>
            </Box>
            <TextInput
              placeholder="Subject"
              value={emailData.subject}
              onChange={handleSubjectChange}
              css={css`
                width: 100%;
              `}
            />
            <TextArea
              placeholder="Message"
              value={emailData.message}
              onChange={handleMessageChange}
              numberOfLines={
                10 -
                (fileAttachment.length === 0
                  ? 0
                  : fileAttachment.length > 5
                  ? 4
                  : fileAttachment.length - 1)
              }
              css={css`
                width: 100%;
              `}
            />
            <Box
              display="flex"
              flexDirection="column"
              alignItems="flex-start"
              width="100%"
              gap="spacing-xxxs"
              maxHeight="146px"
              overflow="scroll"
            >
              {fileAttachment.map((file) => (
                <Box
                  key={file.content}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  backgroundColor="surface-secondary"
                  padding="spacing-xxxs spacing-xxs"
                  width="100%"
                >
                  <Text variant="bes-semibold">{file.filename}</Text>
                  <Cross1Icon
                    width={16}
                    height={16}
                    cursor="pointer"
                    onClick={() => handleFileRemove(file.filename)}
                  />
                </Box>
              ))}
            </Box>
            <FileUpload id="file-upload" onChange={handleFileUpload}>
              <label htmlFor="file-upload">
                <Button
                  disabled={fileAttachment.length === 1}
                  variant="outline"
                  size="extraSmall"
                  onClick={(e) => {
                    e.preventDefault();
                    const label = document.querySelector(
                      `label[for="file-upload"]`
                    ) as HTMLLabelElement | null;
                    label?.click();
                  }}
                >
                  <PaperclipIcon width={16} height={16} />
                  <Text>Choose File</Text>
                </Button>
              </label>
            </FileUpload>
            <Button
              onClick={sendHandler}
              disabled={sendingMail}
              css={css`
                width: 100%;
                border-radius: var(--radius-xs);
                background: #e21d48 !important;
              `}
            >
              {sendingMail ? 'Sending' : 'Send'}
            </Button>
          </Box>
        </Box>
      }
    </Box>
    // <Box position="fixed" className="fixed bottom-5 right-5 z-10">
    //   <Popover
    //     open={isOpen}
    //     onOpenChange={(open) => {
    //       if (!open) return;
    //       handleOpenChange();
    //     }}
    //   >
    //     <PopoverTrigger asChild>

    //     </PopoverTrigger>
    //     <PopoverContent
    //       align="end"
    //       className="flex flex-col gap-2 !p-0 border-0 bg-white rounded-[12px] translate-y-[60px]"
    //     >

    //     </PopoverContent>
    //   </Popover>
    // </Box>
  );
};

export default NewEmail;

const Input = styled.input`
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 18px;
`;
