import { useEffect, useState } from 'react';
import { usePokerGameContext } from './usePokerGameContext.tsx';
import usePushWalletSigner from './usePushSigner.tsx';
import useConnectedPushAddress from './useConnectedPushAddress.tsx';
import BN from 'bn.js';
import { deckOfCards, shuffleCards } from '../lib/cards.ts';
import { commutativeEncrypt } from '../encryption';
import { curve } from 'elliptic';
import BasePoint = curve.base.BasePoint;
import { usePlayerAddressUtils } from './usePlayerAddressUtils.tsx';

/**
 * This hook is responsible for the initial card dealing algorithm.
 * The first player responsible for dealing the cards is the dealer. Then we encrypt following the
 * order of player from the player's array until the last player encrypts and shuffles the deck of cards.
 */
export default function useSubmitEncryptedShuffledCards() {
  const [hasFinishedEncryptingCards, setHasFinishedEncryptingCards] =
    useState(false);
  const {
    game,
    myEncryptionKeys,
    otherPlayersPublicKey,
    pokerService,
    gameTransactionHash,
  } = usePokerGameContext();
  const { pushWalletSigner } = usePushWalletSigner();
  const { connectedPushAddressFormat } = useConnectedPushAddress();
  const { getNextPlayerAddress } = usePlayerAddressUtils();

  /**
   * Function called only once when starting the deck shuffling. Function can only
   * be called by **game creator**
   * @param publicKey - Next player's public key in the array of player's order
   * @param privateKey - Connected user private key
   */
  function beginShuffleDeck(publicKey: BasePoint, privateKey: BN): Set<BN> {
    const cards = deckOfCards();
    const shuffledCards = shuffleCards(cards);
    const encryptedShuffledCards = new Set<BN>();
    shuffledCards.forEach((card) => {
      const message = new BN(card);
      // TODO: Add proof
      const encryptedCard = commutativeEncrypt(message, publicKey, privateKey);
      encryptedShuffledCards.add(encryptedCard);
    });
    return encryptedShuffledCards;
  }

  function shuffleDeck(
    publicKey: BasePoint,
    privateKey: BN,
    cards: Set<BN>
  ): Set<BN> {
    const shuffledCards = shuffleCards(cards);
    const encryptedShuffledCards = new Set<BN>();
    shuffledCards.forEach((card) => {
      const encryptedCard = commutativeEncrypt(card, publicKey, privateKey);
      encryptedShuffledCards.add(encryptedCard);
    });
    return encryptedShuffledCards;
  }

  useEffect(() => {
    if (!game || !pokerService || !gameTransactionHash) return;
    const intervalId = setInterval(async () => {
      try {
        if (
          !game ||
          !pushWalletSigner ||
          !pokerService ||
          !gameTransactionHash ||
          !connectedPushAddressFormat
        )
          return;
        // We can only start dealing the cards once all public keys have been given, and we have generated
        // our own encryption keys
        if (
          otherPlayersPublicKey.size + 1 !== game.players.size ||
          !myEncryptionKeys
        ) {
          return;
        }

        if (hasFinishedEncryptingCards) return;

        // Only Dealer can **start** shuffling the deck
        if (connectedPushAddressFormat == game.dealer) {
          const playerAfterDealer = getNextPlayerAddress(
            game,
            connectedPushAddressFormat
          );
          const publicKeyPlayerAfterDealer =
            otherPlayersPublicKey.get(playerAfterDealer);
          if (!publicKeyPlayerAfterDealer) return;
          const encryptedShuffleDeck = beginShuffleDeck(
            publicKeyPlayerAfterDealer,
            myEncryptionKeys.privateKey
          );
          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            encryptedShuffleDeck,
            pushWalletSigner
          );
        } else {
          // Check if it's our turn to shuffle the deck.
          // How do we do that?
          // We go over the player's array in order, and check if there is a transaction for the address
          // right before our connected address. If there isn't, then mean it's not our turn yet to shuffle
          // the deck. If there is, then it's our turn.

          const playersArray = Array.from(game.players.keys());
          const connectedUserIndex = playersArray.indexOf(
            connectedPushAddressFormat
          );

          // 3 players playing: [0xA, 0xB, 0xC]
          // If Connected Player is 0xA. So we have to check if there is a transaction from 0xC
          // If Connected Player is 0xC. So we have to check if there is a transaction from 0xB
          let previousPlayerAddress: string;
          if (connectedUserIndex === 0) {
            previousPlayerAddress = playersArray[playersArray.length - 1];
          } else {
            previousPlayerAddress = playersArray[connectedUserIndex - 1];
          }

          const encryptedDeckFromPreviousPlayer =
            await pokerService.getEncryptedShuffledCards(
              gameTransactionHash,
              previousPlayerAddress
            );
          if (!encryptedDeckFromPreviousPlayer) return; // No transaction from previous player yet, we just have to wait

          // Get next player public key
          const nextPlayerAddress = getNextPlayerAddress(
            game,
            connectedPushAddressFormat
          );
          const publicKeyNextPlayer =
            otherPlayersPublicKey.get(nextPlayerAddress);
          if (!publicKeyNextPlayer) return;

          // Shuffle and encrypt
          const shuffledCards = shuffleDeck(
            publicKeyNextPlayer,
            myEncryptionKeys.privateKey,
            encryptedDeckFromPreviousPlayer
          );
          // Publish new deck
          await pokerService.publishEncryptedShuffledCards(
            gameTransactionHash,
            game.creator,
            shuffledCards,
            pushWalletSigner
          );
        }
      } catch (e) {
        console.log(e);
      }
    }, 2000);

    return () => clearInterval(intervalId);
  }, [game, pokerService]);

  useEffect(() => {
    if (pokerService && gameTransactionHash && game) {
      const intervalId = setInterval(async () => {
        let lastAddressToEncrypt: string;
        // Check dealer position. If dealer is index 0 of array, then last player to encrypt is players.length-1
        // If dealer is any other index, then last player to encrypt is index-1
        const playersAddress = Array.from(game.players.keys());
        const indexOfDealer = playersAddress.indexOf(game.dealer);
        if (indexOfDealer === 0) {
          lastAddressToEncrypt = playersAddress[playersAddress.length - 1];
        } else {
          lastAddressToEncrypt = playersAddress[indexOfDealer - 1];
        }

        const cards = await pokerService.getEncryptedShuffledCards(
          gameTransactionHash,
          lastAddressToEncrypt
        );
        if (cards) setHasFinishedEncryptingCards(true);
      }, 2000);

      return () => clearInterval(intervalId);
    }
  }, [pokerService, gameTransactionHash, game]);

  return { hasFinishedEncryptingCards };
}