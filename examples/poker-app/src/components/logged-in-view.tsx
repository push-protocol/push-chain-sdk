import { useEffect, useState } from 'react';
import { hexToBytes } from 'viem';
import Navbar from './navbar';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Poker } from '../services/poker';
import { useAppContext } from '../context/app-context';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { PokerGame } from '../temp_types/types';
import PushNetwork from '@pushprotocol/node-core';
import { useSignMessage } from 'wagmi';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import Game from './game';

export default function LoggedInView() {
  const [friendsWallets, setFriendsWallets] = useState<string[]>([]);
  const [loadingStartGame, setLoadingStartGame] = useState<boolean>(false);
  const [walletInput, setWalletInput] = useState<string>('');
  const [recommendedWallets, setRecommendedWallets] = useState<string[]>([]);
  const { user } = usePrivy();
  const { pushAccount, pushNetwork, setGameStarted, gameStarted } =
    useAppContext();
  const { wallets } = useSolanaWallets();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    const storedAddresses = localStorage.getItem('poker-friends-wallets');
    if (storedAddresses) {
      setRecommendedWallets(JSON.parse(storedAddresses));
    }
  }, []);

  const address: string = pushAccount
    ? pushAccount
    : user?.wallet?.chainType === 'solana'
    ? `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${user?.wallet?.address}`
    : `${user?.wallet?.chainId}:${user?.wallet?.address}`;

  const handleAddFriend = (recommendedWallet?: string) => {
    if (friendsWallets.length >= 4) {
      toast.error('Only a maximum of 4 players can be added.');
      return;
    }
    if (walletInput) {
      if (
        walletInput.startsWith('solana:') ||
        walletInput.startsWith('eip155:')
      ) {
        setFriendsWallets([...friendsWallets, walletInput]);
        setWalletInput('');

        // Save to local storage for recommended wallets
        if (!recommendedWallets.includes(walletInput)) {
          const updatedRecommendedWallets = [
            ...recommendedWallets,
            walletInput,
          ];
          localStorage.setItem(
            'poker-friends-wallets',
            JSON.stringify(updatedRecommendedWallets)
          );
        }
      } else {
        toast.error(
          `Wallet should be in CAIP10 format or PUSH format (e.g. eip155:1:0x1234567890)`
        );
      }
    } else if (recommendedWallet) {
      if (
        recommendedWallet.startsWith('solana:') ||
        recommendedWallet.startsWith('eip155:')
      ) {
        setFriendsWallets([...friendsWallets, recommendedWallet]);
        setRecommendedWallets(
          recommendedWallets.filter((w) => w !== recommendedWallet)
        );

        // Save to local storage for recommended wallets
        if (!recommendedWallets.includes(recommendedWallet)) {
          const updatedRecommendedWallets = [
            ...recommendedWallets,
            recommendedWallet,
          ];
          localStorage.setItem(
            'poker-friends-wallets',
            JSON.stringify(updatedRecommendedWallets)
          );
        }
      } else {
        toast.error(
          `Wallet should be in CAIP10 format or PUSH format (e.g. eip155:1:0x1234567890)`
        );
      }
    }
  };

  const handleRemoveFriend = (wallet: string) => {
    setFriendsWallets(friendsWallets.filter((w) => w !== wallet));
  };

  const handleStartGame = async () => {
    try {
      setLoadingStartGame(true);
      const poker = await Poker.initialize(ENV.DEV);

      const pokerGame: PokerGame = {
        players: [
          ...friendsWallets.map((walletAddress) => ({
            address: walletAddress,
            chips: 100,
            cards: [],
            isDealer: false,
          })),
          {
            address: address,
            chips: 100,
            cards: [],
            isDealer: true,
          },
        ],
        phases: [],
        cards: [],
        pot: 0,
        creator: address,
      };

      await poker.send(pokerGame, [address, ...friendsWallets], {
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
      });
      setGameStarted(true);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStartGame(false);
    }
  };

  return (
    <div>
      <Navbar />
      <ToastContainer />
      {gameStarted ? (
        <Game />
      ) : (
        <div className="flex flex-col items-center justify-center h-full w-full">
          <h1 className="text-4xl font-bold">Poker App</h1>
          <p className="text-gray-500 mt-2">
            Poker is better when you play with friends!
          </p>
          <div className="flex flex-row items-center justify-center gap-2 w-full mt-8">
            <input
              type="text"
              placeholder="Enter friend's wallet address"
              className="border-2 border-gray-300 rounded-md p-2 w-1/3"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
            />
            <button
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => handleAddFriend()}
              disabled={!walletInput}
            >
              Add Friend
            </button>
          </div>

          {recommendedWallets.length > 0 && (
            <div className="flex flex-col items-center justify-center gap-1 w-full mt-8">
              <h2 className="text-2xl font-bold text-gray-500">
                Previously added friends
              </h2>
              <h3 className="text-gray-500">
                Select one of those to start a game faster ;P
              </h3>
              {recommendedWallets.map((wallet) => (
                <div
                  className="flex flex-row items-center justify-center gap-2"
                  key={wallet}
                >
                  <span
                    className="bg-gray-200 rounded-md p-2 cursor-pointer text-sm"
                    onClick={() => handleAddFriend(wallet)}
                  >
                    {wallet}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col items-center justify-center gap-2 w-full mt-8">
            {friendsWallets.map((wallet) => (
              <div
                className="flex flex-row items-center justify-center gap-2"
                key={wallet}
              >
                <span>{wallet}</span>
                <button
                  className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-1 rounded"
                  onClick={() => handleRemoveFriend(wallet)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          {friendsWallets.length > 0 && (
            <button
              className="bg-green-500 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full shadow-lg mt-32 transition-transform transform hover:scale-105"
              onClick={handleStartGame}
              disabled={loadingStartGame}
            >
              {loadingStartGame ? (
                <div className="flex flex-row items-center justify-center">
                  <svg
                    className="animate-spin h-5 w-5 mr-3 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    ></path>
                  </svg>
                  Starting Game...
                </div>
              ) : (
                'Start Game'
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}