import { GameMove } from '@/common';
import { FC, useEffect, useRef, useState } from 'react';
import { Box, Button, Cross, Text, Tick, css } from 'shared-components';

interface GameSidebarProps {
  handleQuitGame: () => Promise<void>;
  moves: GameMove[];
}

const GameSidebar: FC<GameSidebarProps> = ({ handleQuitGame, moves }) => {
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [moves]);

  const handleClick = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setConfirmQuit(false);
    try {
      await handleQuitGame();
      setIsLoading(false);
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <Box
      display="flex"
      flexDirection={{ initial: 'column', lp: 'column-reverse' }}
      gap="spacing-lg"
      width={{ initial: '260px', lp: '100%' }}
      maxWidth={{ initial: 'unset', lp: '390px' }}
      padding={{
        initial: 'spacing-xxl spacing-none',
        lp: 'spacing-xxl spacing-md',
      }}
      css={css`
        box-sizing: border-box;
      `}
    >
      {confirmQuit ? (
        <Box
          display="flex"
          alignItems="flex-start"
          justifyContent="space-between"
          padding="spacing-xs spacing-md"
          width="100%"
          css={css`
            box-sizing: border-box;
          `}
        >
          <Box cursor="pointer" onClick={handleClick}>
            <Tick size={20} color="icon-tertiary" />
          </Box>
          <Text variant="h6-semibold" color="text-tertiary">
            Are you sure?
          </Text>
          <Box cursor="pointer" onClick={() => setConfirmQuit(false)}>
            <Cross size={20} color="icon-tertiary" />
          </Box>
        </Box>
      ) : (
        <Button onClick={() => setConfirmQuit(true)} loading={isLoading}>
          {!isLoading && 'Quit Game'}
        </Button>
      )}

      {!!moves.length && (
        <Box
          padding="spacing-md spacing-xxs"
          backgroundColor="surface-primary-inverse"
          borderRadius="radius-sm"
        >
          <Box
            ref={scrollRef}
            display="flex"
            flexDirection="column"
            height="260px"
            padding="spacing-none spacing-sm"
            gap="spacing-xs"
            customScrollbar
            css={css`
              overflow-y: scroll;
            `}
          >
            {moves.map((move, index) => (
              <Box
                display="flex"
                width="100%"
                alignItems="center"
                justifyContent="space-between"
                key={index}
              >
                <Text variant="cs-semibold" color="text-primary-inverse">
                  {index + 1}.
                </Text>
                <Text variant="cs-semibold" color="text-primary-inverse">
                  {move.move.from}
                </Text>
                <Text variant="cs-semibold" color="text-primary-inverse">
                  {move.move.to}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export { GameSidebar };
