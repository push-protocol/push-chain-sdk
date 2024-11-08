import { ENV } from '../constants';
import { mainnet, localhost, sepolia } from 'viem/chains';
import { validatorABI } from './abis/validator';
import { Config } from './config.types';

const config: Config = {
  ABIS: {
    VALIDATOR: validatorABI,
  },
  VALIDATOR: {
    [ENV.PROD]: {
      NETWORK: mainnet,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.STAGING]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.DEV]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: '0x18Fa54e372e7F5993b2233449e8ab2086eCA3fAE',
    },
    [ENV.LOCAL]: {
      NETWORK: localhost,
      VALIDATOR_CONTRACT: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
  },
  WALLET_URL: {
    [ENV.PROD]: 'TODO',
    [ENV.STAGING]: 'TODO',
    [ENV.DEV]: 'https://push-protocol.github.io/push-wallet/',
    [ENV.LOCAL]: 'http://localhost:5174/',
  },
};

export default config;
