import { useEffect, useState, useContext } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { useConnectWallet } from "@web3-onboard/react";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { getConfessions } from "../../services/getConfessions";
import { performUpVote } from "../../services/performUpVote";
import { ConfessionContext } from "../../context/ConfessionContext";
import { usePushWalletContext } from '@pushprotocol/pushchain-ui-kit';

const ProfilePage = () => {
  const [{ wallet }, , disconnect] = useConnectWallet();
  const [confessions, setConfessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const { handleSendSignRequestToPushWallet } = usePushWalletContext();

  const { pushWalletAddress, user } = useContext(ConfessionContext);

  const confessionsCacheKey = "confessionsCache";

  // Utility to truncate wallet addresses
  const truncateAddress = (address) => {
    if (!address) return "N/A";
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Preserve wallet state on reload
  useEffect(() => {
    const walletConnected = sessionStorage.getItem("walletConnected");
    if (walletConnected && !wallet) {
      navigate("/");
    }
  }, [wallet, navigate]);

  // Fetch confessions (with caching)
  useEffect(() => {
    const fetchConfessions = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Load cached data
        const cachedConfessions = localStorage.getItem(confessionsCacheKey);
        if (cachedConfessions) {
          const parsed = JSON.parse(cachedConfessions);
          if (Array.isArray(parsed)) {
            setConfessions(parsed);
            setIsLoading(false);
          }
        }

        // Fetch new data
        const newConfessions = await getConfessions();
        if (Array.isArray(newConfessions)) {
          setConfessions(newConfessions);
          localStorage.setItem(confessionsCacheKey, JSON.stringify(newConfessions));
        } else {
          throw new Error('Invalid confessions data received');
        }
      } catch (err) {
        setError('Failed to fetch confessions. Please try again later.');
        console.error('Error fetching confessions:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfessions();

    const interval = setInterval(fetchConfessions, 15000);
    return () => clearInterval(interval);
  }, []);

  // Filter confessions based on search with validation
  const filteredConfessions = confessions.filter((confession) => {
    if (!confession || typeof confession !== 'object') return false;
    if (!confession.post || typeof confession.post !== 'string') return false;
    return confession.post.toLowerCase().includes((searchQuery || '').toLowerCase());
  });

  const handleUpvote = async (wallet, upVoteCount, txnHash) => {
    try {
      if (pushWalletAddress) {
        await performUpVote(user, pushWalletAddress, upVoteCount, txnHash, handleSendSignRequestToPushWallet);
      } else {
        await performUpVote(user, wallet, upVoteCount, txnHash);
      }
      setConfessions((prev) =>
        prev.map((c) =>
          c.txnHash === txnHash ? { ...c, upVoteCount: c.upVoteCount + 1 } : c
        )
      );
    } catch (error) {
      console.error('Error performing upvote:', error);
      // You might want to show this error to the user via a toast or alert
    }
  };

  return (
    <Container>
      <Header>
        <Logo>
          <Highlighted>Web3</Highlighted> Rumours
        </Logo>
        <Nav>
          <NavButton onClick={() => navigate("/sent")}>
            📤 Sent Rumours
          </NavButton>
          <NavButton onClick={() => navigate("/post")}>
            ✍️ Post a Rumour
          </NavButton>
        </Nav>
        <SearchBar
          type="text"
          placeholder="Search rumours..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <WalletInfo>
          <WalletAddress>
            {wallet || pushWalletAddress
              ? `Connected: ${pushWalletAddress
                  ? truncateAddress(pushWalletAddress)
                  : truncateAddress(wallet?.accounts?.[0]?.address)}`
              : "Not Connected"}
          </WalletAddress>
          <DisconnectButton
            onClick={async () => {
              if (wallet) {
                await disconnect(wallet);
                sessionStorage.clear();
                navigate("/");
              }
            }}
          >
            {wallet || pushWalletAddress ? "Disconnect" : "Connect Wallet"}
          </DisconnectButton>
        </WalletInfo>
      </Header>

      <FeedContainer>
        {isLoading ? (
          <Loader>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1 }}
              style={{
                fontSize: "2rem",
                marginBottom: "20px",
                display: "inline-block",
              }}
            >
              ⏳
            </motion.div>
            <WittyText>Loading your personalized buzz...</WittyText>
          </Loader>
        ) : error ? (
          <ErrorMessage>{error}</ErrorMessage>
        ) : filteredConfessions.length === 0 ? (
          <EmptyState>No rumours match your search. Try again!</EmptyState>
        ) : (
          <FeedList>
            {filteredConfessions.map((confession, index) => (
              <FeedItem
                as={motion.div}
                key={confession.txnHash || index}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 300 }}
              >
                <ConfessionContent>
                  <ConfessionText>
                    <ReactMarkdown>{confession.post || 'No content available'}</ReactMarkdown>
                  </ConfessionText>
                  <Details>
                    <Address>{`By: ${truncateAddress(confession.address)}`}</Address>
                    <UpvoteButton
                      onClick={() =>
                        handleUpvote(
                          wallet,
                          confession.upVoteCount || 0,
                          confession.txnHash
                        )
                      }
                    >
                      👍 {confession.upVoteCount || 0}
                    </UpvoteButton>
                  </Details>
                </ConfessionContent>
              </FeedItem>
            ))}
          </FeedList>
        )}
      </FeedContainer>
    </Container>
  );
};

export default ProfilePage;

// Add new styled component for error message
const ErrorMessage = styled.div`
  text-align: center;
  color: #dc3545;
  padding: 20px;
  margin: 20px 0;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

// Styled Components
const Container = styled.div`
  font-family: "Inter", sans-serif;
  background: linear-gradient(120deg, #f0f9ff, #e9f5f9);
  min-height: 100vh;
`;

const Header = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  position: sticky;
  top: 0;
  z-index: 10;

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: flex-start;
  }
`;

const Logo = styled.h1`
  font-size: 1.5rem;
  font-weight: bold;
  color: #007aff;
`;

const Highlighted = styled.span`
  color: #ff3b57;
`;

const Nav = styled.div`
  display: flex;
  gap: 15px;

  @media (max-width: 768px) {
    margin-top: 10px;
    width: 100%;
    justify-content: space-between;
  }
`;

const NavButton = styled.button`
  background: linear-gradient(120deg, #007aff, #005bb5);
  color: #ffffff;
  padding: 8px 15px;
  border: none;
  border-radius: 20px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.05);
  }

  @media (max-width: 768px) {
    width: 100%;
    text-align: center;
  }
`;

const SearchBar = styled.input`
  background: #f7f7f7;
  border: 1px solid #ddd;
  padding: 6px 10px;
  border-radius: 20px;
  width: 200px;

  @media (max-width: 768px) {
    width: 100%;
    margin: 10px 0;
  }
`;

const WalletInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;

  @media (max-width: 768px) {
    align-items: flex-start;
    width: 100%;
  }
`;

const WalletAddress = styled.span`
  font-size: 0.9rem;
  color: #333;
`;

const DisconnectButton = styled.button`
  background-color: #6c63ff;
  color: #ffffff;
  padding: 5px 15px;
  border: none;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    background-color: #4b4aee;
  }
`;

const FeedContainer = styled.div`
  padding: 20px;
`;

const FeedList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 15px;
`;

const FeedItem = styled.div`
  background: linear-gradient(120deg, #ffffff, #f7f8fa);
  border: 1px solid #dee2e6;
  border-radius: 12px;
  padding: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
`;

const ConfessionContent = styled.div`
  display: flex;
  flex-direction: column;
`;

const ConfessionText = styled.div`
  font-size: 1rem;
  color: #495057;
  margin-bottom: 10px;
`;

const Details = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Address = styled.span`
  font-style: italic;
  color: #6c757d;
`;

const UpvoteButton = styled.button`
  background: #007aff;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 5px 10px;
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    background: #005bb5;
  }
`;

const Loader = styled.div`
  text-align: center;
  margin-top: 50px;
`;

const WittyText = styled.p`
  font-size: 1.2rem;
  color: #6c757d;
  margin-top: 10px;
`;

const EmptyState = styled.div`
  text-align: center;
  font-size: 1rem;
  color: #6c757d;
  margin-top: 30px;
`;
