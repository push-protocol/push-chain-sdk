import { bytesToHex, getAddress, Abi } from 'viem';
import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN, VM, PUSH_NETWORK } from '../../constants/enums';
import { UniversalAccount } from '../universal.types';
import { utils } from '@coral-xyz/anchor';
import { FACTORY_V1 } from '../../constants/abi';
import { PushClient } from '../../push-client/push-client';
import { AccountCache } from '../../orchestrator/cache';

/**
 * Formats a blockchain address based on the virtual machine type of the provided chain.
 *
 * - For EVM chains, it converts the address to its checksummed format.
 * - For non-EVM chains (e.g., Solana), the original address is returned as-is. - Can be changed in future
 * @param {CHAIN} chain - A fully qualified chain identifier (e.g., CHAIN.ETHEREUM_MAINNET).
 * @param {string} address - The raw address string to normalize.
 * @returns {string} - A VM-compliant formatted address.
 *
 * @throws {Error} If an invalid EVM address is provided.
 *
 * @example
 * // EVM address gets checksummed
 * formatAddress(CHAIN.ETHEREUM_SEPOLIA, "0xabcd...") // → "0xAbCd..."
 *
 * @example
 * // Non-EVM address is returned as-is
 * formatAddress(CHAIN.SOLANA_DEVNET, "solanaAddress123") // → "solanaAddress123"
 */
function formatAddress(chain: CHAIN, address: string): string {
  if (CHAIN_INFO[chain].vm === VM.EVM) {
    try {
      return getAddress(address.toLowerCase());
    } catch {
      throw new Error('Invalid EVM address format');
    }
  }
  return address;
}

/**
 * Creates a `UniversalAccount` object from an address and chain options.
 * Alternative to createUniversalAccount with a different parameter structure.
 *
 * @param {string} address - The account address.
 * @param {Object} options - The configuration options.
 * @param {CHAIN} options.chain - The chain the account is associated with.
 * @returns {UniversalAccount} A normalized account object with chain and address.
 *
 * @example
 * const universalAccount = toUniversal(
 *   '0x35B84d6848D16415177c64D64504663b998A6ab4',
 *   { chain: CHAIN.ETHEREUM_SEPOLIA }
 * );
 * // → { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0x35B84d6848D16415177c64D64504663b998A6ab4' }
 */
export function toUniversal(
  address: string,
  options: { chain: CHAIN }
): UniversalAccount {
  return {
    chain: options.chain,
    address: formatAddress(options.chain, address),
  };
}

/**
 * Converts an address and chain into a CAIP-10 style address string.
 *
 * Format: `namespace:chainId:address`
 * Namespace is derived from the chain's VM type using VM_NAMESPACE.
 *
 * @param {string} address - The account address to convert.
 * @param {Object} options - The configuration options.
 * @param {CHAIN} options.chain - The chain the account is associated with.
 * @returns {string} A CAIP-10 formatted string.
 *
 * @example
 * Utils.account.toChainAgnostic('0xabc123...', {
 *   chain: CHAIN.ETHEREUM_SEPOLIA
 * })
 * // → 'eip155:11155111:0xabc123...'
 */
export function toChainAgnostic(
  address: string,
  options: { chain: CHAIN }
): string {
  const { chain } = options;

  const chainMeta = CHAIN_INFO[chain];
  if (!chainMeta) {
    throw new Error(`Unrecognized chain: ${chain}`);
  }

  const { chainId, vm } = chainMeta;
  const namespace = VM_NAMESPACE[vm];

  return `${namespace}:${chainId}:${formatAddress(chain, address)}`;
}

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
export function fromChainAgnostic(caip: string): UniversalAccount {
  const [namespace, chainId, rawAddress] = caip.split(':');

  const chain = (Object.entries(CHAIN_INFO).find(
    ([, info]) =>
      info.chainId === chainId && VM_NAMESPACE[info.vm] === namespace
  )?.[0] ?? null) as CHAIN | null;

  if (!chain) {
    throw new Error(`Unsupported or unknown CAIP address: ${caip}`);
  }

  return {
    chain,
    address: formatAddress(chain, rawAddress),
  };
}

// Global cache instance for convertOriginToExecutor
const accountCache = new AccountCache();

/**
 * Determines the Push Network based on the chain type (testnet vs mainnet)
 */
function getPushNetworkFromChain(chain: CHAIN): PUSH_NETWORK {
  const testnetChains = [
    CHAIN.ETHEREUM_SEPOLIA,
    CHAIN.SOLANA_TESTNET,
    CHAIN.SOLANA_DEVNET,
    CHAIN.PUSH_TESTNET_DONUT,
    CHAIN.PUSH_TESTNET,
    CHAIN.PUSH_LOCALNET,
  ];

  const mainnetChains = [
    CHAIN.ETHEREUM_MAINNET,
    CHAIN.SOLANA_MAINNET,
    CHAIN.PUSH_MAINNET,
  ];

  const localnetChains = [CHAIN.PUSH_LOCALNET];

  if (testnetChains.includes(chain)) {
    return PUSH_NETWORK.TESTNET_DONUT;
  } else if (mainnetChains.includes(chain)) {
    return PUSH_NETWORK.MAINNET;
  } else if (localnetChains.includes(chain)) {
    return PUSH_NETWORK.LOCALNET;
  } else {
    throw new Error(`Unsupported chain for Push Network mapping: ${chain}`);
  }
}

export async function convertOriginToExecutor(
  account: UniversalAccount,
  options: {
    onlyCompute?: boolean;
  } = { onlyCompute: true }
): Promise<{
  address: `0x${string}`;
  deployed?: boolean;
}> {
  const { chain, address } = account;
  const { vm, chainId } = CHAIN_INFO[chain];

  if (isPushChain(chain)) {
    if (options.onlyCompute) {
      return { address: account.address as `0x${string}`, deployed: false };
    }
    return { address: account.address as `0x${string}` };
  }

  // Determine Push Network from the chain
  const pushNetwork = getPushNetworkFromChain(chain);

  // Check cache for computed address
  const cachedAddress = accountCache.getComputedAddress(
    chain,
    address,
    pushNetwork,
    vm
  );

  if (cachedAddress) {
    if (options.onlyCompute) {
      // Check cache for deployment status
      const cachedDeploymentStatus =
        accountCache.getDeploymentStatus(cachedAddress);
      if (cachedDeploymentStatus !== null) {
        return {
          address: cachedAddress as `0x${string}`,
          deployed: cachedDeploymentStatus,
        };
      }
    } else {
      return { address: cachedAddress as `0x${string}` };
    }
  }

  let pushChain: CHAIN;
  if (pushNetwork === PUSH_NETWORK.MAINNET) {
    pushChain = CHAIN.PUSH_MAINNET;
  } else if (
    pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
    pushNetwork === PUSH_NETWORK.TESTNET
  ) {
    pushChain = CHAIN.PUSH_TESTNET_DONUT;
  } else {
    pushChain = CHAIN.PUSH_LOCALNET;
  }

  // Create PushClient to get factory address
  const pushClient = new PushClient({
    rpcUrls: CHAIN_INFO[pushChain].defaultRPC,
    network: pushNetwork,
  });

  const computedAddress: `0x${string}` = await pushClient.readContract({
    address: pushClient.pushChainInfo.factoryAddress,
    abi: FACTORY_V1 as Abi,
    functionName: 'computeUEA',
    args: [
      {
        chainNamespace: VM_NAMESPACE[vm],
        chainId: chainId,
        /**
         * @dev - OwnerKey should be in bytes
         * for eth - convert hex to bytes
         * for sol - convert base64 to bytes
         * for others - not defined yet
         */
        owner:
          vm === VM.EVM
            ? address
            : vm === VM.SVM
            ? bytesToHex(utils.bytes.bs58.decode(address))
            : address,
      },
    ],
  });

  // Cache the computed address
  accountCache.setComputedAddress(
    chain,
    address,
    pushNetwork,
    vm,
    computedAddress
  );

  const byteCode = await pushClient.publicClient.getCode({
    address: computedAddress,
  });

  const isDeployed = byteCode !== undefined;

  // Cache the deployment status
  accountCache.setDeploymentStatus(computedAddress, isDeployed);

  if (options.onlyCompute) {
    return { address: computedAddress, deployed: isDeployed };
  }
  return { address: computedAddress };
}

function isPushChain(chain: CHAIN): boolean {
  return (
    chain === CHAIN.PUSH_MAINNET ||
    chain === CHAIN.PUSH_TESTNET_DONUT ||
    chain === CHAIN.PUSH_LOCALNET
  );
}
