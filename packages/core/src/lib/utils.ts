import {
  convertOriginToExecutor,
  fromChainAgnostic,
  toChainAgnostic,
  toUniversal,
} from './universal/account';
import {
  construct,
  toUniversal as toUniversalSigner,
  toUniversalFromKeypair,
} from './universal/signer';
import { CHAIN } from './constants/enums';
import { ethers } from 'ethers';

/**
 * @dev - THESE UTILS ARE EXPORTED TO SDK CONSUMER
 * @dev - Make sure each exported fn has good comments to help out sdk consumer
 */

/**
 * Utility class for handling CAIP-10 chain-agnostic address formatting
 * and universal account conversions.
 */
export class Utils {
  static account = {
    /*
     * Converts a UniversalAccount into a CAIP-10 style address string.
     *
     * Format: `namespace:chainId:address`
     * Namespace is derived from the chain's VM type using VM_NAMESPACE.
     *
     * @param {UniversalAccount} account - The account to convert.
     * @returns {string} A CAIP-10 formatted string.
     *
     * @example
     * Utils.account.toChainAgnostic({
     *   chain: CHAIN.ETHEREUM_SEPOLIA,
     *   address: '0xabc'
     * })
     * // → 'eip155:11155111:0xabc'
     */
    toChainAgnostic,

    toUniversal,

    /**
     * Converts a CAIP-10 formatted string into a UniversalAccount.
     *
     * @param {string} caip - A CAIP-10 address string (e.g., 'eip155:1:0xabc...').
     * @returns {UniversalAccount} The resolved account.
     * @throws {Error} If the CAIP string is invalid or unsupported.
     *
     * @example
     * Utils.account.fromChainAgnostic('eip155:11155111:0xabc...')
     * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xabc...' }
     */
    fromChainAgnostic,

    convertOriginToExecutor,
  };

  static signer = {
    /**
     * Converts various signer types (viem, ethers v6, Solana) into a UniversalSigner.
     */
    toUniversalFromKeypair,
    /**
     * Constructs a UniversalSignerSkeleton from raw signing functions.
     */
    construct,
    /**
     * Converts a UniversalSignerSkeleton to a UniversalSigner.
     */
    toUniversal: toUniversalSigner,
  };

  static helpers = {
    getChainName: (chainNamespace: string) => {
      // Special case: prefer PUSH_TESTNET_DONUT over PUSH_TESTNET for 'eip155:42101'
      if (chainNamespace === 'eip155:42101') {
        return 'PUSH_TESTNET_DONUT';
      }

      const chainEntries = Object.entries(CHAIN);
      const foundEntry = chainEntries.find(
        ([_, value]) => value === chainNamespace
      );

      if (!foundEntry) {
        throw new Error(
          `Chain value '${chainNamespace}' not found in CHAIN enum`
        );
      }

      return foundEntry[0];
    },

    encodeTxData({
      abi,
      functionName,
      args = [],
    }: {
      abi: any[];
      functionName: string;
      args?: any[];
    }) {
      // Validate inputs
      if (!Array.isArray(abi)) {
        throw new Error('ABI must be an array');
      }

      if (!Array.isArray(args)) {
        throw new Error('Arguments must be an array');
      }

      // Find the function in the ABI
      const functionAbi = abi.find((f: any) => f.name === functionName);
      if (!functionAbi) {
        throw new Error(`Function '${functionName}' not found in ABI`);
      }

      try {
        // Create ethers Interface and encode the function data
        const abiInterface = new ethers.Interface(abi);
        const data = abiInterface.encodeFunctionData(functionName, args);
        return data;
      } catch (error) {
        throw new Error(
          `Failed to encode function '${functionName}': ${error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    },

    /**
     * Multiplies a string representation of a number by a given exponent of base 10 (10^exponent).
     *
     * This is commonly used for converting human-readable token amounts to their on-chain representation.
     * For example, converting "1.5" ETH to wei (18 decimals) would be parseUnits("1.5", 18).
     *
     * @param {string} value - The string representation of the number to multiply.
     * @param {number} exponent - The exponent (number of decimal places).
     * @returns {bigint} The result as a bigint.
     *
     * @example
     * Utils.helpers.parseUnits('420', 9)
     * // → 420000000000n
     *
     * @example
     * Utils.helpers.parseUnits('1.5', 18)
     * // → 1500000000000000000n
     */
    parseUnits(value: string, exponent: number): bigint {
      // Validate inputs
      if (typeof value !== 'string') {
        throw new Error('Value must be a string');
      }

      if (
        typeof exponent !== 'number' ||
        !Number.isInteger(exponent) ||
        exponent < 0
      ) {
        throw new Error('Exponent must be a non-negative integer');
      }

      // Handle empty string
      if (value.trim() === '') {
        throw new Error('Value cannot be empty');
      }

      // Remove any whitespace
      const trimmedValue = value.trim();

      // Check for valid number format
      if (!/^-?\d*\.?\d*$/.test(trimmedValue)) {
        throw new Error('Value must be a valid number string');
      }

      // Handle case where value is just a decimal point
      if (
        trimmedValue === '.' ||
        trimmedValue === '-.' ||
        trimmedValue === ''
      ) {
        throw new Error('Value must be a valid number string');
      }

      try {
        // Split on decimal point to handle fractional values
        const parts = trimmedValue.split('.');
        const integerPart = parts[0] || '0';
        const fractionalPart = parts[1] || '';

        // Check if fractional part has more digits than the exponent allows
        if (fractionalPart.length > exponent) {
          throw new Error(
            `Value has more decimal places (${fractionalPart.length}) than exponent allows (${exponent})`
          );
        }

        // Pad fractional part with zeros to match exponent
        const paddedFractionalPart = fractionalPart.padEnd(exponent, '0');

        // Combine integer and fractional parts
        const combinedValue = integerPart + paddedFractionalPart;

        // Convert to bigint
        return BigInt(combinedValue);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('decimal places')
        ) {
          throw error;
        }
        throw new Error(
          `Failed to parse value '${value}': ${error instanceof Error ? error.message : 'Invalid number format'
          }`
        );
      }
    },
  };
}
