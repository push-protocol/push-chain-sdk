import React, { ChangeEvent, useState, useCallback, useEffect } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import PushMail from 'push-mail';
import { ENV } from '@pushprotocol/push-chain/src/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppContext } from '@/context/app-context';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { useSignMessage } from 'wagmi';
import { TokenBNB, TokenETH, TokenPUSH, TokenSOL } from '@web3icons/react';
import { hexToBytes } from 'viem';
import { IEmail } from '@/types';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { trimAddress, formatTimestamp } from '@/lib/utils';
import { PushNetwork } from '@pushprotocol/push-chain';

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

  const { pushAccount, pushNetwork, setEmails } = useAppContext();
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

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setEmailData((prev) => ({ ...prev, [name]: value }));
    },
    []
  );

  const handleNewRecipientChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setNewRecipient((prev) => ({ ...prev, address: e.target.value }));
    },
    []
  );

  const handleAddRecipient = useCallback(() => {
    if (newRecipient.address) {
      setRecipients((prev) => [...prev, newRecipient]);
      setNewRecipient({ address: '', chain: 'eth' });
    }
  }, [newRecipient]);

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

  return (
    <div className="absolute bottom-5 right-5">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button className="rounded-full">Compose new Email</Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="flex flex-col gap-2 p-2 min-w-[400px]"
        >
          <p>Compose an email</p>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 ">
              {recipients.map((recipient, index) => (
                <div key={index} className="flex flex-row gap-2 items-center">
                  <span>
                    {recipient.chain === 'eth' ? (
                      <TokenETH className="w-6 h-6" />
                    ) : recipient.chain === 'sol' ? (
                      <TokenSOL className="w-6 h-6" />
                    ) : recipient.chain === 'bnb' ? (
                      <TokenBNB className="w-6 h-6" />
                    ) : (
                      <TokenPUSH className="w-6 h-6" />
                    )}
                  </span>
                  <Badge className="text-xs">
                    {trimAddress(recipient.address)}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveRecipient(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-row gap-2">
              <Select
                value={newRecipient.chain}
                onValueChange={(value) =>
                  setNewRecipient((prev) => ({ ...prev, chain: value }))
                }
              >
                <SelectTrigger className="w-[80px]">
                  <SelectValue placeholder={<TokenETH className="w-6 h-6" />} />
                </SelectTrigger>
                <SelectContent className="w-[80px]">
                  <SelectItem value="eth">
                    <TokenETH className="w-6 h-6" />
                  </SelectItem>
                  <SelectItem value="sol">
                    <TokenSOL className="w-6 h-6" />
                  </SelectItem>
                  <SelectItem value="push">
                    <TokenPUSH className="w-6 h-6" />
                  </SelectItem>
                  <SelectItem value="bnb">
                    <TokenBNB className="w-6 h-6" />
                  </SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="Add recipient"
                value={newRecipient.address}
                onChange={handleNewRecipientChange}
              />
              <Button onClick={handleAddRecipient}>Add</Button>
            </div>
          </div>
          <Input
            name="subject"
            placeholder="subject"
            value={emailData.subject}
            onChange={handleInputChange}
          />
          <Textarea
            name="message"
            placeholder="message"
            className="min-h-[400px]"
            value={emailData.message}
            onChange={handleInputChange}
          />
          <Input type="file" onChange={handleFileUpload} />
          <Button onClick={sendHandler} disabled={sendingMail}>
            {sendingMail ? 'Sending' : 'Send'}
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default NewEmail;
