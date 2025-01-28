/**
 * SUPPORTED ENVIRONEMENTS
 */
export enum ENV {
  PROD = 'prod',
  STAGING = 'staging',
  DEV = 'dev',
  LOCAL = 'local',
}

export type ConfigType = {
  WALLET_URL: {
    [ENV.PROD]: string;
    [ENV.STAGING]: string;
    [ENV.DEV]: string;
    [ENV.LOCAL]: string;
  };
};

const config: ConfigType = {
  WALLET_URL: {
    [ENV.PROD]: 'https://wallet.push.org',
    [ENV.STAGING]: 'https://push-protocol.github.io/push-wallet',
    [ENV.DEV]: 'https://push-protocol.github.io/push-wallet',
    [ENV.LOCAL]: 'http://localhost:5173',
  },
};

export default config;
