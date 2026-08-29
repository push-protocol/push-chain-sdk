import {
  convertOriginToExecutor,
  fromChainAgnostic,
  convertExecutorToOriginAccount,
  toChainAgnostic,
  toUniversal,
  deriveExecutorAccount,
  resolveControllerAccount,
} from './universal/account';
import {
  construct,
  toUniversal as toUniversalSigner,
  toUniversalFromKeypair,
} from './universal/signer';
import { CHAIN, PUSH_NETWORK } from './constants/enums';
import {
  MOVEABLE_TOKENS,
  PAYABLE_TOKENS,
  type MoveableToken,
} from './constants/tokens';
import { SYNTHETIC_PUSH_ERC20 } from './constants/chain';
import { UniversalAccount } from './universal/universal.types';
import type { PushChain } from './push-chain/push-chain';
import { encodeFunctionData, formatUnits, getAddress } from 'viem';
import type { PC20AddressResult } from './orchestrator/orchestrator.types';
import {
  resolvePC20Token,
  listPC20Deployments,
  discoverPC20Chain,
} from './orchestrator/internals/pc20/resolver';
import { PC20WrapperNotRegisteredError } from './orchestrator/internals/pc20/errors';
import { getPushChainForNetwork } from './orchestrator/internals/helpers';
import { Buffer } from 'buffer';
import type { Idl } from '@coral-xyz/anchor';
import {
  encodeAnchorIxData,
  isAnchorIdl,
} from './orchestrator/svm-idl/ix-encoder';
import {
  registerIdl as registerSvmIdl,
  getRegisteredIdls as getRegisteredSvmIdls,
} from './orchestrator/svm-idl/registry';

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

    convertExecutorToOriginAccount,

    deriveExecutorAccount,

    resolveControllerAccount,
  };

  /**
   * SVM (Solana) escape-hatch utilities.
   *
   * `PushChain.utils.helpers.encodeTxData({ abi: idl, ... })` auto-registers
   * the Anchor IDL internally, so normal callers never need these.
   *
   * Use `registerIdl` directly only when you build `data` manually (raw
   * Anchor discriminator + Borsh bytes) and bypass `encodeTxData`.
   */
  static svm = {
    registerIdl: registerSvmIdl,
    getRegisteredIdls: getRegisteredSvmIdls,
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

  static chains = {
    /**
     * Returns the list of supported chains for a given Push network.
     * Future-proofed to return an object with a `chains` array.
     *
     * @param {PUSH_NETWORK} network - The Push network environment.
     * @returns {{ chains: CHAIN[] }} Object containing supported chains.
     *
     * @example
     * Utils.chains.getSupportedChains(PushChain.CONSTANTS.PUSH_NETWORK.TESTNET)
     * // => { chains: [CHAIN.ETHEREUM_SEPOLIA, CHAIN.SOLANA_DEVNET] }
     *
     * @example
     * Utils.chains.getSupportedChains(PushChain.CONSTANTS.PUSH_NETWORK.MAINNET)
     * // => { chains: [] }
     */
    getSupportedChains: (
      network: PUSH_NETWORK
    ): {
      chains: CHAIN[];
    } => {
      // Current support: expose test/dev chains; mainnet returns empty until GA
      const mapping: Record<PUSH_NETWORK, CHAIN[]> = {
        [PUSH_NETWORK.MAINNET]: [],
        [PUSH_NETWORK.TESTNET]: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
        [PUSH_NETWORK.TESTNET_DONUT]: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
        [PUSH_NETWORK.LOCALNET]: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
      };

      return { chains: mapping[network] ?? [] };
    },

    /**
     * Returns the list of supported chain names for a given Push network.
     * Similar to getSupportedChains but returns chain names instead of namespaces.
     *
     * @param {PUSH_NETWORK} network - The Push network environment.
     * @returns {{ chains: string[] }} Object containing supported chain names.
     *
     * @example
     * Utils.chains.getSupportedChainsByName(PushChain.CONSTANTS.PUSH_NETWORK.TESTNET)
     * // => { chains: ['PUSH_TESTNET_DONUT', 'ETHEREUM_SEPOLIA', 'ARBITRUM_SEPOLIA', ...] }
     */
    getSupportedChainsByName: (
      network: PUSH_NETWORK
    ): {
      chains: string[];
    } => {
      const { chains } = Utils.chains.getSupportedChains(network);
      return {
        chains: chains
          .map((chain) => Utils.chains.getChainName(chain))
          .filter((name): name is string => name !== undefined),
      };
    },

    getChainName: (chainNamespace: string): string | undefined => {
      // Special case: prefer PUSH_TESTNET_DONUT over PUSH_TESTNET for 'eip155:42101'
      if (chainNamespace === 'eip155:42101') {
        return 'PUSH_TESTNET_DONUT';
      }

      const chainEntries = Object.entries(CHAIN);
      const foundEntry = chainEntries.find(
        (entry) => entry[1] === chainNamespace
      );

      if (!foundEntry) {
        return undefined;
      }

      return foundEntry[0];
    },

    /**
     * Returns the chain namespace (e.g., 'eip155:11155111') for a given chain name.
     * Reverse of getChainName. If input is already a namespace, it is returned.
     *
     * @param {string} chainName - The CHAIN key name (e.g., 'ETHEREUM_SEPOLIA' or 'PUSH_TESTNET_DONUT')
     *                             or an existing namespace (e.g., 'eip155:11155111').
     * @returns {string | undefined} The chain namespace, or undefined if unsupported.
     */
    getChainNamespace: (chainName: string): string | undefined => {
      // If already a valid namespace value, return as-is
      const namespaceValues = Object.values(CHAIN) as string[];
      if (namespaceValues.includes(chainName)) {
        return chainName;
      }

      // Map enum key -> value
      const namespace = (CHAIN as Record<string, string | number>)[chainName];
      if (typeof namespace === 'string') {
        return namespace;
      }

      return undefined;
    },
  };

  static helpers = {
    /**
     * @deprecated Use PushChain.utils.chains.getChainNamespace(chainName) instead.
     * Alias maintained for backwards compatibility. Logs a deprecation warning
     * and delegates to Utils.chains.getChainNamespace.
     */
    getChainName: (() => {
      let warned = false;
      return (chainName: string): string | undefined => {
        if (!warned) {
          console.warn(
            '[DEPRECATED] PushChain.utils.helper.getChainName is deprecated. ' +
              'Use PushChain.utils.chains.getChainNamespace(chainName) instead.'
          );
          warned = true;
        }
        return Utils.chains.getChainName(chainName);
      };
    })(),
    /**
     * Encode calldata for a universal tx.
     *
     * Pass `abi` for EVM targets, or `idl` for SVM (Anchor) targets. Exactly
     * one of the two is required.
     *
     * @example EVM
     * PushChain.utils.helpers.encodeTxData({
     *   abi: erc20Abi,
     *   functionName: 'transfer',
     *   args: [to, amount],
     * });
     *
     * @example SVM (Anchor)
     * PushChain.utils.helpers.encodeTxData({
     *   idl: counterIdl,
     *   functionName: 'increment',
     *   args: [],
     * });
     */
    encodeTxData({
      abi,
      idl,
      functionName,
      args = [],
    }: {
      abi?: any;
      idl?: Idl;
      functionName: string;
      args?: any[];
    }): `0x${string}` {
      if (abi !== undefined && idl !== undefined) {
        throw new Error(
          "encodeTxData: pass either 'abi' (EVM) or 'idl' (SVM), not both"
        );
      }
      if (abi === undefined && idl === undefined) {
        throw new Error(
          "encodeTxData: either 'abi' (EVM) or 'idl' (SVM) must be provided"
        );
      }

      if (!Array.isArray(args)) {
        throw new Error('Arguments must be an array');
      }

      // SVM path: explicit idl, or legacy abi-as-IDL for backward compat.
      const svmIdl: Idl | undefined = idl ?? (isAnchorIdl(abi) ? abi : undefined);
      if (svmIdl) {
        registerSvmIdl(svmIdl);
        const bytes = encodeAnchorIxData(svmIdl, functionName, args);
        return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
      }

      // EVM path
      if (!Array.isArray(abi)) {
        throw new Error('ABI must be an array');
      }

      const functionAbi = abi.find((f: any) => f.name === functionName);
      if (!functionAbi) {
        throw new Error(`Function '${functionName}' not found in ABI`);
      }

      try {
        const data = encodeFunctionData({ abi, functionName, args });
        return data;
      } catch (error) {
        throw new Error(
          `Failed to encode function '${functionName}': ${
            error instanceof Error ? error.message : 'Unknown error'
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
     * @param {number | {decimals: number}} exponent - The exponent (number of decimal places) or an object with decimals property.
     * @returns {bigint} The result as a bigint.
     *
     * @example
     * Utils.helpers.parseUnits('420', 9)
     * // → 420000000000n
     *
     * @example
     * Utils.helpers.parseUnits('1.5', 18)
     * // → 1500000000000000000n
     *
     * @example
     * Utils.helpers.parseUnits('1.5', {decimals: 18})
     * // → 1500000000000000000n
     */
    parseUnits(value: string, exponent: number | { decimals: number }): bigint {
      // Validate inputs
      if (typeof value !== 'string') {
        throw new Error('Value must be a string');
      }

      // Extract the actual exponent value from either number or object
      let actualExponent: number;
      if (typeof exponent === 'number') {
        actualExponent = exponent;
      } else if (
        typeof exponent === 'object' &&
        exponent !== null &&
        'decimals' in exponent
      ) {
        actualExponent = exponent.decimals;
      } else {
        throw new Error(
          'Exponent must be a number or an object with decimals property'
        );
      }

      if (typeof actualExponent !== 'number') {
        throw new Error('Exponent must be a number');
      }

      if (!Number.isInteger(actualExponent)) {
        throw new Error('Exponent must be an integer');
      }

      if (actualExponent < 0) {
        throw new Error('Exponent must be non-negative');
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
        if (fractionalPart.length > actualExponent) {
          throw new Error(
            `Value has more decimal places (${fractionalPart.length}) than exponent allows (${actualExponent})`
          );
        }

        // Pad fractional part with zeros to match exponent
        const paddedFractionalPart = fractionalPart.padEnd(actualExponent, '0');

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
          `Failed to parse value '${value}': ${
            error instanceof Error ? error.message : 'Invalid number format'
          }`
        );
      }
    },

    /**
     * Formats a value from smallest units to human-readable string.
     *
     * Supports both EVM-style (like ethers/viem) and Push-style (options object) usage patterns.
     * Always returns a string for UI safety.
     *
     * @param {bigint | string} value - The value in smallest units (e.g., "1500000" or 1500000000000000000n).
     * @param {number | {decimals: number; precision?: number}} decimalsOrOptions - Token decimals or options object.
     * @returns {string} Human-readable string (e.g., "1.5").
     *
     * @example
     * // EVM-style usage
     * Utils.helpers.formatUnits(1500000000000000000n, 18)
     * // → "1.5"
     *
     * @example
     * // Push-style usage
     * Utils.helpers.formatUnits("1500000", { decimals: 6 })
     * // → "1.5"
     *
     * @example
     * // With precision (truncate after 2 decimals)
     * Utils.helpers.formatUnits("1234567", { decimals: 6, precision: 2 })
     * // → "1.23"
     */
    formatUnits(
      value: bigint | string,
      decimalsOrOptions: number | { decimals: number; precision?: number }
    ): string {
      // Validate inputs
      if (typeof value !== 'bigint' && typeof value !== 'string') {
        throw new Error('Value must be a bigint or string');
      }

      // Extract decimals and precision from the second parameter
      let decimals: number;
      let precision: number | undefined;

      if (typeof decimalsOrOptions === 'number') {
        // EVM-style: formatUnits(value, decimals)
        decimals = decimalsOrOptions;
      } else if (
        typeof decimalsOrOptions === 'object' &&
        decimalsOrOptions !== null &&
        'decimals' in decimalsOrOptions
      ) {
        // Push-style: formatUnits(value, { decimals, precision? })
        decimals = decimalsOrOptions.decimals;
        precision = decimalsOrOptions.precision;
      } else {
        throw new Error(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );
      }

      // Validate decimals
      if (typeof decimals !== 'number') {
        throw new Error('Decimals must be a number');
      }

      if (!Number.isInteger(decimals)) {
        throw new Error('Decimals must be an integer');
      }

      if (decimals < 0) {
        throw new Error('Decimals must be non-negative');
      }

      // Validate precision if provided
      if (precision !== undefined) {
        if (typeof precision !== 'number') {
          throw new Error('Precision must be a number');
        }

        if (!Number.isInteger(precision)) {
          throw new Error('Precision must be an integer');
        }

        if (precision < 0) {
          throw new Error('Precision must be non-negative');
        }
      }

      try {
        // Convert string to bigint if needed
        const bigintValue = typeof value === 'string' ? BigInt(value) : value;

        let formatted = formatUnits(bigintValue, decimals);
        // Ensure at least one decimal place for backward compatibility
        // (only when decimals > 0, matching prior ethers behavior)
        if (decimals > 0 && !formatted.includes('.')) {
          formatted = formatted + '.0';
        }

        // Apply precision if specified without converting through JS number,
        // which would lose precision for large token values.
        if (precision !== undefined) {
          if (precision === 0) {
            return formatted.split('.')[0];
          }

          const [integerPart, fractionalPart = ''] = formatted.split('.');
          const truncatedFraction = fractionalPart.slice(0, precision);
          if (!truncatedFraction) {
            return integerPart;
          }

          return `${integerPart}.${truncatedFraction.replace(/0+$/, '')}`;
        }

        return formatted;
      } catch (error) {
        throw new Error(
          `Failed to format units: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
    },
  };

  static conversion = {
    /**
     * Calculates the minimum amount out after applying slippage.
     *
     * Given an input amount and slippage in basis points, returns the minimum amount
     * that should be received after accounting for slippage.
     *
     * @param {string} amount - The input amount in smallest units (e.g., "100000000" for 100 USDC with 6 decimals)
     * @param {object} options - Configuration options
     * @param {number} options.slippageBps - Slippage in basis points (100 = 1%, 50 = 0.5%)
     * @returns {string} The minimum amount out in smallest units
     *
     * @example
     * // Calculate minimum amount for 100 USDC with 1% slippage
     * const amount = PushChain.utils.helpers.parseUnits("100", 6); // "100000000"
     * const minOut = PushChain.utils.conversion.slippageToMinAmount(amount, {
     *   slippageBps: 100, // 1%
     * });
     * // => "99000000" (99 USDC in smallest units)
     *
     * @example
     * // Simple case with whole numbers
     * const minOut = PushChain.utils.conversion.slippageToMinAmount("100", {
     *   slippageBps: 100, // 1%
     * });
     * // => "99"
     */
    slippageToMinAmount(
      amount: string,
      options: {
        slippageBps: number; // 100 = 1%
      }
    ): string {
      // Validate inputs
      if (typeof amount !== 'string') {
        throw new Error('Amount must be a string');
      }

      if (typeof options.slippageBps !== 'number') {
        throw new Error('slippageBps must be a number');
      }

      if (!Number.isInteger(options.slippageBps)) {
        throw new Error('slippageBps must be an integer');
      }

      if (options.slippageBps < 0) {
        throw new Error('slippageBps must be non-negative');
      }

      if (options.slippageBps > 10000) {
        throw new Error('slippageBps cannot exceed 10000 (100%)');
      }

      // Handle empty string
      if (amount.trim() === '') {
        throw new Error('Amount cannot be empty');
      }

      try {
        // Convert amount to BigInt for precise calculation
        const amountBigInt = BigInt(amount);

        // Calculate slippage factor: (10000 - slippageBps) / 10000
        // For 1% slippage (100 bps): (10000 - 100) / 10000 = 0.99
        const slippageFactor = BigInt(10000 - options.slippageBps);

        // Calculate minimum amount: amount * slippageFactor / 10000
        const minAmountBigInt = (amountBigInt * slippageFactor) / BigInt(10000);

        return minAmountBigInt.toString();
      } catch (error) {
        throw new Error(
          `Failed to calculate slippage: ${
            error instanceof Error ? error.message : 'Invalid amount format'
          }`
        );
      }
    },
  };

  static tokens = {
    /**
     * Returns supported moveable tokens as a flat list with chain info.
     * - If a specific chain or a PushChain client is passed, returns only that chain's tokens
     * - Otherwise returns tokens across all chains
     */
    getMoveableTokens(chainOrClient?: CHAIN | PushChain): {
      tokens: Array<{
        chain: CHAIN;
        chainName: string;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
        sourceChain?: CHAIN;
        prc20Address?: `0x${string}`;
      }>;
    } {
      const chain: CHAIN | undefined =
        Utils.resolveChainFromInput(chainOrClient);

      const map = (k: CHAIN, t: MoveableToken) => {
        const extra = t as Partial<{
          sourceChain: CHAIN;
          prc20Address: `0x${string}`;
        }>;
        return {
          chain: k,
          chainName: Utils.chains.getChainName(k) ?? k,
          symbol: t.symbol,
          decimals: t.decimals,
          address: t.address,
          mechanism: t.mechanism,
          ...(extra.sourceChain ? { sourceChain: extra.sourceChain } : {}),
          ...(extra.prc20Address ? { prc20Address: extra.prc20Address } : {}),
        };
      };

      if (chain) {
        const list = MOVEABLE_TOKENS[chain] ?? [];
        return { tokens: list.map((t) => map(chain, t)) };
      }

      const tokens = [] as ReturnType<typeof map>[];
      for (const [key, list] of Object.entries(MOVEABLE_TOKENS)) {
        const k = key as CHAIN;
        for (const t of list ?? []) tokens.push(map(k, t));
      }
      return { tokens };
    },

    /**
     * Returns supported payable tokens as a flat list with chain info.
     * - If a specific chain or a PushChain client is passed, returns only that chain's tokens
     * - Otherwise returns tokens across all chains
     */
    getPayableTokens(chainOrClient?: CHAIN | PushChain): {
      tokens: Array<{
        chain: CHAIN;
        chainName: string;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }>;
    } {
      const chain: CHAIN | undefined =
        Utils.resolveChainFromInput(chainOrClient);

      if (chain) {
        const list = PAYABLE_TOKENS[chain] ?? [];
        return {
          tokens: list.map((t) => ({
            chain,
            chainName: Utils.chains.getChainName(chain) ?? chain,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          })),
        };
      }

      const tokens: Array<{
        chain: CHAIN;
        chainName: string;
        symbol: string;
        decimals: number;
        address: string;
        mechanism: 'approve' | 'permit2' | 'native';
      }> = [];

      for (const [key, list] of Object.entries(PAYABLE_TOKENS)) {
        const k = key as CHAIN;
        for (const t of list ?? []) {
          tokens.push({
            chain: k,
            chainName: Utils.chains.getChainName(k) ?? k,
            symbol: t.symbol,
            decimals: t.decimals,
            address: t.address,
            mechanism: t.mechanism,
          });
        }
      }

      return { tokens };
    },

    /**
     * Convert any supported origin-chain token into its mapped PRC20 token on Push Chain.
     *
     * @param token - Either a MoveableToken from `pushChainClient.moveable.token.*`
     * or an object with the origin chain and token address.
     * @returns An object describing the synthetic PRC-20 on Push Chain.
     *
     * @example
     * ```jsx
     * const { address, chain, symbol, decimals, network } =
     *   PushChain.utils.tokens.getPRC20Address({
     *     chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
     *     address: '0x...',
     *   });
     * ```
     */
    getPRC20Address(
      token: MoveableToken | { chain: string; address: string },
      options?: { network?: PUSH_NETWORK }
    ): {
      address: `0x${string}`;
      chain: CHAIN;
      symbol: string;
      decimals: number;
      network: PUSH_NETWORK;
    } {
      const network = options?.network ?? PUSH_NETWORK.TESTNET_DONUT;

      const assertDeployed = (
        addr: string | undefined,
        ctx: string
      ): `0x${string}` => {
        if (!addr || addr === '0xTBD') {
          throw new Error(
            `PRC20 address not available for ${ctx} on network ${network}`
          );
        }
        return addr as `0x${string}`;
      };

      // PushChainMoveableToken (pETH, pSOL, pUSDT(BNB), …) carries its PRC-20 address
      // and origin `sourceChain` directly — no registry lookup needed.
      const pcToken = token as Partial<{
        prc20Address: `0x${string}`;
        sourceChain: CHAIN;
        symbol: string;
        decimals: number;
      }>;
      if (pcToken.prc20Address) {
        return {
          address: assertDeployed(
            pcToken.prc20Address,
            `${pcToken.symbol ?? 'token'} (${pcToken.sourceChain ?? 'unknown'})`
          ),
          chain: pcToken.sourceChain as CHAIN,
          symbol: pcToken.symbol as string,
          decimals: pcToken.decimals as number,
          network,
        };
      }

      // Infer origin chain, symbol, decimals by matching against MOVEABLE_TOKENS
      let originChain: CHAIN | undefined;
      let tokenSymbol: string | undefined;
      let tokenDecimals: number | undefined;

      if ('symbol' in token) {
        // MoveableToken path: infer chain by symbol + address
        for (const [key, list] of Object.entries(MOVEABLE_TOKENS)) {
          const k = key as CHAIN;
          const match = (list ?? []).find(
            (t) => t.symbol === token.symbol && t.address === token.address
          );
          if (match) {
            originChain = k;
            tokenSymbol = match.symbol;
            tokenDecimals = match.decimals;
            break;
          }
        }
      } else {
        // { chain, address } path: trust the provided chain and resolve symbol via registry
        originChain = token.chain as CHAIN;
        const list = MOVEABLE_TOKENS[originChain] ?? [];
        const match = list.find((t) => t.address === token.address);
        if (match) {
          tokenSymbol = match.symbol;
          tokenDecimals = match.decimals;
        }
      }

      if (!originChain || !tokenSymbol || tokenDecimals === undefined) {
        throw new Error(
          'Unable to infer origin chain or token symbol for token'
        );
      }

      const map = SYNTHETIC_PUSH_ERC20[network];
      if (!map) {
        throw new Error(
          `No PRC20 address map configured for network: ${network}`
        );
      }

      // Map token → synthetic key by origin chain family
      const isEthFamily =
        originChain === CHAIN.ETHEREUM_MAINNET ||
        originChain === CHAIN.ETHEREUM_SEPOLIA;
      const isArbFamily = originChain === CHAIN.ARBITRUM_SEPOLIA;
      const isBaseFamily = originChain === CHAIN.BASE_SEPOLIA;
      const isBnbFamily = originChain === CHAIN.BNB_TESTNET;
      const isSolFamily = originChain === CHAIN.SOLANA_DEVNET;

      let key:
        | 'pETH'
        | 'pETH_ARB'
        | 'pETH_BASE'
        | 'pBNB'
        | 'pSOL'
        | 'USDT_ETH'
        | 'USDT_ARB'
        | 'USDT_SOL'
        | 'USDT_BSC'
        | 'USDT_BASE'
        | 'USDC_ETH'
        | 'USDC_ARB'
        | 'USDC_SOL'
        | 'USDC_BSC'
        | 'USDC_BASE';

      switch (tokenSymbol) {
        case 'ETH': {
          if (isEthFamily) key = 'pETH';
          else if (isArbFamily) key = 'pETH_ARB';
          else if (isBaseFamily) key = 'pETH_BASE';
          else
            throw new Error(
              'Unsupported ETH origin chain for synthetic mapping'
            );
          break;
        }
        case 'SOL': {
          if (!isSolFamily)
            throw new Error('SOL token provided but origin is not Solana');
          key = 'pSOL';
          break;
        }
        case 'BNB': {
          if (!isBnbFamily)
            throw new Error('BNB token provided but origin is not BNB Testnet');
          key = 'pBNB';
          break;
        }
        case 'USDT': {
          if (isEthFamily) key = 'USDT_ETH';
          else if (isArbFamily) key = 'USDT_ARB';
          else if (isBaseFamily) key = 'USDT_BASE';
          else if (isBnbFamily) key = 'USDT_BSC';
          else if (isSolFamily) key = 'USDT_SOL';
          else
            throw new Error(
              'Unsupported USDT origin chain for synthetic mapping'
            );
          break;
        }
        case 'USDC': {
          if (isEthFamily) key = 'USDC_ETH';
          else if (isArbFamily) key = 'USDC_ARB';
          else if (isBaseFamily) key = 'USDC_BASE';
          else if (isBnbFamily) key = 'USDC_BSC';
          else if (isSolFamily) key = 'USDC_SOL';
          else
            throw new Error(
              'Unsupported USDC origin chain for synthetic mapping'
            );
          break;
        }
        default:
          throw new Error(`Unsupported token symbol: ${tokenSymbol}`);
      }

      return {
        address: assertDeployed(map[key], `${tokenSymbol} on ${originChain}`),
        chain: originChain,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
        network,
      };
    },

    /**
     * Resolve a PC20 token against UniversalCore's on-chain registry, and list
     * every confirmed address it has across chains.
     *
     * Accepts either end of the mapping — an external wrapper or the canonical
     * Push-native token — and always returns the canonical token at `address`,
     * with every known deployment in `registry`.
     *
     * Unlike `getPRC20Address`, this is **asynchronous**: PC20 mappings are
     * dynamic and live on chain, so there is no static table to consult. It is
     * never symbol-based — identity is address-and-chain only.
     *
     * `chain` is optional. When omitted, the SDK works out which chain the
     * address belongs to. Note the deliberate asymmetry with the transaction
     * path: `funds.token` still *requires* `chain`, and sending with one that
     * disagrees with where the funds actually are is rejected before any
     * approval. Lookup is lenient; spending is not.
     *
     * @example
     * ```ts
     * const token = await PushChain.utils.tokens.getPC20Address('0xWrapper', {
     *   chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA, // optional
     *   network: CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
     * });
     *
     * token.address   // '0x…' canonical Push-native PC20
     * token.registry  // [{ address, chain, chainName }, …]
     * ```
     *
     * @throws {PC20WrapperNotRegisteredError} the address is unknown to the registry
     * @throws {PC20RegistryMismatchError} forward/reverse registry disagreement
     * @throws {PC20ExpectedButPRC20Error} a synthetic PRC20 was supplied
     * @throws {PC20AmbiguousAddressError} `chain` omitted and several chains
     *   claim the address with different Push sources
     */
    async getPC20Address(
      address: string,
      options: {
        network: PUSH_NETWORK;
        /** Where the address lives. Omit to have the SDK work it out. */
        chain?: CHAIN;
        rpcUrls?: Partial<Record<CHAIN, string[]>>;
        /** Also run live factory-identity checks. Slower; off by default. */
        strict?: boolean;
      }
    ): Promise<PC20AddressResult> {
      const resolverOpts = {
        network: options.network,
        rpcUrls: options.rpcUrls,
        strict: options.strict,
      };

      let chain = options.chain;
      if (!chain) {
        const discovered = await discoverPC20Chain(address, resolverOpts);
        if (!discovered) {
          throw new PC20WrapperNotRegisteredError({
            address,
            hint:
              'No PC20 registration found on any supported chain. If you know ' +
              'the chain, pass it as `chain` for a more specific error.',
          });
        }
        chain = discovered.chain;
      }

      const resolved = await resolvePC20Token(chain, address, resolverOpts);

      // Confirmed deployments across every supported external chain — one
      // multicall, since they all read UniversalCore on Push.
      const deployments = await listPC20Deployments(
        resolved.pushAddress,
        resolverOpts
      );

      const pushChain = getPushChainForNetwork(options.network);
      const entry = (addr: string, c: CHAIN) => ({
        address: addr,
        chain: c,
        chainName: Utils.chains.getChainName(c) ?? c,
      });

      return {
        address: resolved.pushAddress,
        name: resolved.name,
        symbol: resolved.symbol,
        decimals: resolved.decimals,
        network: options.network,
        registry: [
          ...deployments.map((d) => entry(d.address, d.chain)),
          // Canonical token last, matching the reviewed example.
          entry(resolved.pushAddress, pushChain),
        ],
      };
    },
  };

  /**
   * Internal: resolves a CHAIN enum from either a CHAIN value or a PushChain client instance.
   */
  private static resolveChainFromInput(
    chainOrClient?: CHAIN | PushChain
  ): CHAIN | undefined {
    if (!chainOrClient) return undefined;
    if (typeof chainOrClient === 'string') return chainOrClient as CHAIN;
    // PushChain client → get origin chain from signer account
    try {
      const originAccount = (chainOrClient as PushChain).universal?.origin as
        | UniversalAccount
        | undefined;
      if (originAccount && originAccount.chain) return originAccount.chain;
    } catch {
      // ignore
    }
    return undefined;
  }
}
