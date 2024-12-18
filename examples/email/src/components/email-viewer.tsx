import React, { useState } from 'react';
import { useAppContext } from '@/context/app-context';
import { Card, CardFooter } from './ui/card';
import {
  File,
  FileText,
  Image,
  Music,
  Video,
  Archive,
  Code,
  ReplyIcon,
} from 'lucide-react';
import { formatTimestamp, trimAddress } from '@/lib/utils';
import { FileAttachment, FileAttachments, IEmail } from '@/types';
import { Box, Text, Button, Back } from 'shared-components';
import BlockiesSvg from 'blockies-react-svg';
import { useNavigate } from 'react-router-dom';
import { css } from 'styled-components';

interface EmailViewerProps {
  onReply: (email: IEmail) => void;
}

const EmailViewer: React.FC<EmailViewerProps> = ({ onReply }) => {
  const { currTab, selectedEmail, setSelectedEmail } = useAppContext();
  const navigate = useNavigate();

  const handleReply = () => {
    if (selectedEmail) {
      onReply(selectedEmail);
    }
  };

  const formatEmailBody = (body: string) => {
    const lines = body.split('\n');
    const formattedBody = [];
    let inQuote = false;

    for (const line of lines) {
      if (line.startsWith('On') && line.includes('wrote:')) {
        inQuote = true;
        formattedBody.push(
          <div key={formattedBody.length} className="text-gray-500 mt-4">
            {line}
          </div>
        );
      } else if (inQuote) {
        formattedBody.push(
          <div
            key={formattedBody.length}
            className="text-gray-500 border-l-4 border-gray-300 pl-2"
          >
            {line}
          </div>
        );
      } else {
        formattedBody.push(<div key={formattedBody.length}>{line}</div>);
      }
    }

    return formattedBody;
  };

  const handleBack = () => {
    navigate(`/${currTab}`);
    setSelectedEmail(null);
  };

  return (
    <>
      {selectedEmail && (
        <Card className="w-full h-fit flex-1 py-6 px-4 md:px-8 gap-6">
          <Box cursor="pointer" onClick={handleBack}>
            <Back size={24} />
          </Box>
          <Box
            display="flex"
            justifyContent="space-between"
            alignSelf="stretch"
          >
            <Box
              display="flex"
              flexDirection="column"
              gap="spacing-xs"
              width="100%"
            >
              <Box
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                width="100%"
                css={css`
                  padding-left: 48px;
                  @media (max-width: 768px) {
                    padding-left: 0px;
                  }
                `}
              >
                <Text variant="h4-semibold">{selectedEmail.subject}</Text>
                <Box>
                  <Text variant="bes-semibold">
                    {formatTimestamp(selectedEmail.timestamp.toString(), true)}
                  </Text>
                </Box>
              </Box>
              <Box display="flex" gap="spacing-xxs">
                <Box
                  width="40px"
                  height="40px"
                  borderRadius="radius-round"
                  overflow="hidden"
                  alignSelf="center"
                >
                  <BlockiesSvg address={selectedEmail.from} />
                </Box>
                <Box display="flex" flexDirection="column" gap="spacing-xxxs">
                  <Text variant="bes-semibold">
                    {trimAddress(selectedEmail.from)}
                  </Text>
                  <Text variant="bes-semibold" color="text-tertiary">
                    To:{' '}
                    {selectedEmail.to
                      .map((address) => trimAddress(address))
                      .join(', ')}
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>
          <Box
            css={css`
              padding: 0px 48px;
              @media (max-width: 768px) {
                padding: 0px;
              }
            `}
          >
            <Text variant="bs-regular">
              {formatEmailBody(selectedEmail.body)}
            </Text>
            {selectedEmail.attachments &&
              selectedEmail.attachments.length > 0 && (
                <CardFooter>
                  <AttachmentList attachments={selectedEmail.attachments!} />
                </CardFooter>
              )}
          </Box>
          <Box
            gap="spacing-xxs"
            css={css`
              padding: 0px 48px;
              @media (max-width: 768px) {
                padding: 0px;
              }
            `}
          >
            <Button
              onClick={handleReply}
              variant="outline"
              size="extraSmall"
              leadingIcon={<ReplyIcon width={16} height={16} />}
            >
              Reply
            </Button>
          </Box>
        </Card>
      )}
    </>
  );
};

const AttachmentList: React.FC<{ attachments: FileAttachments }> = ({
  attachments,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleDownload = (attachment: FileAttachment) => {
    const decodedContent = atob(attachment.content);
    const blob = new Blob([decodedContent], { type: attachment.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/'))
      return <Image className="w-6 h-6 text-blue-500" />;
    if (type.startsWith('audio/'))
      return <Music className="w-6 h-6 text-green-500" />;
    if (type.startsWith('video/'))
      return <Video className="w-6 h-6 text-red-500" />;
    if (
      type.startsWith('application/zip') ||
      type.startsWith('application/x-rar-compressed')
    )
      return <Archive className="w-6 h-6 text-yellow-500" />;
    if (type === 'text/plain')
      return <FileText className="w-6 h-6 text-gray-500" />;
    if (type === 'application/pdf')
      return <File className="w-6 h-6 text-red-500" />;
    if (type.startsWith('application/'))
      return <Code className="w-6 h-6 text-purple-500" />;
    return <File className="w-6 h-6 text-gray-500" />;
  };

  return (
    <div className="p-4 bg-gray-100 rounded-lg">
      <h2 className="text-lg font-semibold mb-4 text-gray-700">Attachments</h2>
      <ul className="space-y-2">
        {attachments.map((attachment, index) => (
          <li
            key={index}
            className={`flex items-center p-2 rounded-md transition-colors duration-200 ${
              hoveredIndex === index ? 'bg-blue-100' : 'bg-white'
            }`}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div className="flex items-center flex-grow">
              {getFileIcon(attachment.type)}
              <span className="ml-3 text-sm font-medium text-gray-700">
                {attachment.filename}
              </span>
            </div>
            <button
              onClick={() => handleDownload(attachment)}
              className="ml-2 text-sm text-blue-600 hover:text-blue-800 focus:outline-none"
            >
              Download
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
export default EmailViewer;
