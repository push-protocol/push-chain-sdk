import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { useDarkMode } from './common/hooks';
import { RouterContainer } from './common/components';
import { GlobalProvider } from './context/GlobalContext';
import {
  PushWalletProvider,
  PushWalletIFrame,
  CONSTANTS,
} from '../../../packages/ui-kit';

const GlobalStyle = createGlobalStyle`
  :root{
    /* Font Family */
      --font-family: 'FK Grotesk Neu';

    /* New blocks theme css variables*/
  
    ${(props) => {
      // @ts-expect-error
      return getBlocksCSSVariables(props.theme.blocksTheme);
    }}
  }
`;

const App: React.FC = () => {
  const { isDarkMode } = useDarkMode();

  return (
    <ThemeProvider theme={isDarkMode ? themeConfig.dark : themeConfig.light}>
      <GlobalStyle />
      <PushWalletProvider env={CONSTANTS.ENV.LOCAL}>
        <GlobalProvider>
          <Router>
            <PushWalletIFrame />
            <RouterContainer />
          </Router>
        </GlobalProvider>
      </PushWalletProvider>
    </ThemeProvider>
  );
};

export default App;
