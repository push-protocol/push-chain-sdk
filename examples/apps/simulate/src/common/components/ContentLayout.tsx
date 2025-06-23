// React and other libraries
import { FC, ReactNode } from 'react';

// External Libraries
import { Box } from 'shared-components';
import { css } from 'styled-components';

type ContentLayoutProps = {
  children: ReactNode;
};

const ContentLayout: FC<ContentLayoutProps> = ({ children }) => {
  return (
    <Box
      alignItems="center"
      backgroundColor='surface-primary'
      display="flex"
      flexDirection="column"
      justifyContent="center"
      maxWidth="1200px"
      width={{ initial: 'calc(100% - (var(--spacing-sm) * 2))', ml: 'auto' }}
      css={css`
        flex: initial;
        margin: 0;
      `}
    >
      {children}
    </Box>
  );
};

export { ContentLayout };
