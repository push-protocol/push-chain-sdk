import { UniversalSigner } from '../universal/universal.types';
import { Abi, Chain, Transaction, TransactionReceipt } from 'viem';
import { Keypair, PublicKey } from '@solana/web3.js';

/**
 * Common options used by all VM clients (EVM, SVM, etc.)
 */
export interface ClientOptions {
  rpcUrls: string[];
  // When set, viem formats error messages (e.g. InsufficientFundsError)
  // using this chain's `nativeCurrency.symbol`. Leave unset for external
  // chains where viem's default ETH formatting is already correct.
  chain?: Chain;
}

/**
 * Parameters for reading from a smart contract (read-only call).
 */
export interface ReadContractParams {
  /**
   * EVM contract address
   * SVM program id
   */
  address: string;
  /**
   * EVM abi
   * SVM idl
   */
  abi: Abi | any;
  /**
   * EVM contract fn name
   * SVM PDA var name
   */
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * EVM fn vars
   * SVM - undefined
   */
  args?: any[];
}

/**
 * Parameters for writing to a smart contract (requires signature).
 */
export interface WriteContractParams extends ReadContractParams {
  value?: bigint; // value in ether
  signer: UniversalSigner;
  /**
   * **For Solana only** Dynamic accounts to pass to the solana program
   * instruction. `null` is valid for accounts the IDL marks `optional` —
   * Anchor substitutes the program id as the on-wire "none" placeholder.
   */
  accounts?: Record<string, PublicKey | null>;
  /**
   * **For Solana only** Keypairs that should sign the transaction
   */
  extraSigners?: Keypair[];
  /**
   * **For Solana only** Positional accounts appended after the instruction's
   * named accounts. Order and flags are program-defined — e.g. the PC20 burn
   * requires exactly `[pc20_state readonly, pc20_mint writable]`.
   */
  remainingAccounts?: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export type TxResponse = Transaction & {
  wait: (confirmations?: number) => Promise<TransactionReceipt>;
};
