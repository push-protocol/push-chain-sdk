/**
 * PC20 ABIs — minimal read surfaces for registry resolution and validation.
 *
 * Sources:
 *   IPC20            push-chain-gateway-contracts/contracts/evm-gateway/src/interfaces/IPC20.sol
 *   PC20Factory      push-chain-gateway-contracts/contracts/evm-gateway/src/PC20Factory.sol
 *   PC20Wrapper      push-chain-gateway-contracts/contracts/evm-gateway/src/PC20Wrapper.sol
 *   UniversalGateway push-chain-gateway-contracts/contracts/evm-gateway/src/UniversalGateway.sol
 *
 * Read-only entries only. Writes go through the existing gateway ABIs — PC20
 * changes the payload, not the entrypoint.
 */

/** Push-native token eligible for export. Presence of `pc20Metadata` IS the PC20 test. */
export const IPC20_EVM = [
  {
    type: 'function',
    name: 'pc20Metadata',
    inputs: [],
    outputs: [
      { name: 'name', type: 'string', internalType: 'string' },
      { name: 'symbol', type: 'string', internalType: 'string' },
      { name: 'decimals', type: 'uint8', internalType: 'uint8' },
      { name: 'originAddress', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'view',
  },
] as const;

/**
 * Destination-chain factory.
 *
 * `computeWrapperAddress` is deliberately called on-chain rather than
 * reimplementing CREATE2 in the SDK: the factory derives the address from its
 * own `type(PC20Wrapper).creationCode`, so calling the live registered factory
 * cannot desynchronize from the deployed wrapper bytecode the way a mirrored
 * init-code hash would.
 */
export const PC20_FACTORY_EVM = [
  {
    type: 'function',
    name: 'getWrapper',
    inputs: [{ name: 'sourceAsset', type: 'address', internalType: 'address' }],
    outputs: [{ name: 'wrapper', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'wrapperToSource',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'sourceToWrapper',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isPC20Wrapper',
    inputs: [{ name: 'addr', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'computeWrapperAddress',
    inputs: [{ name: 'sourceAsset', type: 'address', internalType: 'address' }],
    outputs: [{ name: 'predicted', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  // Name/symbol byte limits enforced at deployWrapper. Read so the SDK can fail
  // fast on the Push side instead of reverting on the destination chain.
  {
    type: 'function',
    name: 'MAX_NAME_LENGTH',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_SYMBOL_LENGTH',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  { type: 'error', name: 'EmptyName', inputs: [] },
  { type: 'error', name: 'NameTooLong', inputs: [] },
  { type: 'error', name: 'EmptySymbol', inputs: [] },
  { type: 'error', name: 'SymbolTooLong', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
] as const;

/** Deployed wrapper on an external chain. `SOURCE_ASSET` is immutable. */
export const PC20_WRAPPER_EVM = [
  {
    type: 'function',
    name: 'SOURCE_ASSET',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'factory',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
] as const;

/**
 * Destination Vault's configured factory.
 *
 * The Vault — not the gateway — is what calls `deployWrapper` at settlement
 * (`Vault.sol:327`), so this is the authoritative answer to where a
 * not-yet-deployed wrapper will land. Both pointers exist independently and are
 * set separately; they happen to agree on all four testnets today, but only
 * this one governs deployment.
 */
export const VAULT_PC20_FACTORY_EVM = [
  {
    type: 'function',
    name: 'pc20Factory',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IPC20Factory' }],
    stateMutability: 'view',
  },
] as const;

/**
 * External gateway's configured factory.
 *
 * Compared against `UniversalCore.pc20FactoryByChain` — if they disagree the
 * live gateway will not take the PC20 burn path for this token.
 */
export const EXTERNAL_GATEWAY_PC20_EVM = [
  {
    type: 'function',
    name: 'pc20Factory',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract IPC20Factory' }],
    stateMutability: 'view',
  },
] as const;
