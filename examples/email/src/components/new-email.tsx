import React, { ChangeEvent, useState, useCallback, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import PushMail from 'push-mail';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { useAppContext } from '@/context/app-context';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { TokenBNB, TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { hexToBytes } from 'viem';
import { IEmail } from '@/types';
import { PaperclipIcon } from 'lucide-react';
import { trimAddress, formatTimestamp } from '@/lib/utils';
import { PushNetwork } from '@pushprotocol/push-chain';
import {
  Box,
  Button,
  SendNotification,
  Text,
  TextArea,
  TextInput,
} from 'shared-components';
import { css } from 'styled-components';
import Select from './ui/select';
import { Cross1Icon } from '@radix-ui/react-icons';
import styled from 'styled-components';
import { FileUpload } from './fileUpload';

interface FileData {
  filename: string;
  type: string;
  content: string;
}

interface Recipient {
  address: string;
  chain: string;
}

interface NewEmailProps {
  replyTo?: IEmail;
}

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
  const [fileAttachment, setFileAttachment] = useState<FileData | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const { pushAccount, pushNetwork, setEmails, setReplyTo } = useAppContext();
  const { signMessageAsync } = useSignMessage();
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [sendingMail, setSendingMail] = useState(false);

  const address = pushAccount
    ? pushAccount
    : user?.wallet?.chainType === 'solana'
    ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
    : `${user?.wallet?.chainId}:${user?.wallet?.address}`;

  useEffect(() => {
    if (replyTo) {
      setIsOpen(true);
      setEmailData({
        subject: `Re: ${replyTo.subject}`,
        message: formatReplyBody(replyTo),
      });
      setRecipients([
        {
          address: replyTo.from.split(':')[2],
          chain: getChainFromCAIP(replyTo.from),
        },
      ]);
    }
  }, [replyTo]);

  const formatReplyBody = (email: IEmail) => {
    return `

On ${formatTimestamp(email.timestamp.toString())}, ${
      email.from.split(':')[2]
    } wrote:

${email.body
  .split('\n')
  .map((line) => `> ${line}`)
  .join('\n')}
`;
  };

  const getChainFromCAIP = (caip: string) => {
    const chainId = caip.split(':')[1];
    if (chainId === '1') return 'eth';
    if (chainId === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') return 'sol';
    return 'push';
  };

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

  const handleAddRecipient = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' && newRecipient.address) {
        setRecipients((prev) => [...prev, newRecipient]);
        setNewRecipient({ address: '', chain: 'eth' });
      }
    },
    [newRecipient]
  );

  const handleRemoveRecipient = useCallback((index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFileUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const result = e.target?.result;
        if (typeof result === 'string') {
          setFileAttachment({
            filename: file.name,
            type: file.type,
            content: result.split(',')[1],
          });
        }
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const sendHandler = useCallback(async () => {
    setSendingMail(true);
    try {
      const pushMail = await PushMail.initialize(ENV.DEV);
      const { subject, message } = emailData;

      const toInCAIP = recipients.map(
        (recipient) =>
          `${
            recipient.chain === 'eth'
              ? 'eip155:1'
              : recipient.chain === 'sol'
              ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
              : recipient.chain === 'bnb'
              ? 'eip155:56'
              : 'push:devnet'
          }:${recipient.address}`
      );

      const signer = {
        account: address,
        signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
          if (!user?.wallet?.address && !pushAccount)
            throw new Error('No account connected');

          return pushAccount
            ? (pushNetwork as PushNetwork).wallet.sign(data)
            : user?.wallet?.chainType === 'solana'
            ? await wallets[0].signMessage(data)
            : hexToBytes(await signMessageAsync({ message: { raw: data } }));
        },
      };

      const txHash = await pushMail.send(
        subject,
        { content: message, format: 0 },
        fileAttachment ? [fileAttachment] : [],
        [{ key: 'Priority', value: 'High' }],
        toInCAIP,
        signer
      );
      if (txHash) {
        setEmails(
          (prevEmails: {
            sent: IEmail[];
            inbox: IEmail[];
          }): { sent: IEmail[]; inbox: IEmail[] } => ({
            sent: [
              ...prevEmails.sent,
              {
                from: address,
                to: toInCAIP,
                subject,
                timestamp: Date.now(),
                body: message,
                attachments: fileAttachment ? [fileAttachment] : [],
                txHash: txHash,
              },
            ],
            inbox: prevEmails.inbox,
          })
        );
      }
      console.log('Email sent:', txHash);
      setEmailData({ subject: '', message: '' });
      setRecipients([]);
      setFileAttachment(null);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to send email:', error);
    }
    setSendingMail(false);
  }, [
    emailData,
    recipients,
    fileAttachment,
    address,
    user,
    pushAccount,
    pushNetwork,
    wallets,
    signMessageAsync,
  ]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      console.log('Popover closed');
      setEmailData({
        subject: '',
        message: '',
      });
      setRecipients([]);
      setReplyTo(undefined);
    }
  };

  return (
    <div className="absolute bottom-5 right-5 z-10">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            size="large"
            leadingIcon={<SendNotification width={24} height={24} />}
            css={css`
              border-radius: var(--radius-md);
              background: #e21d48 !important;
            `}
          >
            <Text
              variant="h5-regular"
              color="text-primary-inverse"
              css={css`
                display: block;
                @media (max-width: 768px) {
                  display: none;
                }
              `}
            >
              Compose
            </Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex flex-col gap-2 p-0 border-0 bg-white rounded-[12px] translate-y-[60px]"
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
              onClick={() => setIsOpen(false)}
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
                width="80%"
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
                  onKeyDown={handleAddRecipient}
                  className="outline-none focus:outline-none w-[90%]"
                />
              </Box>
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
              numberOfLines={10}
              css={css`
                width: 100%;
              `}
            />
            <FileUpload id="file-upload" onChange={handleFileUpload}>
              <Button variant="outline" size="extraSmall">
                <PaperclipIcon width={16} height={16} />
                <Text>Choose File</Text>
              </Button>
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
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NewEmail;

const Input = styled.input`
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  line-height: 18px;
`;
