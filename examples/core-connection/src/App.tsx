import React from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { useDarkMode } from './common/hooks';
import { RouterContainer } from './common/components';
import { GlobalProvider } from './context/GlobalContext';
import {
  CONSTANTS,
  PushWalletProvider,
  PushWalletIFrame,
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

const env = {
  production: CONSTANTS.ENV.PROD,
  alpha: CONSTANTS.ENV.STAGING,
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
