import NewEmail from './new-email';
import EmailLayout from './email-layout';
import { Header } from './Header';
import { Text, Box, TextInput, Tabs } from 'shared-components';
import { useAppContext } from '@/context/app-context';
import { css } from 'styled-components';
import { EMAIL_BOX } from '@/constants';
import EmailList from './email-list';
import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

const LoggedInView = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const {
    currTab,
    setCurrTab,
    emails,
    searchInput,
    setSearchInput,
    setSelectedEmail,
    selectedEmail,
    replyTo,
  } = useAppContext();

  const handleTabSwitch = (tab: 'inbox' | 'sent') => {
    setCurrTab(tab);
    // navigate(`/${tab}`);
  };

  useEffect(() => {
    if (location.pathname.includes('sent')) {
      setCurrTab('sent');
    } else {
      setCurrTab('inbox');
    }
  }, [location.pathname]);

  useEffect(() => {
    if (id) {
      const emailList = emails[currTab];
      if (emailList && emailList.length > 0) {
        const email = emailList.find((email) => email.txHash === id);

        if (email) {
          setSelectedEmail(email);
        } else {
          navigate(`/${currTab}`);
        }
      }
    } else {
      setSelectedEmail(null);
    }
  }, [id, emails, currTab, navigate]);

  console.log(selectedEmail);

  return (
    <div className="relative w-full h-[100vh] flex flex-col">
      <Header />

      {/* <div className="hidden md:block">
        <NewEmail />
      </div> */}
      <Box width="100%" height="100%" display="flex">
        <Box
          display="flex"
          flexDirection="column"
          height="100%"
          padding="spacing-md spacing-none"
          css={css`
            border-right: 1px solid #eaebf2;
            width: 30%;
            @media (max-width: 1024px) {
              width: 35%;
            }
            @media (max-width: 768px) {
              display: ${selectedEmail ? 'none' : 'flex'};
              width: ${selectedEmail ? '0%' : '100%'};
            }
          `}
        >
          <NewEmail replyTo={replyTo} />
          <Box
            display="flex"
            flexDirection="column"
            padding="spacing-none spacing-sm"
            gap="spacing-xs"
            alignItems="flex-start"
            css={css`
              border-bottom: 1px solid var(--stroke-secondary);
            `}
          >
            <Text variant="h3-semibold">Inbox</Text>
            <TextInput
              placeholder="Search for a sender address"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              css={css`
                width: 100%;
              `}
            />
            <Tabs
              variant="fill"
              activeKey={currTab}
              onChange={(tab) => handleTabSwitch(tab as 'inbox' | 'sent')}
              items={[
                {
                  key: 'inbox',
                  label: <Text variant="h5-semibold">Inbox</Text>,
                  children: null,
                },
                {
                  key: 'sent',
                  label: <Text variant="h5-semibold">Sent</Text>,
                  children: null,
                },
              ]}
            />
          </Box>
          {currTab === 'inbox' && <EmailList type={EMAIL_BOX.INBOX} />}
          {currTab === 'sent' && <EmailList type={EMAIL_BOX.SENT} />}
        </Box>
        <Box
          height="100%"
          css={css`
            width: 70%;
            @media (max-width: 1024px) {
              width: 65%;
            }
            @media (max-width: 768px) {
              display: ${selectedEmail ? 'flex' : 'none'};
              width: ${selectedEmail ? '100%' : '0%'};
            }
          `}
        >
          <EmailLayout />
        </Box>
      </Box>
    </div>
  );
};

export default LoggedInView;
