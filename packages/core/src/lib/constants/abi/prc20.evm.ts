/**
 * UniversalCore ABI
 * Push Chain's UniversalCore precompile interface for gas fee estimation
 */
export const UNIVERSAL_CORE_EVM = [
  // Get outbound tx gas and fees for a PRC20 token with gas limit
  {
    type: 'function',
    name: 'getOutboundTxGasAndFees',
    inputs: [
      { name: '_prc20', type: 'address', internalType: 'address' },
      { name: 'gasLimitWithBaseLimit', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'protocolFee', type: 'uint256', internalType: 'uint256' },
      { name: 'gasPrice', type: 'uint256', internalType: 'uint256' },
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'gasLimitUsed', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'view',
  },
  // Per-chain base gas limit
  {
    type: 'function',
    name: 'baseGasLimitByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Gas price by chain namespace
  {
    type: 'function',
    name: 'gasPriceByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  // Gas token PRC20 by chain namespace
  {
    type: 'function',
    name: 'gasTokenPRC20ByChainNamespace',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  // Rescue funds gas limit (returns gas details for a given PRC-20 token)
  {
    type: 'function',
    name: 'getRescueFundsGasLimit',
    inputs: [
      { name: '_prc20', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'rescueGasLimit', type: 'uint256', internalType: 'uint256' },
      { name: 'gasPrice', type: 'uint256', internalType: 'uint256' },
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
    ],
    stateMutability: 'view',
  },
  // Swap and burn gas (gateway-only)
  {
    type: 'function',
    name: 'swapAndBurnGas',
    inputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'fee', type: 'uint24', internalType: 'uint24' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'deadline', type: 'uint256', internalType: 'uint256' },
      { name: 'caller', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'gasTokenOut', type: 'uint256', internalType: 'uint256' },
      { name: 'refund', type: 'uint256', internalType: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  // ---------------------------------------------------------------------
  // PC20 export + registry
  //
  // Source: push-chain-core-contracts/src/Interfaces/IUniversalCore.sol
  // `destChain` / `chainNamespace` are CAIP-2 chain ids ("eip155:11155111").
  // Wrapper identities are bytes32: EVM addresses left-padded, Solana pubkeys
  // stored raw. See internals/pc20/address-codec.ts.
  // ---------------------------------------------------------------------
  {
    type: 'function',
    name: 'getPC20ExportGasAndFees',
    inputs: [
      { name: 'destChainNamespace', type: 'string', internalType: 'string' },
      { name: 'gasLimit', type: 'uint256', internalType: 'uint256' },
      { name: 'pc20Token', type: 'address', internalType: 'address' },
    ],
    outputs: [
      { name: 'gasToken', type: 'address', internalType: 'address' },
      { name: 'gasFee', type: 'uint256', internalType: 'uint256' },
      { name: 'protocolFee', type: 'uint256', internalType: 'uint256' },
      { name: 'gasPrice', type: 'uint256', internalType: 'uint256' },
      { name: 'chainNamespace', type: 'string', internalType: 'string' },
      { name: 'gasLimitUsed', type: 'uint256', internalType: 'uint256' },
      { name: 'isFirstExport', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pc20DeploymentGasOverhead',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: 'overhead', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pc20Deployed',
    inputs: [
      { name: 'sourceAsset', type: 'address', internalType: 'address' },
      { name: 'destChain', type: 'string', internalType: 'string' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPC20Wrapper',
    inputs: [
      { name: 'sourceAsset', type: 'address', internalType: 'address' },
      { name: 'destChain', type: 'string', internalType: 'string' },
    ],
    outputs: [
      { name: 'wrapper', type: 'bytes32', internalType: 'bytes32' },
      { name: 'deployed', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPC20Source',
    inputs: [
      { name: 'wrapper', type: 'bytes32', internalType: 'bytes32' },
      { name: 'destChain', type: 'string', internalType: 'string' },
    ],
    outputs: [
      { name: 'sourceAsset', type: 'address', internalType: 'address' },
      { name: 'known', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pc20FactoryByChain',
    inputs: [{ name: 'chainNamespace', type: 'string', internalType: 'string' }],
    outputs: [{ name: 'factory', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pc20WrapperBySource',
    inputs: [
      { name: 'sourceAsset', type: 'address', internalType: 'address' },
      { name: 'destChain', type: 'string', internalType: 'string' },
    ],
    outputs: [{ name: 'wrapper', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pc20SourceByWrapper',
    inputs: [
      { name: 'destChain', type: 'string', internalType: 'string' },
      { name: 'wrapper', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [{ name: 'sourceAsset', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  // Errors
  {
    type: 'error',
    name: 'GasLimitBelowBase',
    inputs: [
      { name: 'provided', type: 'uint256', internalType: 'uint256' },
      { name: 'minimum', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'CorePaused', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'ZeroBaseGasLimit', inputs: [] },
  { type: 'error', name: 'ZeroGasPrice', inputs: [] },
  { type: 'error', name: 'ZeroRescueGasLimit', inputs: [] },
  {
    type: 'error',
    name: 'StaleGasData',
    inputs: [
      { name: 'observedAt', type: 'uint256', internalType: 'uint256' },
      { name: 'nowTimestamp', type: 'uint256', internalType: 'uint256' },
      { name: 'maxAge', type: 'uint256', internalType: 'uint256' },
    ],
  },
  { type: 'error', name: 'DeadlineExpired', inputs: [] },
  { type: 'error', name: 'PoolNotFound', inputs: [] },
  { type: 'error', name: 'InvalidTarget', inputs: [] },
  { type: 'error', name: 'InvalidFeeTier', inputs: [] },
  { type: 'error', name: 'SlippageExceeded', inputs: [] },
  { type: 'error', name: 'CallerIsNotUEModule', inputs: [] },
  { type: 'error', name: 'CallerIsNotGatewayPC', inputs: [] },
  { type: 'error', name: 'AutoSwapNotSupported', inputs: [] },
  { type: 'error', name: 'MinPCOutRequired', inputs: [] },
  { type: 'error', name: 'PRC20OperationFailed', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [] },
  { type: 'error', name: 'InsufficientAllowance', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'EmptyString', inputs: [] },
  { type: 'error', name: 'NonDigitCharacter', inputs: [] },
] as const;
