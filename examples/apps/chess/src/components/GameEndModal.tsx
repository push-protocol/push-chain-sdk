import { GAME_RESULT, PIECE_COLOR } from '@/common';
import { useChess } from '@/hooks/useChess';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, css, Text } from 'shared-components';

interface GameEndModalProps {
  isOpen: boolean;
  gameStatus: GAME_RESULT;
  pieceColor: PIECE_COLOR;
  gameType: 'multiplayer' | 'bot';
  handleNewGame: () => void;
}

const GameEndModal: React.FC<GameEndModalProps> = ({
  isOpen,
  gameStatus,
  pieceColor,
  gameType,
  handleNewGame,
}) => {
  const [showLoader, setShowLoader] = useState(false);

  const { startMultiplayer } = useChess();
  const navigate = useNavigate();

  const getModalText = useMemo(() => {
    if (gameStatus === GAME_RESULT.WIN) return 'You Won!';
    if (gameStatus === GAME_RESULT.LOSE) return 'Opponent Won!';
    if (gameStatus === GAME_RESULT.FORFEIT) return 'Game Forfeit';
    return 'Draw';
  }, [gameStatus]);

  if (!isOpen) return null;

  const handleBack = () => {
    navigate('/home');
  };

  const handleClick = async () => {
    if (gameType === 'multiplayer') {
      setShowLoader(true);
      try {
        await startMultiplayer();
        handleNewGame();
      } catch (err) {
        console.log(err);
      } finally {
        setShowLoader(false);
      }
    } else {
      handleNewGame();
    }
  };

  return (
    <Box
      position="fixed"
      width="100vw"
      height="100vh"
      display="flex"
      justifyContent="center"
      alignItems="center"
      css={css`
        background-color: rgba(0, 0, 0, 0.6);
        z-index: 9999;
        backdrop-filter: blur(8px);
      `}
    >
      <Box
        padding="spacing-md"
        borderRadius="radius-sm"
        width="360px"
        textAlign="center"
        display="flex"
        flexDirection="column"
        alignItems="center"
        gap="spacing-md"
        margin="spacing-sm"
        css={css`
          background-color: #202124;
          z-index: 9999;
        `}
      >
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap="spacing-sm"
          width="100%"
        >
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="76px"
            height="77px"
            gap="spacing-sm"
          >
            {(gameStatus === GAME_RESULT.WIN ||
              gameStatus === GAME_RESULT.DRAW) && (
              <img
                src={`/pieces/${
                  pieceColor === PIECE_COLOR.WHITE ? 'wK' : 'bK'
                }.png`}
                alt="Game End"
                height="77px"
              />
            )}
            {(gameStatus === GAME_RESULT.LOSE ||
              gameStatus === GAME_RESULT.DRAW ||
              gameStatus === GAME_RESULT.FORFEIT) && (
              <img
                src={`/pieces/${
                  pieceColor === PIECE_COLOR.WHITE ? 'bK' : 'wK'
                }.png`}
                alt="Game End"
                height="77px"
              />
            )}
          </Box>

          <Text variant="h4-semibold" color="text-primary-inverse">
            {getModalText}
          </Text>
        </Box>
        <Box
          width="100%"
          display="flex"
          flexDirection="column"
          gap="spacing-sm"
        >
          <Button
            variant="tertiary"
            css={css`
              background-color: #202124;
              border: 1px solid #484d58;
            `}
            onClick={handleBack}
          >
            Back to Home
          </Button>
          <Button variant="primary" onClick={handleClick} loading={showLoader}>
            {!showLoader && 'Start New Game'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export { GameEndModal };
