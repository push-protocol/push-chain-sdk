export enum ENV {
    MAINNET = 'MAINNET',
    DEVNET = 'DEVNET',
    TESTNET = 'TESTNET',
    LOCAL = 'LOCAL',
}

export type ConfigType = {
    WALLET_URL: {
        [ENV.MAINNET]: string;
        [ENV.DEVNET]: string;
        [ENV.TESTNET]: string;
        [ENV.LOCAL]: string;
    };
};

export const config: ConfigType = {
    WALLET_URL: {
        [ENV.MAINNET]: 'https://wallet.push.org',
        [ENV.DEVNET]: 'https://wallet-alpha.push.org',
        [ENV.TESTNET]: 'https://wallet-alpha.push.org',
        [ENV.LOCAL]: 'http://localhost:5173',
    },
};
