import { encodeFunctionData, encodeAbiParameters, isAddress, sha256, toBytes } from 'viem';
import { PushChain } from '../push-chain/push-chain';
import { CEA_EVM } from '../constants/abi/cea.evm';
import { ERC20_EVM } from '../constants/abi/erc20.evm';
import { UNIVERSAL_GATEWAY_PC } from '../constants/abi/universalGatewayPC.evm';
import { MoveableToken } from '../constants/tokens';
import { ZERO_ADDRESS, MIGRATION_SELECTOR, MULTICALL_SELECTOR, UEA_MULTICALL_SELECTOR } from '../constants/selectors';
import { CHAIN_INFO } from '../constants/chain';
import { VM, CHAIN } from '../constants/enums';
import type {
  LegacyExecuteParams,
  MultiCall,
  UniversalOutboundTxRequest,
  ChainTarget,
  SvmExecutePayloadFields,
} from './orchestrator.types';
import { hasExecutablePayloadData } from './data-utils';
import { VerificationType, type UniversalPayload } from '../generated/v1/tx';
import { encodeUniversalPayloadSvm } from './internals/signing';

export function buildExecuteMulticall({
  execute,
  ueaAddress,
  logger,
  allowSelfValueCall = false,
}: {
  execute: LegacyExecuteParams;
  ueaAddress: `0x${string}`;
  logger?: (msg: string) => void;
  allowSelfValueCall?: boolean;
}): MultiCall[] {
  const log = (msg: string) => logger?.(msg);
  const hasData = hasExecutablePayloadData(execute.data);

  log('buildExecuteMulticall — input: ' + JSON.stringify({
    to: execute.to,
    value: execute.value?.toString() ?? 'undefined',
    data: execute.data ? (Array.isArray(execute.data) ? `Array(${execute.data.length})` : execute.data.slice(0, 20) + '...') : 'undefined',
    hasData,
    fundsAmount: execute.funds?.amount?.toString() ?? 'undefined',
    fundsTokenSymbol: (execute.funds as { token?: MoveableToken })?.token?.symbol ?? 'undefined',
    fundsTokenMechanism: (execute.funds as { token?: MoveableToken })?.token?.mechanism ?? 'undefined',
    ueaAddress,
  }, null, 2));

  const multicallData: MultiCall[] = [];

  // *** We will pass the value alongside with the data in a single message now ***
  const branch1 = !hasData && execute.value;
  log(`buildExecuteMulticall — Branch 1 (!data && value): ${branch1} | !hasData: ${!hasData} | execute.value: ${execute.value?.toString() ?? 'undefined'}`);
  if (!hasData && execute.value) {
    const isValueToSelf =
      execute.to.toLowerCase() === ueaAddress.toLowerCase();

    if (isValueToSelf && !allowSelfValueCall) {
      log(
        'buildExecuteMulticall — Branch 1 SKIPPED: native value targets the UEA itself; parking value via gateway deposit'
      );
    } else {
      multicallData.push({
        to: execute.to,
        value: execute.value,
        data: '0x',
      });
      log(`buildExecuteMulticall — Branch 1 ENTERED: pushed native value transfer to ${execute.to}`);
    }
  }

  if (execute.funds?.amount) {
    const token = (execute.funds as { token: MoveableToken }).token;
    const isArrayMulticall = Array.isArray(execute.data) && execute.data.length > 0;
    const isNative = token.mechanism === 'native';
    log('buildExecuteMulticall — Branch 2 (funds): ' + JSON.stringify({
      amount: execute.funds.amount.toString(),
      mechanism: token.mechanism,
      isNative,
      isArrayMulticall,
      willAddErc20Transfer: !isNative && !isArrayMulticall,
      skippedReason: isNative ? 'native token — no PRC-20 transfer needed' : isArrayMulticall ? 'array multicall — user handles transfers' : 'none',
    }, null, 2));
    // Only add ERC-20 transfer for non-native tokens AND when NOT in array multicall mode
    // - Native tokens (ETH/SOL) are bridged as native PC on Push Chain, not as PRC-20
    // - When execute.data is an array (explicit multicall), user handles fund transfers in their calls
    if (!isNative && !isArrayMulticall) {
      const erc20Transfer = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [execute.to, execute.funds?.amount],
      });
      // A PC20 unlocks as its canonical Push-native token, which the resolver
      // already established. `getPRC20Address` must not run for it — there is
      // no static synthetic mapping to look up, and the symbol carries no
      // authority.
      const pc20 = (execute as { _pc20?: { pushAddress: `0x${string}` } })._pc20;
      const pushChainTo = pc20
        ? pc20.pushAddress
        : PushChain.utils.tokens.getPRC20Address(token).address;
      multicallData.push({
        to: pushChainTo,
        value: BigInt(0),
        data: erc20Transfer,
      });
      log(`buildExecuteMulticall — Branch 2 ENTERED: pushed ERC-20 transfer to ${pushChainTo}`);
    }
    // For native tokens or array multicall: funds arrive in UEA, user's multicall handles distribution
  } else {
    log('buildExecuteMulticall — Branch 2 SKIPPED: no funds.amount');
  }

  log(`buildExecuteMulticall — Branch 3 (execute.data): ${hasData}`);
  if (hasData) {
    // *************************
    // Check for `execute.to`
    // *************************

    // For multicall, there is no validation for execute.to. Only if that's a valid EVM address
    if (Array.isArray(execute.data)) {
      if (!isAddress(execute.to))
        throw new Error(`Invalid EVM address at execute.to ${execute.to}`);
    } else {
      // We can't execute payload against our UEA.
      // if (execute.to === ueaAddress)
      //   throw new Error(`You can't execute data on the UEA address`);
    }

    if (Array.isArray(execute.data)) {
      multicallData.push(...(execute.data as MultiCall[]));
      log(`buildExecuteMulticall — Branch 3 ENTERED: pushed ${(execute.data as MultiCall[]).length} array multicall entries`);
    } else {
      multicallData.push({
        to: execute.to,
        value: execute.value ? execute.value : BigInt(0),
        data: execute.data as `0x${string}`,
      });
      log(`buildExecuteMulticall — Branch 3 ENTERED: pushed single calldata to ${execute.to}`);
    }
  }

  log('buildExecuteMulticall — result: multicallData.length: ' + multicallData.length + ' ' +
    JSON.stringify(multicallData, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  return multicallData;
}

// ============================================================================
// Multi-Chain Payload Builders
// ============================================================================

/**
 * Multicall tuple type definition for ABI encoding
 */
export const MULTICALL_TUPLE_TYPE = {
  type: 'tuple[]',
  components: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

/**
 * Build CEA multicall payload for outbound transactions
 * Format: UEA_MULTICALL_SELECTOR + abi.encode(Multicall[])
 *
 * The CEA contract checks for UEA_MULTICALL_SELECTOR (0x2cc2842d) at the
 * start of the payload to route to _handleMulticall. Without this prefix,
 * the CEA treats it as a single call and fails with InvalidRecipient.
 *
 * @param multicalls - Array of multicall operations to execute on external chain
 * @returns UEA_MULTICALL_SELECTOR + ABI-encoded Multicall[] array
 */
export function buildCeaMulticallPayload(multicalls: MultiCall[]): `0x${string}` {
  if (multicalls.length === 0) {
    return '0x';
  }

  // Encode the multicall array
  const encoded = encodeAbiParameters(
    [MULTICALL_TUPLE_TYPE],
    [multicalls.map((m) => ({
      to: m.to,
      value: m.value,
      data: m.data,
    }))]
  );

  // Prefix with UEA_MULTICALL_SELECTOR (0x2cc2842d) so CEA recognizes it as multicall
  return `${UEA_MULTICALL_SELECTOR}${encoded.slice(2)}` as `0x${string}`;
}

/**
 * Build an ABI-encoded UniversalPayload struct for EVM-origin inbound relay
 * (Route 3 CEA→Push).
 *
 * The relay and Push Chain gateway expect the payload parameter of sendUniversalTxToUEA
 * to be a full UniversalPayload struct: (address to, uint256 value, bytes data, uint256 gasLimit,
 * uint256 maxFeePerGas, uint256 maxPriorityFeePerGas, uint256 nonce, uint256 deadline, uint8 vType).
 *
 * The `data` field inside the struct contains the multicall payload (with UEA_MULTICALL_SELECTOR prefix)
 * which the UEA uses to execute calls on Push Chain.
 *
 * @param multicallData - The multicall payload (selector + abi.encode(Multicall[]))
 * @param opts - Optional overrides for gasLimit, nonce, deadline
 * @returns ABI-encoded UniversalPayload struct
 */
export function buildInboundUniversalPayload(
  multicallData: `0x${string}`,
  opts?: {
    gasLimit?: bigint;
    nonce?: bigint;
    deadline?: bigint;
  }
): `0x${string}` {
  return encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
        ],
      },
    ],
    [
      {
        to: ZERO_ADDRESS as `0x${string}`,
        value: BigInt(0),
        data: multicallData,
        gasLimit: opts?.gasLimit ?? BigInt(10e7),
        maxFeePerGas: BigInt(1e10),
        maxPriorityFeePerGas: BigInt(0),
        nonce: opts?.nonce ?? BigInt(0),
        deadline: opts?.deadline ?? BigInt(9999999999),
        vType: 1, // universalTxVerification
      },
    ]
  );
}

/**
 * Build a Borsh-encoded UniversalPayload for SVM-origin inbound relay.
 *
 * Push Chain decodes SVM-origin UniversalTx payloads with
 * DecodeUniversalPayloadSolana, not the EVM ABI decoder used for EVM origins.
 */
export function buildInboundUniversalPayloadSvm(
  multicallData: `0x${string}`,
  opts?: {
    gasLimit?: bigint;
    nonce?: bigint;
    deadline?: bigint;
  }
): `0x${string}` {
  const payload: UniversalPayload = {
    to: ZERO_ADDRESS,
    value: BigInt(0).toString(),
    data: multicallData,
    gasLimit: (opts?.gasLimit ?? BigInt(100_000_000)).toString(),
    maxFeePerGas: BigInt(10_000_000_000).toString(),
    maxPriorityFeePerGas: BigInt(0).toString(),
    nonce: (opts?.nonce ?? BigInt(0)).toString(),
    deadline: (opts?.deadline ?? BigInt(9_999_999_999)).toString(),
    vType: VerificationType.universalTxVerification,
  };
  return `0x${encodeUniversalPayloadSvm(payload).toString('hex')}`;
}

/**
 * Build sendUniversalTxToUEA call for CEA self-call (Route 3)
 *
 * The CEA contract has a `sendUniversalTxToUEA(token, amount, payload, revertRecipient)` function
 * that is only callable via self-call (multicall with to=CEA, value=0).
 * It internally calls `gateway.sendUniversalTxFromCEA(...)`.
 *
 * @param ceaAddress - CEA contract address (multicall target = self)
 * @param token - Token address (address(0) for native)
 * @param amount - Amount to send
 * @param payload - Payload for Push Chain execution
 * @param revertRecipient - Address to receive funds on revert (on source chain)
 * @returns MultiCall for sendUniversalTxToUEA (to=CEA, value=0)
 */
export function buildSendUniversalTxToUEA(
  ceaAddress: `0x${string}`,
  token: `0x${string}`,
  amount: bigint,
  payload: `0x${string}`,
  revertRecipient: `0x${string}`
): MultiCall {
  const calldata = encodeFunctionData({
    abi: CEA_EVM,
    functionName: 'sendUniversalTxToUEA',
    args: [token, amount, payload, revertRecipient],
  });

  return {
    to: ceaAddress,
    value: BigInt(0),
    data: calldata,
  };
}

/**
 * Build UniversalOutboundTxRequest for Push Chain outbound
 *
 * @param recipient - Raw recipient bytes for the destination chain. For EVM CEA
 *                    funds-parking, use the zero recipient when payload is empty.
 * @param prc20Token - PRC20 token address to burn (or address(0) for native)
 * @param amount - Amount to burn
 * @param gasLimit - Gas limit for fee calculation
 * @param payload - Destination execution payload
 * @param revertRecipient - Address to receive funds on revert
 * @param maxPCForGas - Max native PC used for gas swap (0 = uncapped)
 * @param gasPrice - Destination-chain gas price override (0 = UniversalCore default)
 * @returns UniversalOutboundTxRequest object
 */
export function buildOutboundRequest(
  recipient: `0x${string}`,
  prc20Token: `0x${string}`,
  amount: bigint,
  gasLimit: bigint,
  payload: `0x${string}`,
  revertRecipient: `0x${string}`,
  maxPCForGas = BigInt(0),
  gasPrice = BigInt(0)
): UniversalOutboundTxRequest {
  return {
    recipient,
    token: prc20Token,
    amount,
    gasLimit,
    gasPrice,
    maxPCForGas,
    payload,
    revertRecipient,
  };
}

export function assertCeaFundsParkingInvariant(
  recipient: `0x${string}`,
  payload: `0x${string}`
): void {
  if (payload !== '0x') return;
  if (recipient === '0x') return;
  if (recipient.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return;

  throw new Error(
    'Empty CEA payloads must use the zero recipient to park funds'
  );
}

/**
 * Build ERC20 transfer multicall
 *
 * @param tokenAddress - ERC20 token address
 * @param to - Recipient address
 * @param amount - Amount to transfer
 * @returns MultiCall for ERC20 transfer
 */
export function buildErc20Transfer(
  tokenAddress: `0x${string}`,
  to: `0x${string}`,
  amount: bigint
): MultiCall {
  const transferData = encodeFunctionData({
    abi: ERC20_EVM,
    functionName: 'transfer',
    args: [to, amount],
  });

  return {
    to: tokenAddress,
    value: BigInt(0),
    data: transferData,
  };
}

/**
 * Build a single-element MultiCall[] for an ERC20 withdrawal (Flow 2.2).
 * Wraps buildErc20Transfer so callers of Route 2 (executeUoaToCea) don't
 * need to manually construct the transfer() multicall step.
 *
 * @param tokenAddress - ERC20 token contract on the external chain
 * @param recipientAddress - Withdrawal recipient on the external chain
 * @param amount - Amount of tokens to transfer
 * @returns MultiCall[] with a single ERC20 transfer call
 */
export function buildErc20WithdrawalMulticall(
  tokenAddress: `0x${string}`,
  recipientAddress: `0x${string}`,
  amount: bigint
): MultiCall[] {
  return [buildErc20Transfer(tokenAddress, recipientAddress, amount)];
}

/**
 * Build the 4-byte migration payload for CEA upgrade (Migration flow).
 * Returns exactly MIGRATION_SELECTOR — no Multicall wrapping.
 *
 * @returns 4-byte hex string `0xcac656d6`
 */
export function buildMigrationPayload(): `0x${string}` {
  return MIGRATION_SELECTOR as `0x${string}`;
}

// ============================================================================
// Cascade Composition Helpers
// ============================================================================

/**
 * Build approval multicalls + sendUniversalTxOutbound call for Push Chain.
 *
 * Extracted from executeUoaToCea to be reusable in cascade composition.
 * The PRC-20 approval covers only the burn amount. Destination gas is funded
 * through native PC msg.value on sendUniversalTxOutbound; UniversalCore swaps
 * that native value into the route gas token inside swapAndBurnGas.
 *
 * @param opts.prc20Token - PRC-20 token to burn
 * @param opts.gasToken - Gas token for fee payment, used by the outbound request
 * @param opts.burnAmount - Amount to burn
 * @param opts.gasFee - Gas fee amount, used only for fallback native value sizing
 * @param opts.gatewayPcAddress - UniversalGatewayPC precompile address
 * @param opts.outboundRequest - The outbound request struct
 * @returns Array of MultiCall operations (approvals + outbound call)
 */
export function buildOutboundApprovalAndCall(opts: {
  prc20Token: `0x${string}`;
  gasToken: `0x${string}`;
  burnAmount: bigint;
  gasFee: bigint;
  nativeValueForGas?: bigint;
  gatewayPcAddress: `0x${string}`;
  outboundRequest: UniversalOutboundTxRequest;
}): MultiCall[] {
  const { prc20Token, gasFee, gatewayPcAddress, outboundRequest } = opts;
  const multicalls: MultiCall[] = [];

  // ERC20 approve for burn amount (contract calls transferFrom for PRC20 burn)
  // Reset to 0 first for USDT-style tokens that revert on non-zero to non-zero approve.
  if (
    opts.burnAmount > BigInt(0) &&
    prc20Token.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
  ) {
    const approveZeroData = encodeFunctionData({
      abi: ERC20_EVM,
      functionName: 'approve',
      args: [gatewayPcAddress, BigInt(0)],
    });
    const approveData = encodeFunctionData({
      abi: ERC20_EVM,
      functionName: 'approve',
      args: [gatewayPcAddress, opts.burnAmount],
    });
    multicalls.push({
      to: prc20Token,
      value: BigInt(0),
      data: approveZeroData,
    });
    multicalls.push({
      to: prc20Token,
      value: BigInt(0),
      data: approveData,
    });
  }

  // Gas fee + protocol fee paid as native msg.value (no ERC20 approve for gas)
  const outboundCallData = encodeFunctionData({
    abi: UNIVERSAL_GATEWAY_PC,
    functionName: 'sendUniversalTxOutbound',
    args: [outboundRequest],
  });

  // Use pre-computed nativeValueForGas (from Uniswap quoter) or fallback to 5x gasFee
  const nativeValue = opts.nativeValueForGas ?? (gasFee * BigInt(5));

  multicalls.push({
    to: gatewayPcAddress,
    value: nativeValue,
    data: outboundCallData,
  });

  return multicalls;
}

// ============================================================================
// SVM (Solana) Payload Builders
// ============================================================================

/**
 * Check if a chain targets the SVM (Solana) virtual machine
 */
export function isSvmChain(chain: CHAIN): boolean {
  return CHAIN_INFO[chain]?.vm === VM.SVM;
}

/**
 * Validate a Solana address in 0x-prefixed hex format.
 * Must be exactly 32 bytes (0x + 64 hex chars = 66 characters total).
 */
export function isValidSolanaHexAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(address);
}

/**
 * Conservative upper bound for SVM outbound instruction data. Solana's packet
 * limit is 1232 bytes before the transaction envelope, accounts, blockhash,
 * and signatures, so SDK-built instruction data must stay well below that.
 */
export const SVM_RELAYABLE_PAYLOAD_MAX_BYTES = 1000;

export function getHexPayloadByteLength(payload: `0x${string}`): number {
  return Math.max(0, (payload.length - 2) / 2);
}

export function assertSvmPayloadWithinRelayLimit(
  payload: `0x${string}`,
  context: string,
  maxBytes = SVM_RELAYABLE_PAYLOAD_MAX_BYTES
): void {
  const payloadBytes = getHexPayloadByteLength(payload);
  if (payloadBytes <= maxBytes) return;

  throw new Error(
    `SVM outbound payload for ${context} is ${payloadBytes} bytes, ` +
      `exceeding relay-safe limit ${maxBytes} bytes. Solana cannot carry ` +
      `this much instruction data in one transaction; split the cascade into ` +
      `separate transactions or reduce the nested payload.`
  );
}

/** Convert 0x-prefixed hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string (no 0x prefix) */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encode SVM execute payload for CPI execution on Solana.
 *
 * Binary format (matching the Solana gateway contract expectation):
 * ```
 * [accounts_count: 4 bytes (u32 BE)]
 * [account[i].pubkey: 32 bytes][account[i].is_writable: 1 byte] × N
 * [ix_data_length: 4 bytes (u32 BE)]
 * [ix_data: variable bytes]
 * [instruction_id: 1 byte (u8)]
 * [target_program: 32 bytes]
 * ```
 *
 * @param fields - SVM execute payload fields
 * @returns 0x-prefixed hex string of the encoded payload
 */
export function encodeSvmExecutePayload(
  fields: SvmExecutePayloadFields
): `0x${string}` {
  const {
    targetProgram,
    accounts,
    ixData,
    instructionId = 2,
  } = fields;

  // Total size:
  // 4 (accounts_count) + 33*N (accounts) + 4 (ix_data_length) + M (ix_data) + 1 (instruction_id) + 32 (target_program)
  const totalSize =
    4 + 33 * accounts.length + 4 + ixData.length + 1 + 32;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // accounts_count (u32 BE)
  view.setUint32(offset, accounts.length, false);
  offset += 4;

  // Each account: pubkey (32 bytes) + is_writable (1 byte)
  for (const account of accounts) {
    const pubkeyBytes = hexToBytes(account.pubkey);
    buffer.set(pubkeyBytes, offset);
    offset += 32;
    buffer[offset] = account.isWritable ? 1 : 0;
    offset += 1;
  }

  // ix_data_length (u32 BE)
  view.setUint32(offset, ixData.length, false);
  offset += 4;

  // ix_data
  buffer.set(ixData, offset);
  offset += ixData.length;

  // instruction_id (u8)
  buffer[offset] = instructionId;
  offset += 1;

  // target_program (32 bytes)
  const targetProgramBytes = hexToBytes(targetProgram);
  buffer.set(targetProgramBytes, offset);

  return `0x${bytesToHex(buffer)}` as `0x${string}`;
}

/**
 * Encode the SVM CEA-to-UEA payload for Route 3 on Solana.
 *
 * This builds a `send_universal_tx_to_uea` instruction wrapped in
 * `encodeSvmExecutePayload`, targeting the gateway program as a self-call.
 *
 * Borsh ixData layout:
 * ```
 * [discriminator: 8 bytes (SHA-256("global:send_universal_tx_to_uea")[0..8])]
 * [token: 32 bytes (PublicKey::default for SOL, mint pubkey for SPL)]
 * [amount: 8 bytes (u64 LE)]
 * [payload_len: 4 bytes (u32 LE)]
 * [payload_bytes: variable]
 * [revert_recipient: 32 bytes (PublicKey)]
 * ```
 */
export function encodeSvmCeaToUeaPayload({
  gatewayProgramHex,
  drainAmount,
  tokenMintHex,
  extraPayload,
  revertRecipientHex,
}: {
  gatewayProgramHex: `0x${string}`;
  drainAmount: bigint;
  tokenMintHex?: `0x${string}`;
  extraPayload?: Uint8Array;
  /** 32-byte Solana pubkey as 0x-hex for revert recipient (required) */
  revertRecipientHex: `0x${string}`;
}): `0x${string}` {
  // Anchor discriminator: first 8 bytes of SHA-256("global:send_universal_tx_to_uea")
  const discrimHash = sha256(toBytes('global:send_universal_tx_to_uea'));
  const discrimBytes = hexToBytes(discrimHash.slice(0, 18) as `0x${string}`); // 0x + 16 hex chars = 8 bytes

  // Token: 32 zero bytes for native SOL, or the SPL mint bytes
  const tokenBytes = new Uint8Array(32);
  if (tokenMintHex && tokenMintHex !== '0x' + '00'.repeat(32)) {
    const mintBytes = hexToBytes(tokenMintHex);
    tokenBytes.set(mintBytes, 0);
  }

  // Amount: u64 little-endian
  const amountBuf = new Uint8Array(8);
  const amountView = new DataView(amountBuf.buffer);
  amountView.setBigUint64(0, drainAmount, true); // LE

  // Extra payload (Vec<u8>: u32 LE length + bytes)
  const payloadData = extraPayload ?? new Uint8Array(0);
  const payloadLenBuf = new Uint8Array(4);
  const payloadLenView = new DataView(payloadLenBuf.buffer);
  payloadLenView.setUint32(0, payloadData.length, true); // LE

  // revertRecipient: 32 bytes (PublicKey)
  const revertRecipientBytes = hexToBytes(revertRecipientHex);

  // Combine into Borsh ixData
  const ixDataLen =
    discrimBytes.length + tokenBytes.length + amountBuf.length +
    payloadLenBuf.length + payloadData.length + revertRecipientBytes.length;
  const ixData = new Uint8Array(ixDataLen);
  let offset = 0;
  ixData.set(discrimBytes, offset); offset += discrimBytes.length;
  ixData.set(tokenBytes, offset); offset += tokenBytes.length;
  ixData.set(amountBuf, offset); offset += amountBuf.length;
  ixData.set(payloadLenBuf, offset); offset += payloadLenBuf.length;
  ixData.set(payloadData, offset); offset += payloadData.length;
  ixData.set(revertRecipientBytes, offset);

  // Wrap in encodeSvmExecutePayload (self-call to gateway, no extra accounts)
  return encodeSvmExecutePayload({
    targetProgram: gatewayProgramHex,
    accounts: [],
    ixData,
    instructionId: 2,
  });
}
