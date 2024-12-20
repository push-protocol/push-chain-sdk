import { usePrivy } from '@privy-io/react-auth';

import { useAppContext } from './context/app-context';
import { getBlocksCSSVariables, Spinner, themeConfig } from 'shared-components';

import { createGlobalStyle, ThemeProvider } from 'styled-components';
import AppRoutes from './routes';
import { BrowserRouter } from 'react-router-dom';
import {
  ENV,
  usePushWalletContext,
  WalletProvider,
} from '@pushprotocol/pushchain-ui-kit';

const GlobalStyle = createGlobalStyle`
  :root{
    /* Font Family */
      --font-family: 'FK Grotesk Neu', Helvetica, sans-serif;

    /* New blocks theme css variables*/
    
    ${(props) => getBlocksCSSVariables(props.theme.blocksTheme)}
  }
`;

function App() {
  const { ready, authenticated } = usePrivy();
  const { pushAccount } = useAppContext();

  return (
    <ThemeProvider theme={themeConfig.light}>
      <BrowserRouter>
        <GlobalStyle />
        <WalletProvider env={ENV.PROD}>
          {/* <AppRoutes account={account} /> */}
          {ready ? (
            <main className="h-screen w-screen">
              <AppRoutes
                authenticated={authenticated}
                pushAccount={pushAccount}
              />
            </main>
          ) : (
            <div className="flex flex-col gap-4 items-center justify-center h-screen w-full">
              <Spinner size="extraLarge" variant="primary" />
            </div>
          )}
        </WalletProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
