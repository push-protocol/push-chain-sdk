import { FC, ReactNode } from 'react';
import { Box } from 'shared-components';

type SymbolBoxProps = {
  children: ReactNode;
  onClick: () => void;
};

const SymbolBox: FC<SymbolBoxProps> = ({ children, onClick }) => {
  return (
    <Box
      width="40px"
      height="40px"
      display="flex"
      backgroundColor="surface-tertiary"
      borderRadius="radius-xs"
      alignItems="center"
      justifyContent="center"
      cursor="pointer"
      onClick={onClick}
    >
      {children}
    </Box>
  );
};

export { SymbolBox };
