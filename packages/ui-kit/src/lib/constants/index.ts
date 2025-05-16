
import {
    ArbitrumMonotone,
    AvalancheMonotone,
    BnbMonotone,
    EthereumMonotone,
    OptimismMonotone,
    PolygonMonotone,
    PushMonotone,
    SolanaMonotone,
} from '../components/common';
import { ENV } from "./environment";

export const CONSTANTS = {
    ENV: ENV,
    CHAIN: { ETHEREUM: 'ethereum', SOLANA: 'solana' },
    THEME: { LIGHT: 'light', DARK: 'dark' },
    LOGIN: { SPLIT: 'split', SIMPLE: 'simple' }
}

// events send by wallet to the dapp
export enum WALLET_TO_APP_ACTION {
    CONNECT_EXTERNAL_WALLET = 'connectWallet',

    APP_CONNECTION_SUCCESS = 'appConnectionSuccess',
    APP_CONNECTION_REJECTED = 'appConnectionRejected',

    IS_LOGGED_IN = 'isLoggedIn',
    IS_LOGGED_OUT = 'loggedOut',

    SIGNATURE = 'signature',
    ERROR = 'error',
}

// events send by dapp to the wallet
export enum APP_TO_WALLET_ACTION {
    NEW_CONNECTION_REQUEST = 'newConnectionRequest',
    SIGN_MESSAGE = 'signMessage',
    LOG_OUT = 'logOut',

    CONNECTION_STATUS = 'connectionStatus',
    WALLET_CONFIG = "walletConfig"
}

export const CHAIN_LOGO: Record<string, React.FC | React.ComponentType> = {
    1: EthereumMonotone,
    11155111: EthereumMonotone,
    137: PolygonMonotone,
    80002: PolygonMonotone,
    97: BnbMonotone,
    56: BnbMonotone,
    42161: ArbitrumMonotone,
    421614: ArbitrumMonotone,
    11155420: OptimismMonotone,
    10: OptimismMonotone,
    2442: PolygonMonotone,
    1101: PolygonMonotone,
    43114: AvalancheMonotone,
    43113: AvalancheMonotone,
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SolanaMonotone, // mainnet
    '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z': SolanaMonotone, // testnet
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1': SolanaMonotone, // devnet
    devnet: PushMonotone,
};

export * from "./environment";
