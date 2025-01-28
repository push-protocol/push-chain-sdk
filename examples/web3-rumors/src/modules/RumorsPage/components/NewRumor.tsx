import { useState, useRef } from 'react';
import {
  Box,
  Button,
  Cross,
  Mail,
  Text,
  TextArea,
  css,
} from 'shared-components';
import { SymbolBox, trimAddress } from '@/common';
import RumorItem from './RumorItem';
import { useAppContext } from '@/context/AppContext';
import { postConfession } from '@/services/postConfession';
import Bold from '@/common/icons/Bold';
import Italic from '@/common/icons/Italic';
import Strikethrough from '@/common/icons/Strikethrough';
import Quote from '@/common/icons/Quote';
import Link from '@/common/icons/Link';

const NewRumor = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState({
    bold: false,
    italic: false,
    strikethrough: false,
    quote: false,
    link: false,
  });
  const [loading, setLoading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { account, pushNetwork, handleSendSignRequestToPushWallet } =
    useAppContext();

  const insertText = (before: string, after = '') => {
    const textarea = textareaRef.current;
    if (textarea) {
      const { selectionStart, selectionEnd } = textarea;
      const start = text.slice(0, selectionStart);
      const middle = text.slice(selectionStart, selectionEnd);
      const end = text.slice(selectionEnd);

      setText(`${start}${before}${middle}${after}${end}`);

      setTimeout(() => {
        textarea.focus();
        const cursorPosition = selectionStart + before.length + middle.length;
        textarea.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
    }
  };

  const handlePost = async () => {
    if (!account) return;
    if (!text.trim()) {
      alert('Please write something to post your rumour.');
      return;
    }

    setLoading(true);

    const date = new Date();

    const rumourDetails = {
      post: text,
      address: account,
      upvotes: 0,
      isVisible: true,
      timestamp: date.toISOString(),
    };

    try {
      if (pushNetwork) {
        await postConfession(
          pushNetwork,
          account,
          rumourDetails,
          handleSendSignRequestToPushWallet
        );
      }
      setText('');
    } catch (error) {
      console.error('Error posting rumour:', error);
      alert('Failed to post your rumour. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!isOpen && (
        <Box
          position="fixed"
          css={css`
            z-index: 10;
            right: 1.25rem;
            bottom: 1.25rem;
          `}
        >
          <Button
            size="large"
            leadingIcon={<Mail />}
            css={css`
              border-radius: var(--radius-md);
              background: #0056d0 !important;
            `}
            onClick={() => setIsOpen(true)}
          >
            <Text
              variant="h5-regular"
              color="text-primary-inverse"
              display={{ initial: 'block', ml: 'none' }}
            >
              Post a Rumor
            </Text>
          </Button>
        </Box>
      )}
      {isOpen && (
        <Box
          backgroundColor="surface-secondary"
          boxShadow="-2px 2px 7.8px 0px rgba(0, 0, 0, 0.25)"
          borderRadius="radius-md"
          position="fixed"
          width="80%"
          height="80%"
          padding="spacing-md"
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap="spacing-md"
          css={css`
            z-index: 999;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
          `}
        >
          <Box position="relative" width="100%" textAlign="center">
            <Text variant="h3-bold">Post Rumor</Text>
            <Box
              position="absolute"
              cursor="pointer"
              css={css`
                right: 0;
                top: 0;
              `}
            >
              <Cross size={27} onClick={() => setIsOpen(false)} />
            </Box>
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            borderRadius="radius-md"
            width="100%"
            padding="spacing-md"
            gap="spacing-sm"
            backgroundColor="surface-primary"
            css={css`
              box-sizing: border-box;
            `}
          >
            <Box display="flex" gap="spacing-xxs">
              <SymbolBox
                onClick={() => {
                  insertText('**', '**');
                  setSelected((prev) => ({ ...prev, bold: !prev.bold }));
                }}
              >
                <Bold size={14} color="icon-primary" />
              </SymbolBox>
              <SymbolBox
                onClick={() => {
                  insertText('_', '_');
                  setSelected((prev) => ({ ...prev, italic: !prev.italic }));
                }}
              >
                <Italic size={14} color="icon-primary" />
              </SymbolBox>
              <SymbolBox
                onClick={() => {
                  insertText('~~', '~~');
                  setSelected((prev) => ({
                    ...prev,
                    strikethrough: !prev.strikethrough,
                  }));
                }}
              >
                <Strikethrough size={14} color="icon-primary" />
              </SymbolBox>
              <SymbolBox
                onClick={() => {
                  insertText('> ');
                  setSelected((prev) => ({ ...prev, quote: !prev.quote }));
                }}
              >
                <Quote size={14} color="icon-primary" />
              </SymbolBox>
              <SymbolBox
                onClick={() => {
                  insertText('[', '](url)');
                  setSelected((prev) => ({ ...prev, link: !prev.link }));
                }}
              >
                <Link size={16} color="icon-primary" />
              </SymbolBox>
            </Box>
            <TextArea
              ref={textareaRef}
              onChange={(e) => setText(e.target.value)}
              value={text}
              placeholder="Write your rumour here....... (Markdown Supported!)"
              numberOfLines={8}
            />
          </Box>
          <Box
            display="flex"
            flexDirection="column"
            borderRadius="radius-md"
            width="100%"
            padding="spacing-md"
            gap="spacing-xs"
            backgroundColor="surface-primary"
            css={css`
              box-sizing: border-box;
            `}
          >
            <Text variant="h5-bold">Rumor Preview</Text>
            <RumorItem
              address={trimAddress(account || '')}
              upVoteCount={0}
              markdownPost={text}
              post=""
              upvotes={0}
              isVisible
              txnHash=""
            />
          </Box>
          <Button
            onClick={handlePost}
            css={css`
              border-radius: var(--radius-md);
              background: #0056d0 !important;
            `}
            leadingIcon={<Mail />}
          >
            <Text
              variant="h5-regular"
              color="text-primary-inverse"
              display={{ initial: 'block', ml: 'none' }}
            >
              Post a Rumor
            </Text>
          </Button>
        </Box>
      )}
    </>
  );
};

export default NewRumor;
