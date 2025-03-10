import {
  ArbitrumMonotone,
  AvalancheMonotone,
  BnbMonotone,
  EthereumMonotone,
  OptimismMonotone,
  PolygonMonotone,
  PushMonotone,
  SolanaMonotone,
} from './common';
import { ENV } from './config';
import { APP_TO_WALLET_ACTION, WALLET_TO_APP_ACTION } from './wallet';

export const CONSTANTS = {
  ENV: ENV,
  WALLET_TO_APP_ACTION: WALLET_TO_APP_ACTION,
  APP_TO_WALLET_ACTION: APP_TO_WALLET_ACTION,
};

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
