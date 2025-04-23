import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { useDarkMode } from './common/hooks';
import { RouterContainer } from './common/components';
import {
  CONSTANTS,
  PushWalletProvider,
} from '../../../../packages/ui-kit';
import Navbar from './components/Navbar';

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

const env = {
  production: CONSTANTS.ENV.MAINNET,
  alpha: CONSTANTS.ENV.DEVNET,
} as const;

type EnvKeys = keyof typeof env;

const deploymentEnv: EnvKeys =
  import.meta.env.VITE_DEPLOYMENT_MODE || 'production';

const App: React.FC = () => {
  const { isDarkMode } = useDarkMode();

  return (
    <ThemeProvider theme={isDarkMode ? themeConfig.dark : themeConfig.light}>
      <GlobalStyle />
      <PushWalletProvider env={CONSTANTS.ENV.LOCAL}>
        <Router>
          <Navbar />
          <RouterContainer />
        </Router>
      </PushWalletProvider>
    </ThemeProvider>
  );
};

export default App;
