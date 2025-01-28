import { getBlocksCSSVariables, themeConfig } from 'shared-components';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import AppRoutes from './routes';
import { BrowserRouter } from 'react-router-dom';
import {
  ENV,
  PushWalletIFrame,
  PushWalletProvider,
} from '@pushprotocol/pushchain-ui-kit';
import { AppProvider } from './context/AppContext';

const GlobalStyle = createGlobalStyle`
  :root{
    /* Font Family */
      --font-family: 'FK Grotesk Neu';

    /* New blocks theme css variables*/
    
    ${(props) => getBlocksCSSVariables(props.theme.blocksTheme)}
  }
`;

function App() {
  return (
    <ThemeProvider theme={themeConfig.light}>
      <GlobalStyle />
      <PushWalletProvider env={ENV.PROD}>
        <AppProvider>
          <BrowserRouter>
            <PushWalletIFrame />
            <AppRoutes />
          </BrowserRouter>
        </AppProvider>
      </PushWalletProvider>
    </ThemeProvider>
  );
}

export default App;
