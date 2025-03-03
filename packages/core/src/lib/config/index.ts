import { mainnet, localhost, sepolia } from 'viem/chains';
import { ENV } from '../constants';
import { validatorABI } from './abis/validator';
import { Config } from './config.types';

// ENV CONFIGS
const config: Config = {
  ABIS: {
    VALIDATOR: validatorABI,
  },
  VALIDATOR: {
    [ENV.MAINNET]: {
      NETWORK: mainnet,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.TESTNET]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: 'TODO',
    },
    [ENV.DEVNET]: {
      NETWORK: sepolia,
      VALIDATOR_CONTRACT: '0x98dBfb001cB2623cF7BfE2A17755592E151f0779',
    },
    [ENV.LOCAL]: {
      NETWORK: localhost,
      VALIDATOR_CONTRACT: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
  },
};

export default config;
