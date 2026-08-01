/**
 * Route Detection and Validation for Multi-Chain Transactions
 *
 * Detects which route a transaction should take based on `from` and `to` parameters:
 * - Route 1 (UOA_TO_PUSH): UOA → Push Chain
 * - Route 2 (UOA_TO_CEA): UOA → CEA on external chain
 * - Route 3 (CEA_TO_PUSH): CEA → Push Chain
 * - Route 4 (CEA_TO_CEA): CEA → CEA (external to external via Push)
 */

import { CHAIN } from '../constants/enums';
import { MOVEABLE_TOKENS, type MoveableToken } from '../constants/tokens';
import type {
  UniversalExecuteParams,
  ChainTarget,
  TransactionRouteType,
} from './orchestrator.types';
import { isPC20Reference } from './orchestrator.types';
import { isSvmChain } from './payload-builders';
import { hasExecutablePayloadData } from './data-utils';
import { toSvmHexAddress } from './svm-idl/normalize-address';

// ============================================================================
// Transaction Route Enum
// ============================================================================

/**
 * Enum for transaction routes
 */
export enum TransactionRoute {
  /** Route 1: UOA → Push Chain (existing flow) */
  UOA_TO_PUSH = 'UOA_TO_PUSH',
  /** Route 2: UOA → CEA on external chain */
  UOA_TO_CEA = 'UOA_TO_CEA',
  /** Route 3: CEA → Push Chain */
  CEA_TO_PUSH = 'CEA_TO_PUSH',
  /** Route 4: CEA → CEA (external to external via Push) */
  CEA_TO_CEA = 'CEA_TO_CEA',
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when route parameters are invalid
 */
export class RouteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteValidationError';
  }
}

/**
 * Error thrown when a chain is not supported for CEA operations
 */
export class ChainNotSupportedError extends Error {
  constructor(public chain: CHAIN | string) {
    super(`Chain ${chain} is not supported for CEA operations`);
    this.name = 'ChainNotSupportedError';
  }
}

/**
 * Error thrown when transaction type is invalid
 */
export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransactionError';
  }
}

// ============================================================================
// Chain Helpers
// ============================================================================

/**
 * Push Chain identifiers (all environments)
 */
const PUSH_CHAINS: CHAIN[] = [
  CHAIN.PUSH_MAINNET,
  CHAIN.PUSH_TESTNET,
  CHAIN.PUSH_TESTNET_DONUT,
  CHAIN.PUSH_LOCALNET,
];

/**
 * External chains supported for outbound operations (Route 2).
 * - EVM chains: use CEA (Chain Executor Account)
 * - SVM chains: use gateway program directly (no CEA)
 */
const SUPPORTED_CEA_CHAINS: CHAIN[] = [
  // EVM chains (CEA-based)
  CHAIN.ETHEREUM_MAINNET,
  CHAIN.ETHEREUM_SEPOLIA,
  CHAIN.ARBITRUM_SEPOLIA,
  CHAIN.BASE_SEPOLIA,
  CHAIN.BNB_TESTNET,
  // SVM chains (gateway-based, no CEA)
  CHAIN.SOLANA_MAINNET,
  CHAIN.SOLANA_TESTNET,
  CHAIN.SOLANA_DEVNET,
];

/**
 * Check if a chain is a Push Chain
 */
export function isPushChain(chain: CHAIN): boolean {
  return PUSH_CHAINS.includes(chain);
}

/**
 * Check if a chain is supported for CEA operations
 */
export function isSupportedExternalChain(chain: CHAIN): boolean {
  return SUPPORTED_CEA_CHAINS.includes(chain);
}

/**
 * Reverse-map a CHAIN enum value to its friendly name (e.g. CHAIN.ETHEREUM_SEPOLIA → 'ETHEREUM_SEPOLIA').
 */
export function chainEnumToName(chain: CHAIN): string {
  const entry = Object.entries(CHAIN).find(([, v]) => v === chain);
  return entry ? entry[0] : chain;
}

/**
 * Find which chain(s) a moveable token is registered for, by matching address.
 * Returns the first matching chain, or undefined if not found.
 */
export function findTokenChain(token: MoveableToken): CHAIN | undefined {
  for (const [chain, tokens] of Object.entries(MOVEABLE_TOKENS)) {
    if (tokens?.some(t => t.address.toLowerCase() === token.address.toLowerCase() && t.symbol === token.symbol)) {
      return chain as CHAIN;
    }
  }
  return undefined;
}

/**
 * Check if 'to' parameter is a ChainTarget object
 */
export function isChainTarget(to: unknown): to is ChainTarget {
  return (
    typeof to === 'object' &&
    to !== null &&
    'address' in to &&
    'chain' in to &&
    typeof (to as ChainTarget).address === 'string' &&
    typeof (to as ChainTarget).chain === 'string'
  );
}

// ============================================================================
// Route Detection
// ============================================================================

/**
 * Detect the transaction route based on params
 *
 * Route detection logic:
 * | from.chain | to format     | to.chain    | Route         |
 * |------------|---------------|-------------|---------------|
 * | undefined  | string        | N/A         | UOA_TO_PUSH   |
 * | undefined  | ChainTarget   | external    | UOA_TO_CEA    |
 * | undefined  | ChainTarget   | push        | UOA_TO_PUSH   |
 * | defined    | string        | N/A         | CEA_TO_PUSH   |
 * | defined    | ChainTarget   | push        | CEA_TO_PUSH   |
 * | defined    | ChainTarget   | external    | CEA_TO_CEA    |
 *
 * @param params - Universal execute parameters
 * @returns The detected transaction route
 * @throws RouteValidationError if parameters are invalid
 */
export function detectRoute(
  params: UniversalExecuteParams
): TransactionRoute {
  const hasFromChain = params.from?.chain !== undefined;
  const toIsChainTarget = isChainTarget(params.to);

  // Case 1: No from.chain, to is simple string → Route 1 (UOA → Push)
  if (!hasFromChain && !toIsChainTarget) {
    return TransactionRoute.UOA_TO_PUSH;
  }

  // Case 2: No from.chain, to is ChainTarget
  if (!hasFromChain && toIsChainTarget) {
    const toChain = (params.to as ChainTarget).chain;

    // If targeting Push Chain, it's still Route 1
    if (isPushChain(toChain)) {
      return TransactionRoute.UOA_TO_PUSH;
    }

    // Targeting external chain → Route 2 (UOA → CEA)
    return TransactionRoute.UOA_TO_CEA;
  }

  // Case 3: from.chain present, to is simple string → Route 3 (CEA → Push)
  // When from.chain is specified and to is a string, we assume it's a Push Chain address
  // This is Route 3: CEA sends funds back to Push Chain
  if (hasFromChain && !toIsChainTarget) {
    return TransactionRoute.CEA_TO_PUSH;
  }

  // Case 4: from.chain present, to is ChainTarget
  if (hasFromChain && toIsChainTarget) {
    const toChain = (params.to as ChainTarget).chain;

    // Targeting Push Chain → Route 3 (CEA → Push)
    if (isPushChain(toChain)) {
      return TransactionRoute.CEA_TO_PUSH;
    }

    // Targeting external chain → Route 4 (CEA → CEA)
    return TransactionRoute.CEA_TO_CEA;
  }

  // Should never reach here
  throw new RouteValidationError('Unable to determine transaction route');
}

// ============================================================================
// Route Validation
// ============================================================================

/**
 * Validate route parameters are valid for the detected route
 *
 * @param params - Universal execute parameters
 * @throws RouteValidationError if validation fails
 * @throws ChainNotSupportedError if chain is not supported
 */
export function validateRouteParams(
  params: UniversalExecuteParams,
  context?: { clientChain?: CHAIN }
): void {
  const route = detectRoute(params);

  // Validate from.chain is supported external chain (Routes 3, 4)
  if (params.from?.chain) {
    if (!isSupportedExternalChain(params.from.chain)) {
      throw new ChainNotSupportedError(params.from.chain);
    }
  }

  // Validate to.chain is supported (Routes 2, 3, 4)
  if (isChainTarget(params.to)) {
    const toChain = params.to.chain;

    // For Route 2 (UOA → CEA), target must be external chain
    if (route === TransactionRoute.UOA_TO_CEA) {
      if (!isSupportedExternalChain(toChain)) {
        throw new ChainNotSupportedError(toChain);
      }
    }

    // For Route 4 (CEA → CEA), target must be external chain
    if (route === TransactionRoute.CEA_TO_CEA) {
      if (!isSupportedExternalChain(toChain)) {
        throw new ChainNotSupportedError(toChain);
      }
    }
  }

  // Validate migration params
  if (params.migration) {
    if (route !== TransactionRoute.UOA_TO_CEA) {
      throw new RouteValidationError(
        'migration flag is only valid for Route 2 (UOA_TO_CEA)'
      );
    }
    if (params.value && params.value > BigInt(0)) {
      throw new RouteValidationError(
        'migration is incompatible with value'
      );
    }
    if (params.funds) {
      throw new RouteValidationError(
        'migration is incompatible with funds'
      );
    }
    if (hasExecutablePayloadData(params.data)) {
      throw new RouteValidationError(
        'migration is incompatible with data'
      );
    }
    if (isChainTarget(params.to) && isSvmChain(params.to.chain)) {
      throw new RouteValidationError(
        'migration is not supported on SVM chains'
      );
    }
  }

  // Validate funds.token against the route-relevant chain.
  // - Route 1 (UOA_TO_PUSH): no bridging, nothing to validate here.
  // - Route 2 (UOA_TO_CEA): validate against to.chain.
  // - Route 3/4 (CEA_TO_PUSH, CEA_TO_CEA): validate against from.chain.
  // For a Push-registered PRC-20 the token's own `sourceChain` must match; for a
  // non-Push token, the token's symbol must be registered on the chain.
  // PC20 funds skip the moveable-token validation (and only that — the address
  // checks below still run). The static table is symbol-keyed and PC20 identity
  // is never symbol-based; the PC20 gate validates chain ownership against the
  // live registry, which is strictly stronger than anything this block can
  // check. Two shapes qualify: an unresolved `PC20TokenReference`
  // (validateRouteParams can run before the gate, e.g. in prepareTransaction)
  // and the gate's resolved output (`_pc20` descriptor present).
  const isPc20Funds =
    (params as { _pc20?: unknown })._pc20 !== undefined ||
    isPC20Reference(params.funds?.token as never);

  if (params.funds?.token && !isPc20Funds) {
    const token = params.funds.token as MoveableToken;
    const clientLabel = context?.clientChain
      ? chainEnumToName(context.clientChain)
      : 'unknown';
    const registeredOn = findTokenChain(token);
    const tokenLabel = registeredOn
      ? `${chainEnumToName(registeredOn)}.${token.symbol}`
      : token.symbol;
    const isPushToken = registeredOn !== undefined && isPushChain(registeredOn);

    // For Push-registered tokens the caller may pass a stripped clone (e.g. via
    // utils.tokens.getMoveableTokens), so look up the authoritative sourceChain
    // from the registry rather than trusting only the caller-supplied field.
    const registrySourceChain = registeredOn
      ? (MOVEABLE_TOKENS[registeredOn] || []).find(
          t =>
            t.address.toLowerCase() === token.address.toLowerCase() &&
            t.symbol === token.symbol
        ) as { sourceChain?: CHAIN } | undefined
      : undefined;
    const effectiveSourceChain =
      (token as { sourceChain?: CHAIN }).sourceChain ??
      registrySourceChain?.sourceChain;

    const validateAgainst = (
      chain: CHAIN,
      direction: 'destination' | 'source'
    ): void => {
      if (isPushChain(chain)) return;
      const ok = isPushToken
        ? effectiveSourceChain === chain
        : (MOVEABLE_TOKENS[chain] || []).some(t => t.symbol === token.symbol);
      if (!ok) {
        // A PC20 reference is { chain, address } ONLY. If a caller added a
        // symbol to one, it classified as a MoveableToken and landed here —
        // say so instead of leaving them to puzzle over the static table.
        const pc20Hint =
          'chain' in (token as unknown as Record<string, unknown>)
            ? '\nIf this is a PC20 token, pass { chain, address } only — no symbol or mechanism.'
            : '';
        throw new RouteValidationError(
          `Unsupported moveable token for current client and route:\n` +
            `token=${tokenLabel}\n` +
            `clientChain=${clientLabel}\n` +
            `${direction}=${chainEnumToName(chain)}` +
            pc20Hint
        );
      }
    };

    switch (route) {
      case TransactionRoute.UOA_TO_PUSH:
        break;
      case TransactionRoute.UOA_TO_CEA:
        validateAgainst((params.to as ChainTarget).chain, 'destination');
        break;
      case TransactionRoute.CEA_TO_PUSH:
      case TransactionRoute.CEA_TO_CEA:
        validateAgainst(params.from!.chain!, 'source');
        break;
    }
  }

  // Validate address format
  if (isChainTarget(params.to)) {
    if (isSvmChain(params.to.chain)) {
      // SVM targets accept either base58 (native Solana form) or 0x-prefixed
      // 32-byte hex. Normalize to hex up front so downstream handlers only see
      // the canonical form.
      try {
        params.to.address = toSvmHexAddress(params.to.address);
      } catch (err) {
        throw new RouteValidationError(
          `Invalid Solana address format: ${params.to.address}. ` +
            `Expected base58 (32-byte pubkey) or 0x-prefixed 32-byte hex. ` +
            `(${(err as Error).message})`
        );
      }
    } else if (!params.to.address.startsWith('0x')) {
      throw new RouteValidationError(
        `Invalid address format: ${params.to.address}`
      );
    }
  } else if (typeof params.to === 'string') {
    if (!params.to.startsWith('0x')) {
      throw new RouteValidationError(`Invalid address format: ${params.to}`);
    }
  }
}

/**
 * Get route information for display/logging
 */
export function getRouteInfo(route: TransactionRoute): {
  name: string;
  description: string;
  isOutbound: boolean;
  requiresCEA: boolean;
} {
  switch (route) {
    case TransactionRoute.UOA_TO_PUSH:
      return {
        name: 'UOA → Push',
        description: 'Execute on Push Chain via UEA',
        isOutbound: false,
        requiresCEA: false,
      };
    case TransactionRoute.UOA_TO_CEA:
      return {
        name: 'UOA → CEA',
        description: 'Execute on external chain via CEA',
        isOutbound: true,
        requiresCEA: true,
      };
    case TransactionRoute.CEA_TO_PUSH:
      return {
        name: 'CEA → Push',
        description: 'Bridge from external chain to Push Chain',
        isOutbound: true,
        requiresCEA: true,
      };
    case TransactionRoute.CEA_TO_CEA:
      return {
        name: 'CEA → CEA',
        description: 'Cross-chain via Push (external → Push → external)',
        isOutbound: true,
        requiresCEA: true,
      };
  }
}
