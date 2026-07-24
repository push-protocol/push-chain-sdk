/**
 * Route handler functions extracted from Orchestrator.
 *
 * Each function corresponds to one of the multichain execution routes:
 *   - executeMultiChain  (dispatch)
 *   - executeUoaToCea    (Route 2 EVM)
 *   - executeUoaToCeaSvm (Route 2 SVM)
 *   - executeCeaToPush   (Route 3 EVM)
 *   - executeCeaToPushSvm(Route 3 SVM)
 *   - executeCeaToCea    (Route 4 stub)
 *   - buildPayloadForRoute
 *
 * Every method receives an `OrchestratorContext` as first parameter and an
 * `executeFn` callback that replaces the former `this.execute()` call.
 */

import { PublicKey } from '@solana/web3.js';
import {
  encodeFunctionData,
  hexToBytes,
  zeroAddress,
} from 'viem';

import type { OrchestratorContext } from './context';
import { printLog, fireProgressHook } from './context';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import {
  isPushChain,
  getChainNamespace,
  getNativePRC20ForChain,
  getUniversalGatewayPCAddress,
  toExecuteParams,
} from './helpers';
import {
  buildUniversalTxRequest,
  buildMulticallPayloadData,
} from './payload-builder';
import {
  computeUEAOffchain,
  getUEANonce,
} from './uea-manager';
import {
  queryOutboundGasFee,
  estimateNativeValueForSwap,
  estimateDepositFromLockedNative,
} from './gas-calculator';
import {
  runPreflight,
  maybeFireSvmWarnThreshold,
} from './preflight';
import { ensureSvmFinalizeGasBudgetQuote } from './svm-rent';

import { CHAIN_INFO, VM_NAMESPACE } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import { MOVEABLE_TOKENS, MoveableToken } from '../../constants/tokens';
import { Utils } from '../../utils';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { TransactionRoute, detectRoute, validateRouteParams } from '../route-detector';
import { getCEAAddress, chainSupportsOutbound } from '../cea-utils';
import { buildSvmPayloadFromParams } from '../svm-idl/build-payload';
import { hasExecutablePayloadData } from '../data-utils';
import {
  buildExecuteMulticall,
  buildCeaMulticallPayload,
  buildInboundUniversalPayload,
  buildInboundUniversalPayloadSvm,
  buildOutboundRequest,
  buildSendUniversalTxToUEA,
  buildOutboundApprovalAndCall,
  buildMigrationPayload,
  assertCeaFundsParkingInvariant,
  assertSvmPayloadWithinRelayLimit,
  isSvmChain,
  isValidSolanaHexAddress,
  encodeSvmCeaToUeaPayload,
} from '../payload-builders';
import {
  DEFAULT_CEA_TO_PUSH_GAS_LIMIT,
  ZERO_ADDRESS,
} from '../../constants/selectors';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { PushChain } from '../../push-chain/push-chain';
import type {
  ChainTarget,
  ExecuteParams,
  MultiCall,
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
  UniversalTxRequest,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { PUSH_NETWORK } from '../../constants/enums';

export function getRequiredNativeBalanceForOutbound(
  nativeValueForGas: bigint,
  gasReserve: bigint
): bigint {
  return nativeValueForGas + gasReserve;
}

export function shouldSkipFeeLockingForOutbound(opts: {
  isUEADeployed: boolean;
  balance: bigint;
  nativeValueForGas: bigint;
  gasReserve: bigint;
}): boolean {
  return (
    opts.isUEADeployed &&
    opts.balance >= getRequiredNativeBalanceForOutbound(
      opts.nativeValueForGas,
      opts.gasReserve
    )
  );
}

// =============================================================================
// Route 2 (UEA → CEA) phase helpers
// =============================================================================

/**
 * Decide which PRC-20 token to burn on Push Chain and how much of it to burn
 * for a Route 2 EVM outbound call. Chain-local — does NOT require a resolved
 * CEA address, so it can run before the 203 account-resolution phase.
 */
function resolveR2Prc20TokenEvm(
  params: UniversalExecuteParams,
  targetChain: CHAIN,
  pushNetwork: PUSH_NETWORK
): { prc20Token: `0x${string}`; burnAmount: bigint } {
  let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let burnAmount = BigInt(0);

  if (params.migration) {
    // Migration is logic-only — no funds. CEA rejects msg.value != 0.
    prc20Token = getNativePRC20ForChain(targetChain, pushNetwork);
    burnAmount = BigInt(0);
  } else if (params.funds?.amount) {
    // User explicitly specified funds with token
    const token = (params.funds as { token: MoveableToken }).token;
    if (token) {
      prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
      burnAmount = params.funds.amount;
    }
  } else if (params.value && params.value > BigInt(0)) {
    // Native value transfer: auto-select the PRC-20 token for target chain
    prc20Token = getNativePRC20ForChain(targetChain, pushNetwork);
    burnAmount = params.value;
  } else if (hasExecutablePayloadData(params.data)) {
    // PAYLOAD-only (no value transfer): still need native token for chain namespace + gas fees
    prc20Token = getNativePRC20ForChain(targetChain, pushNetwork);
    burnAmount = BigInt(0);
  }

  return { prc20Token, burnAmount };
}

export function resolveR2DestinationFundsToken(
  token: MoveableToken,
  targetChain: CHAIN,
  pushNetwork: PUSH_NETWORK
): MoveableToken {
  const pushToken = token as MoveableToken & {
    prc20Address?: `0x${string}`;
    sourceChain?: CHAIN;
  };

  if (!pushToken.prc20Address || pushToken.sourceChain !== targetChain) {
    return token;
  }

  const destinationTokens = MOVEABLE_TOKENS[targetChain] ?? [];
  const nativePrc20 = getNativePRC20ForChain(targetChain, pushNetwork);
  if (pushToken.prc20Address.toLowerCase() === nativePrc20.toLowerCase()) {
    return (
      destinationTokens.find((candidate) => candidate.mechanism === 'native') ??
      {
        symbol: token.symbol,
        decimals: token.decimals,
        address: ZERO_ADDRESS,
        mechanism: 'native',
      }
    );
  }

  return (
    destinationTokens.find((candidate) => candidate.symbol === token.symbol) ??
    token
  );
}

/**
 * SVM counterpart to `resolveR2Prc20TokenEvm`. SVM adds an EXECUTE-only
 * branch (no value, no funds, but `hasSvmExecute === true`) that still needs
 * a PRC-20 token for the chain-namespace lookup.
 */
function resolveR2Prc20TokenSvm(
  params: UniversalExecuteParams,
  targetChain: CHAIN,
  pushNetwork: PUSH_NETWORK,
  hasSvmExecute: boolean
): { prc20Token: `0x${string}`; burnAmount: bigint } {
  let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let burnAmount = BigInt(0);

  if (params.funds?.amount) {
    const token = (params.funds as { token: MoveableToken }).token;
    if (token) {
      prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
      burnAmount = params.funds.amount;
    }
  } else if (params.value && params.value > BigInt(0)) {
    prc20Token = getNativePRC20ForChain(targetChain, pushNetwork);
    burnAmount = params.value;
  } else if (hasSvmExecute) {
    const token = params.funds && (params.funds as { token: MoveableToken }).token;
    if (token) {
      prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
    } else {
      prc20Token = getNativePRC20ForChain(targetChain, pushNetwork);
    }
    burnAmount = BigInt(0);
  }

  return { prc20Token, burnAmount };
}

function resolveR3SvmDrain(
  params: UniversalExecuteParams,
  sourceChain: CHAIN,
  pushNetwork: PUSH_NETWORK
): {
  prc20Token: `0x${string}`;
  drainAmount: bigint;
  tokenMintHex: `0x${string}` | undefined;
  splMintBase58: string | undefined;
} {
  let drainAmount = BigInt(0);
  let tokenMintHex: `0x${string}` | undefined;
  let splMintBase58: string | undefined;
  let prc20Token = getNativePRC20ForChain(sourceChain, pushNetwork);

  if (params.funds?.amount && params.funds.amount > BigInt(0)) {
    drainAmount = params.funds.amount;
    const token = (params.funds as { token?: MoveableToken }).token;
    if (token?.mechanism === 'approve') {
      const mintPk = new PublicKey(token.address);
      tokenMintHex = ('0x' + Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
      splMintBase58 = token.address;
      prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
    }
  } else if (params.value && params.value > BigInt(0)) {
    drainAmount = params.value;
  }

  return { prc20Token, drainAmount, tokenMintHex, splMintBase58 };
}

function buildR3SvmExtraPayload(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  ueaAddress: `0x${string}`,
  sourceChain: CHAIN,
  inboundNonce?: bigint
): Uint8Array | undefined {
  const shouldBuildPushPayload =
    hasExecutablePayloadData(params.data) ||
    Boolean(params.funds?.amount && (params.value ?? BigInt(0)) > BigInt(0));

  if (!shouldBuildPushPayload) {
    return undefined;
  }

  const executeParams = toExecuteParams(params);
  const multicallCtx = {
    ...ctx,
    universalSigner: {
      ...ctx.universalSigner,
      account: {
        ...ctx.universalSigner.account,
        chain: sourceChain,
      },
    },
  } as OrchestratorContext;
  const multicallPayload = buildMulticallPayloadData(
    multicallCtx,
    executeParams.to,
    buildExecuteMulticall({
      execute: executeParams,
      ueaAddress,
      allowSelfValueCall: true,
    })
  );
  const inboundPayload = buildInboundUniversalPayloadSvm(multicallPayload, {
    nonce: inboundNonce ?? BigInt(0),
  });

  return hexToBytes(inboundPayload);
}

/**
 * Build the CEA-side multicall payload for a Route 2 EVM outbound. Needs the
 * resolved `ceaAddress` because the native-value self-call branch skips the
 * multicall when the target IS the CEA (avoids a CEA._handleMulticall revert).
 */
function buildR2CeaPayloadEvm(
  params: UniversalExecuteParams,
  ceaAddress: string,
  targetAddress: `0x${string}`,
  targetChain: CHAIN,
  pushNetwork: PUSH_NETWORK
): `0x${string}` {
  if (params.migration) {
    return buildMigrationPayload();
  }

  const ceaMulticalls: MultiCall[] = [];
  const hasData = hasExecutablePayloadData(params.data);
  const fundsToken = params.funds?.amount
    ? resolveR2DestinationFundsToken(
        (params.funds as { token: MoveableToken }).token,
        targetChain,
        pushNetwork
      )
    : undefined;
  const nativeFundsValue =
    params.funds?.amount && fundsToken?.mechanism === 'native'
      ? params.funds.amount
      : BigInt(0);

  if (hasData) {
    if (Array.isArray(params.data)) {
      ceaMulticalls.push(...(params.data as MultiCall[]));
    } else {
      // When ERC-20 funds are provided with a single payload, auto-prepend a
      // transfer() call so the tokens minted to the CEA are forwarded to the
      // target address. Mirrors the Route 1 behavior in buildExecuteMulticall.
      if (params.funds?.amount) {
        if (fundsToken && fundsToken.mechanism !== 'native') {
          const erc20Transfer = encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [targetAddress, params.funds.amount],
          });
          ceaMulticalls.push({
            to: fundsToken.address as `0x${string}`,
            value: BigInt(0),
            data: erc20Transfer,
          });
        }
      }
      // Single call with data. Forward native value (if any) so the target
      // contract receives it alongside the payload call.
      ceaMulticalls.push({
        to: targetAddress,
        value: (params.value ?? BigInt(0)) + nativeFundsValue,
        data: params.data as `0x${string}`,
      });
    }
  } else {
    if (params.funds?.amount && fundsToken && fundsToken.mechanism !== 'native') {
      // ERC-20 funds: forward via ERC20.transfer from the CEA.
      const erc20Transfer = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [targetAddress, params.funds.amount],
      });
      ceaMulticalls.push({
        to: fundsToken.address as `0x${string}`,
        value: BigInt(0),
        data: erc20Transfer,
      });
    }

    if (params.value) {
      // Native value transfer only. Skip the multicall when sending to the CEA
      // itself — a value-bearing self-call would revert in CEA._handleMulticall.
      if (targetAddress.toLowerCase() !== ceaAddress.toLowerCase()) {
        ceaMulticalls.push({
          to: targetAddress,
          value: params.value,
          data: '0x',
        });
      }
    } else if (nativeFundsValue > BigInt(0)) {
      // Native funds (e.g. pETH → ETH): forward value to the recipient.
      // Self-CEA is skipped — the gateway already deposits into the CEA.
      if (targetAddress.toLowerCase() !== ceaAddress.toLowerCase()) {
        ceaMulticalls.push({
          to: targetAddress,
          value: nativeFundsValue,
          data: '0x',
        });
      }
    }
  }

  return buildCeaMulticallPayload(ceaMulticalls);
}

// ---------------------------------------------------------------------------
// Callback type for this.execute() replacement
// ---------------------------------------------------------------------------

type ExecuteFn = (
  params: ExecuteParams | UniversalExecuteParams
) => Promise<UniversalTxResponse>;

// ---------------------------------------------------------------------------
// Sizing progress hook fan-out
// ---------------------------------------------------------------------------

import type { GasSizingDecision } from './gas-usd-sizer';

const SIZER_HOOK_BY_ROUTE = {
  R3: {
    A: PROGRESS_HOOK.SEND_TX_303_03_01,
    B: PROGRESS_HOOK.SEND_TX_303_03_02,
    C: PROGRESS_HOOK.SEND_TX_303_03_03,
  },
} as const;

/**
 * Fire the route-scoped sizing progress hook based on the sizer's decision.
 * Emits the consumer-facing shape { gasRequired, extraDepositPC, totalDepositUSD, chain }.
 * - gasRequired   = sizer's gas leg in native PC wei
 * - extraDepositPC = overflow in native PC wei (> 0 only for Case C)
 * - totalDepositUSD = sized total in USD (8-dec): $1 for Case A (padded),
 *   raw gasUsd for Case B/C (which for Case C equals gasLegUsd + overflowUsd).
 */
function fireSizingHook(
  ctx: OrchestratorContext,
  route: 'R3',
  chain: CHAIN,
  sizing: GasSizingDecision
): void {
  const hook = SIZER_HOOK_BY_ROUTE[route][sizing.category];
  const ONE_USD_8D = BigInt(100_000_000);
  const totalDepositUSD =
    sizing.category === 'A' ? ONE_USD_8D : sizing.gasUsd;
  fireProgressHook(
    ctx,
    hook,
    chain,
    sizing.gasLegNativePc,
    sizing.overflowNativePc,
    totalDepositUSD
  );
}

// ---------------------------------------------------------------------------
// executeMultiChain
// ---------------------------------------------------------------------------

/**
 * Dispatch a universal execution to the correct route handler.
 */
export async function executeMultiChain(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  // Validate route parameters
  validateRouteParams(params, {
    clientChain: ctx.universalSigner.account.chain,
  });

  // Detect the transaction route
  const route = detectRoute(params);

  printLog(
    ctx,
    `executeMultiChain — detected route: ${route}, params: ${JSON.stringify(
      {
        to:
          typeof params.to === 'string'
            ? params.to
            : { address: params.to.address, chain: params.to.chain },
        from: params.from,
        hasValue: params.value !== undefined,
        hasData: params.data !== undefined,
        hasFunds: params.funds !== undefined,
      },
      null,
      2
    )}`
  );

  let response: UniversalTxResponse;

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH:

      response = await executeFn(toExecuteParams(params));
      break;

    case TransactionRoute.UOA_TO_CEA:

      response = await executeUoaToCea(ctx, params, executeFn);
      break;

    case TransactionRoute.CEA_TO_PUSH:

      response = await executeCeaToPush(ctx, params, executeFn);
      break;

    case TransactionRoute.CEA_TO_CEA:

      response = await executeCeaToCea(ctx, params, executeFn);
      break;

    default:
      throw new Error(`Unknown transaction route: ${route}`);
  }

  // Set the route on the response for .wait() to use
  response.route = route;

  return response;
}

// ---------------------------------------------------------------------------
// executeUoaToCea  (Route 2 — EVM)
// ---------------------------------------------------------------------------

/**
 * Route 2: Execute outbound transaction from Push Chain to external CEA.
 *
 * Builds a multicall that executes on Push Chain (from UEA context):
 * 1. Approves the gateway to spend PRC-20 tokens (if needed)
 * 2. Calls sendUniversalTxOutbound on UniversalGatewayPC precompile
 *
 * The multicall is executed through the normal execute() flow which handles
 * fee-locking on the origin chain and signature verification.
 */
export async function executeUoaToCea(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  const target = params.to as ChainTarget;
  const targetChain = target.chain;
  const targetAddress = target.address;
  const isSvm = isSvmChain(targetChain);

  // Validate target address based on VM type
  if (isSvm) {
    // SVM: 32-byte hex address
    if (!isValidSolanaHexAddress(targetAddress)) {
      throw new Error(
        `Invalid Solana address: ${targetAddress}. ` +
          `Expected 0x + 64 hex chars (32 bytes).`
      );
    }
    const ZERO_32 = ('0x' + '0'.repeat(64)) as `0x${string}`;
    if (targetAddress.toLowerCase() === ZERO_32.toLowerCase()) {
      throw new Error(
        `Cannot send to zero address on Solana. ` +
          `This would result in permanent loss of funds.`
      );
    }
  } else {
    // EVM: 20-byte hex address
    // Zero address is allowed for multicall (data is array) — the actual targets are in the data entries.
    const isMulticall = Array.isArray(params.data);
    if (targetAddress.toLowerCase() === ZERO_ADDRESS.toLowerCase() && !isMulticall) {
      throw new Error(
        `Cannot send to zero address (0x0000...0000). ` +
          `This would result in permanent loss of funds.`
      );
    }
  }

  // Validate chain supports outbound operations
  if (!chainSupportsOutbound(targetChain)) {
    throw new Error(
      `Chain ${targetChain} does not support outbound operations. ` +
        `Supported chains: BNB_TESTNET, ETHEREUM_SEPOLIA, SOLANA_DEVNET, etc.`
    );
  }

  // Branch based on VM type
  if (isSvm) {
    return executeUoaToCeaSvm(ctx, params, target, executeFn);
  }

  // ===== EVM path (existing logic) =====

  // R2 pre-broadcast progress: external chain detected
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_201, targetChain, targetAddress);

  // Compute UEA address (sync, offchain derivation — no RPC).
  const ueaAddress = computeUEAOffchain(ctx);

  printLog(
    ctx,
    `executeUoaToCea — target chain: ${targetChain}, target address: ${targetAddress}, UEA: ${ueaAddress}`
  );

  // --- Token resolution (chain-local, before account resolution) ---
  // Resolve the PRC-20 burn token + burn amount ahead of CEA resolution.
  // Chain-local — see `resolveR2Prc20TokenEvm` above.
  const { prc20Token, burnAmount } = resolveR2Prc20TokenEvm(
    params,
    targetChain,
    ctx.pushNetwork
  );
  if (params.value && params.value > BigInt(0)) {
    printLog(
      ctx,
      `executeUoaToCea — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
    );
  } else if (
    !params.migration &&
    !params.funds?.amount &&
    hasExecutablePayloadData(params.data)
  ) {
    printLog(
      ctx,
      `executeUoaToCea — PAYLOAD-only: using native PRC-20 ${prc20Token} for chain ${targetChain} with zero burn amount`
    );
  }

  const gasLimitForQuery = params.gasLimit ?? BigInt(0);

  // --- 202: Gas estimation (spec-ordered before 203) ---
  let gasFee = BigInt(0);
  let protocolFee = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let universalCoreAddress: `0x${string}` | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_202_01, targetChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, gasLimitForQuery, targetChain);
      gasFee = result.gasFee;
      protocolFee = result.protocolFee;
      gasToken = result.gasToken;
      universalCoreAddress = result.universalCoreAddress;
      printLog(
        ctx,
        `executeUoaToCea — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_202_02,
        targetChain,
        protocolFee,
        gasFee
      );
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee: ${err}`);
    }
  }

  // --- 203: CEA resolution + UEA status (single round-trip burst) ---
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_203_01, targetChain);
  const signerChain = ctx.universalSigner.account.chain;
  const isNativePushEOA = isPushChain(signerChain);
  const [
    { cea: ceaAddress, isDeployed: ceaDeployed },
    [ueaCode, ueaBalance],
  ] = await Promise.all([
    getCEAAddress(ueaAddress, targetChain, ctx.rpcUrls[targetChain]?.[0]),
    Promise.all([
      ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
      ctx.pushClient.getBalance(ueaAddress),
    ]),
  ]);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_203_02,
    ueaAddress,
    ceaAddress,
    targetChain,
    ceaDeployed
  );
  printLog(
    ctx,
    `executeUoaToCea — CEA address: ${ceaAddress}, deployed: ${ceaDeployed}`
  );

  const isUEADeployed = isNativePushEOA || ueaCode !== undefined;
  const ueaNonce = (!isUEADeployed || isNativePushEOA) ? BigInt(0) : await getUEANonce(ctx, ueaAddress);

  // --- Build CEA payload (requires ceaAddress for self-call check) ---
  // Delegates to `buildR2CeaPayloadEvm` — see helper definition above.
  const ceaPayload: `0x${string}` = buildR2CeaPayloadEvm(
    params,
    ceaAddress,
    targetAddress as `0x${string}`,
    targetChain,
    ctx.pushNetwork
  );
  if (params.migration) {
    printLog(
      ctx,
      `executeUoaToCea — MIGRATION: using raw MIGRATION_SELECTOR payload (${ceaPayload}), native PRC-20 ${prc20Token}`
    );
  }

  // Build outbound request struct for the gateway
  // Empty CEA payloads intentionally use zero recipient to park funds in the
  // CEA under the post-audit single-call guard.
  const targetBytes = ceaPayload === '0x'
    ? (ZERO_ADDRESS as `0x${string}`)
    : ceaAddress;
  assertCeaFundsParkingInvariant(targetBytes, ceaPayload);

  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    targetBytes,
    prc20Token,
    burnAmount,
    gasLimitForQuery,
    ceaPayload,
    ueaAddress, // revert recipient is the UEA
    params.maxPCForGas ?? BigInt(0)
  );

  printLog(
    ctx,
    `executeUoaToCea — outbound request: ${JSON.stringify(
      {
        recipient: outboundReq.recipient,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        maxPCForGas: outboundReq.maxPCForGas.toString(),
        payloadLength: outboundReq.payload.length,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // Get UniversalGatewayPC address
  const gatewayPcAddress = getUniversalGatewayPCAddress();

  // Build the multicall that will execute ON Push Chain from UEA context
  // This includes: 1) approve PRC-20 (if needed), 2) call sendUniversalTxOutbound
  const pushChainMulticalls: MultiCall[] = [];

  // ---------------------------------------------------------------------
  // Native-value selection — R2 does NOT use Case A/B/C gas abstraction.
  // That feature is scoped to R1 (fee-lock USD caps) and R3 (CEA → Push
  // outbound msg.value). For R2 we size `nativeValueForGas` from the
  // live WPC/gasToken Uniswap V3 pool quote plus a 10% safety buffer;
  // `swapAndBurnGas` refunds any excess as PC back to UEA via
  // refundUnusedGas.
  //
  // Fresh-wallet prediction (below) is retained: it estimates post-fee-lock
  // UPC balance for UEAs that haven't been funded yet, independent of
  // Case A/B/C sizing.
  // ---------------------------------------------------------------------
  const EVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for outer-tx gas
  const EVM_NATIVE_VALUE_SAFETY_CAP = BigInt(200e18); // 200 UPC absolute ceiling
  const ROUTE2_MINIMUM_DEPOSIT_USD = Utils.helpers.parseUnits('10', 8); // $10

  // Effective balance: real for deployed UEAs; predicted post-fee-lock for fresh.
  let effectiveBalance = ueaBalance;
  if (!isUEADeployed && effectiveBalance <= EVM_GAS_RESERVE) {
    const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(signerChain);
    const nativeAmountETH = ethPrice > BigInt(0)
      ? (ROUTE2_MINIMUM_DEPOSIT_USD * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1)
      : BigInt(0);
    if (nativeAmountETH > BigInt(0)) {
      const originPrc20 = getNativePRC20ForChain(signerChain, ctx.pushNetwork);
      const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);
      if (predictedUPC > BigInt(0)) {
        // 10% safety margin for slippage between quote and actual execution
        effectiveBalance = (predictedUPC * BigInt(90)) / BigInt(100);
        printLog(ctx,
          `executeUoaToCea — fresh wallet: Uniswap quote predicts ${predictedUPC.toString()} UPC ` +
          `from ${nativeAmountETH.toString()} wei pETH, using ${effectiveBalance.toString()} (90%)`
        );
      }
    }
  }

  // estimateNativeValueForSwap applies the full 2.2x safety buffer
  // internally (pool-slippage cushion + the 10% headroom that used to be
  // multiplied here). Folded into one place so the function's cap branch
  // bounds the final value — the previous outer ×110/100 on top of the
  // inner cap broke preflight whenever the cap fired. Over-send is refunded
  // by the contract.
  let nativeValueForGas = BigInt(0);
  if (universalCoreAddress && gasFee > BigInt(0)) {
    nativeValueForGas = await estimateNativeValueForSwap(
      ctx, universalCoreAddress, gasToken, gasFee, effectiveBalance
    );
    printLog(ctx,
      `executeUoaToCea — nativeValueForGas=${nativeValueForGas.toString()} (includes 2.2x buffer)`
    );
  }

  // Hard safety cap so a broken pool price can't drain the UEA.
  if (nativeValueForGas > EVM_NATIVE_VALUE_SAFETY_CAP) {
    printLog(ctx,
      `executeUoaToCea — capping nativeValueForGas at 200 UPC ceiling (was ${nativeValueForGas.toString()})`
    );
    nativeValueForGas = EVM_NATIVE_VALUE_SAFETY_CAP;
  }

  // Pre-flight: warns by default when UEA cannot cover (nativeValueForGas +
  // gasReserve) or the PRC-20 burn amount; throws only when
  // options.enforceGasCheck=true. PRC-20 check fires whenever
  // burnAmount > 0 — user must pre-hold the burn token, even when it equals
  // the gas token (the gateway does transferFrom BEFORE the gas swap).
  let prc20BalanceR2Evm: bigint | undefined;
  if (burnAmount > BigInt(0)) {
    prc20BalanceR2Evm = await ctx.pushClient.readContract<bigint>({
      address: prc20Token,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [ueaAddress],
    });
  }
  const requiredNativeBalanceR2Evm = getRequiredNativeBalanceForOutbound(
    nativeValueForGas,
    EVM_GAS_RESERVE
  );
  const skipFeeLockingR2Evm = shouldSkipFeeLockingForOutbound({
    isUEADeployed,
    balance: effectiveBalance,
    nativeValueForGas,
    gasReserve: EVM_GAS_RESERVE,
  });

  runPreflight({
    ctx,
    ueaAddress,
    ueaBalance: effectiveBalance,
    requiredValue: nativeValueForGas,
    gasReserve: EVM_GAS_RESERVE,
    pathTag: 'R2_EVM',
    burnToken: prc20Token,
    burnAmount,
    prc20Balance: prc20BalanceR2Evm,
    enforceGasCheck: params.options?.enforceGasCheck === true,
  });
  // Preflight success means nativeValueForGas already covers required + reserve; no adjust needed.

  // Build outbound multicalls (approve burn + sendUniversalTxOutbound with native value)
  const outboundMulticalls = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });
  pushChainMulticalls.push(...outboundMulticalls);

  printLog(
    ctx,
    `executeUoaToCea — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // Execute through the normal execute() flow
  // This handles fee-locking on origin chain and executes the multicall from UEA context
  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  const executeParams: ExecuteParams = {
    to: ueaAddress, // multicall executes from UEA
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls, // array triggers multicall mode
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: skipFeeLockingR2Evm,
    _requiredFundsOverride: requiredNativeBalanceR2Evm,
    // Ensure fee-locking deposits enough for the outbound swap whenever it is needed.
    ...(!skipFeeLockingR2Evm ? { _minimumDepositUsd: ROUTE2_MINIMUM_DEPOSIT_USD } : {}),
  };

  // Signature request — user is prompted to sign the universal payload.
  // executeFn is monolithic (sign → broadcast), so we emit the logical
  // post-sign / pre-broadcast markers as a burst after it returns so
  // consumers see the spec-ordered stream: 204-01 → 204-02 → 204-03 → 207.
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_204_04,
      err instanceof Error ? err.message : String(err)
    );
    // Suppress the outer orchestrator catch's 299-02 terminal — 204-04
    // already surfaced the signature/broadcast failure to the consumer.
    ctx._routeTerminalEmitted = true;
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_03);
  // R2 broadcast marker — Push Chain tx has been built, signed, and
  // accepted by the node. Replaces the suppressed 107 emission for this route.
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_207, targetChain);

  // Add chain info to response
  response.chain = targetChain;
  response.chainNamespace = getChainNamespace(targetChain);

  return response;
}

// ---------------------------------------------------------------------------
// executeUoaToCeaSvm  (Route 2 — SVM)
// ---------------------------------------------------------------------------

/**
 * Route 2 for SVM targets: Outbound from Push Chain to Solana.
 *
 * Three cases:
 * 1. Withdraw SOL: Burn pSOL on Push Chain, recipient gets native SOL
 * 2. Withdraw SPL: Burn PRC-20 on Push Chain, recipient gets SPL token
 * 3. Execute (CPI): Burn pSOL + execute CPI on target Solana program
 */
export async function executeUoaToCeaSvm(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  target: ChainTarget,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  const targetChain = target.chain;
  const targetAddress = target.address; // 0x-prefixed, 32 bytes
  const ueaAddress = computeUEAOffchain(ctx);

  // R2 pre-broadcast progress (SVM) — external chain detected
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_201, targetChain, targetAddress);

  const {
    svmPayload,
    targetBytes,
    hasExecute: hasSvmExecute,
  } = buildSvmPayloadFromParams({
    data: params.data,
    to: target,
    senderUea: ueaAddress,
  });

  printLog(
    ctx,
    `executeUoaToCeaSvm — target: ${targetAddress}, chain: ${targetChain}, ` +
      `hasSvmExecute: ${hasSvmExecute}, value: ${params.value?.toString() ?? '0'}`
  );

  if (hasSvmExecute) {
    printLog(
      ctx,
      `executeUoaToCeaSvm — encoded execute payload: ${
        (svmPayload.length - 2) / 2
      } bytes`
    );
  }
  assertSvmPayloadWithinRelayLimit(svmPayload, `Route 2 SVM ${targetChain}`);

  // --- Determine PRC-20 token and burn amount (chain-local, pre-203) ---
  const { prc20Token, burnAmount } = resolveR2Prc20TokenSvm(
    params,
    targetChain,
    ctx.pushNetwork,
    hasSvmExecute
  );
  if (params.value && params.value > BigInt(0)) {
    printLog(
      ctx,
      `executeUoaToCeaSvm — auto-selected native PRC-20 ${prc20Token} for chain ${targetChain}, amount: ${burnAmount.toString()}`
    );
  } else if (!params.funds?.amount && hasSvmExecute) {
    printLog(
      ctx,
      `executeUoaToCeaSvm — EXECUTE-only: using PRC-20 ${prc20Token} with zero burn amount`
    );
  }

  // --- 202: Gas estimation (spec-ordered before 203) ---
  let gasFee = BigInt(0);
  let protocolFeeSvm = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let universalCoreAddress: `0x${string}` | undefined;
  // Effective gas limit seeded from the user param. When the user omits
  // gasLimit, it'll be derived from the gas quote so the on-chain record
  // carries a non-zero compute budget the relay can use.
  let effectiveGasLimit = params.gasLimit ?? BigInt(0);

  // SVM finalize budget: the Solana gateway requires gas_fee to cover the
  // relayer signature fee, ExecutedSubTx rent, a compute buffer, and
  // conditionally CEA ATA rent for SPL outbounds. The on-chain quote can be
  // below that floor, so we compare the quoted fee in lamports and re-query
  // with a bumped gasLimit when required.
  const svmFundsToken =
    burnAmount > BigInt(0)
      ? (params.funds as { token?: MoveableToken } | undefined)?.token
      : undefined;
  const splMintBase58 =
    svmFundsToken?.mechanism === 'approve' ? svmFundsToken.address : undefined;

  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_202_01, targetChain);
    try {
      let result = await queryOutboundGasFee(ctx, prc20Token, effectiveGasLimit, targetChain);
      result = await ensureSvmFinalizeGasBudgetQuote({
        ctx,
        ueaAddress,
        targetChain,
        prc20Token,
        quote: result,
        splMintBase58,
        burnAmount,
        pathTag: 'executeUoaToCeaSvm',
      });
      gasFee = result.gasFee;
      protocolFeeSvm = result.protocolFee;
      gasToken = result.gasToken;
      universalCoreAddress = result.universalCoreAddress;
      // When user omits gasLimit (sent as 0), the contract computes fees using
      // its internal baseGasLimitByChainNamespace. But the relay reads the
      // stored gasLimit from the outbound record. Store the resolved value from
      // UniversalCore so the relayer has a non-zero SVM budget.
      effectiveGasLimit = result.gasLimitUsed;
      if (!params.gasLimit) {
        printLog(
          ctx,
          `executeUoaToCeaSvm — resolved effectiveGasLimit: ${effectiveGasLimit} ` +
            `(gasFee=${result.gasFee}, gasPrice=${result.gasPrice})`
        );
      }
      printLog(
        ctx,
        `executeUoaToCeaSvm — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_202_02,
        targetChain,
        protocolFeeSvm,
        gasFee
      );
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee: ${err}`);
    }
  }

  // --- 203: Execution-account resolution (SVM has a trivial CEA — the
  // target address IS the CEA, no async lookup needed). Fire the burst
  // after 202 to keep the progress-hook stream in spec order. ---
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_203_01, targetChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_203_02,
    ueaAddress,
    targetAddress,
    targetChain,
    true
  );

  // --- Build outbound request ---
  // targetBytes: for execute = program id (resolver output); for withdraw = to.address
  const outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    targetBytes,
    prc20Token,
    burnAmount,
    effectiveGasLimit,
    svmPayload,
    ueaAddress, // revert recipient is the UEA
    params.maxPCForGas ?? BigInt(0)
  );

  printLog(
    ctx,
    `executeUoaToCeaSvm — outbound request: ${JSON.stringify(
      {
        recipient: outboundReq.recipient,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        maxPCForGas: outboundReq.maxPCForGas.toString(),
        payloadLength: (outboundReq.payload.length - 2) / 2,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // --- Pre-fetch UEA status — balance is needed for gas value calculation ---
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const signerChainSvm = ctx.universalSigner.account.chain;
  const isNativePushEOASvm = isPushChain(signerChainSvm);
  // Skip getCode if accountStatusCache already confirmed deployment
  const deployedHintSvm = ctx.accountStatusCache?.uea?.deployed;
  let ueaBalance: bigint;
  let isUEADeployed: boolean;
  if (deployedHintSvm || isNativePushEOASvm) {
    isUEADeployed = true;
    ueaBalance = await ctx.pushClient.getBalance(ueaAddress);
  } else {
    const [ueaCode, balance] = await Promise.all([
      ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
      ctx.pushClient.getBalance(ueaAddress),
    ]);
    isUEADeployed = ueaCode !== undefined;
    ueaBalance = balance;
  }
  const ueaNonce = (!isUEADeployed || isNativePushEOASvm) ? BigInt(0) : await getUEANonce(ctx, ueaAddress);

  // R2 does NOT use Case A/B/C gas abstraction (scoped to R1 + R3 only).
  // Size msg.value from the live WPC/gasToken Uniswap V3 pool quote. The
  // 2.2x safety buffer is applied inside estimateNativeValueForSwap (was
  // split as inner 2x + outer 10% — combined to keep the cap branch
  // mathematically correct). swapAndBurnGas refunds the excess as PC via
  // refundUnusedGas.
  //
  // SVM pools (WPC/pSOL) are thinner than EVM pools so the pool-quote can
  // easily exceed the UEA's balance. Pre-flight (`runPreflight`) handles
  // drain protection: an under-funded quote throws cleanly with
  // `InsufficientUEABalanceError` and no cosmos tx is submitted. The
  // SVM_NATIVE_VALUE_WARN_THRESHOLD below is telemetry-only; it does NOT
  // truncate `nativeValueForGas`. v2 may add a hard cap once telemetry
  // justifies a number — until then the original engineer's pool-skew
  // warning still applies (capping risks false-positive truncation of
  // legitimate quotes).
  const SVM_GAS_RESERVE = BigInt(3e18); // 3 UPC for outer-tx gas

  let nativeValueForGas = BigInt(0);
  if (universalCoreAddress && gasFee > BigInt(0)) {
    // 2.2x safety buffer is applied inside estimateNativeValueForSwap so
    // the function's balance-cap branch bounds the final value correctly.
    nativeValueForGas = await estimateNativeValueForSwap(
      ctx, universalCoreAddress, gasToken, gasFee, ueaBalance
    );
    printLog(
      ctx,
      `executeUoaToCeaSvm — nativeValueForGas=${nativeValueForGas.toString()} (includes 2.2x buffer)`
    );
    maybeFireSvmWarnThreshold(ctx, nativeValueForGas, gasToken, 'R2_SVM');
  }

  // Pre-flight: warns by default when UEA cannot cover (nativeValueForGas +
  // SVM_GAS_RESERVE) or the PRC-20 burn amount; throws only when
  // options.enforceGasCheck=true.
  // PRC-20 burn-balance pre-check fires whenever `burnAmount > 0`, regardless
  // of whether `prc20Token` happens to equal `gasToken`. The gateway's
  // `sendUniversalTxOutbound` does `transferFrom(user, gateway, burnAmount)`
  // BEFORE the gas swap, so user must pre-hold `burnAmount` of `prc20Token`
  // even when it's the same asset as the gas token (verified empirically:
  // EOA with 77k units of pSOL reverted on-chain when trying to burn 10M).
  let prc20BalanceR2Svm: bigint | undefined;
  if (burnAmount > BigInt(0)) {
    prc20BalanceR2Svm = await ctx.pushClient.readContract<bigint>({
      address: prc20Token,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [ueaAddress],
    });
  }
  const requiredNativeBalanceR2Svm = getRequiredNativeBalanceForOutbound(
    nativeValueForGas,
    SVM_GAS_RESERVE
  );
  const skipFeeLockingR2Svm = shouldSkipFeeLockingForOutbound({
    isUEADeployed,
    balance: ueaBalance,
    nativeValueForGas,
    gasReserve: SVM_GAS_RESERVE,
  });

  runPreflight({
    ctx,
    ueaAddress,
    ueaBalance,
    requiredValue: nativeValueForGas,
    gasReserve: SVM_GAS_RESERVE,
    pathTag: 'R2_SVM',
    burnToken: prc20Token,
    burnAmount,
    prc20Balance: prc20BalanceR2Svm,
    enforceGasCheck: params.options?.enforceGasCheck === true,
  });

  // --- Build Push Chain multicalls (approve + sendUniversalTxOutbound) ---
  // Reuse the same builder as EVM — this part is identical
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  printLog(
    ctx,
    `executeUoaToCeaSvm — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: skipFeeLockingR2Svm,
    _requiredFundsOverride: requiredNativeBalanceR2Svm,
  };

  // Signature request — user is prompted to sign the universal payload.
  // Emit spec-ordered burst after executeFn returns (sign → verify → broadcast).
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_204_04,
      err instanceof Error ? err.message : String(err)
    );
    // Suppress the outer orchestrator catch's 299-02 terminal.
    ctx._routeTerminalEmitted = true;
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_204_03);
  // R2 broadcast marker (SVM)
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_207, targetChain);

  // Add chain info to response
  response.chain = targetChain;
  response.chainNamespace = getChainNamespace(targetChain);

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToPush  (Route 3 — EVM)
// ---------------------------------------------------------------------------

/**
 * Route 3: Execute inbound transaction from CEA to Push Chain.
 *
 * This route instructs CEA on an external chain to call sendUniversalTxFromCEA,
 * bridging funds/payloads back to Push Chain.
 *
 * Flow:
 * 1. Build multicall for CEA: [approve Gateway (if ERC20), sendUniversalTxFromCEA]
 * 2. Execute via Route 2 (UOA -> CEA) with PAYLOAD-only (CEA uses its own funds)
 * 3. CEA executes multicall, Gateway locks funds, relayer mints PRC-20 on Push Chain
 */
export async function executeCeaToPush(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  // 1. Validate and extract source chain
  if (!params.from?.chain) {
    throw new Error('Route 3 (CEA -> Push) requires from.chain to specify the source CEA chain');
  }
  const sourceChain = params.from.chain;

  // SVM chains use a fundamentally different flow (gateway self-call, not CEA multicall)
  if (isSvmChain(sourceChain)) {
    return executeCeaToPushSvm(ctx, params, sourceChain, executeFn);
  }

  // 2. Extract destination on Push Chain
  // For Route 3, 'to' is a Push Chain address (string), not a ChainTarget
  const pushDestination = params.to as `0x${string}`;
  if (typeof params.to !== 'string') {
    throw new Error('Route 3 (CEA -> Push): to must be a Push Chain address (string), not a ChainTarget');
  }

  // 3. Get UEA address (will be recipient on Push Chain from CEA's perspective)
  // 4. Get CEA address on source chain
  // Both happen before the 301 hook fires — wrap them so a pre-sign RPC
  // failure produces a descriptive message in the subsequent 399-02 body
  // instead of a bare "failed to fetch" surface.
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let ceaDeployed: boolean;
  try {
    ueaAddress = computeUEAOffchain(ctx);
    const ceaResult = await getCEAAddress(
      ueaAddress,
      sourceChain,
      ctx.rpcUrls[sourceChain]?.[0]
    );
    ceaAddress = ceaResult.cea as `0x${string}`;
    ceaDeployed = ceaResult.isDeployed;
  } catch (err) {
    throw new Error(
      `Route 3 setup failed: could not resolve CEA on ${sourceChain}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_301, sourceChain, ceaAddress);

  printLog(ctx, `executeCeaToPush — sourceChain: ${sourceChain}, CEA: ${ceaAddress}, deployed: ${ceaDeployed}`);

  // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
  // if CEA doesn't exist yet. No SDK-side blocking needed.

  // 6. Build multicall for CEA to execute on source chain (self-calls via sendUniversalTxToUEA)
  const ceaMulticalls: MultiCall[] = [];

  // Determine token and amount for sendUniversalTxToUEA
  let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let amount = BigInt(0);

  if (params.funds?.amount) {
    // ERC20 token transfer from CEA
    const token = (params.funds as { token: MoveableToken }).token;
    if (token) {
      if (token.mechanism === 'native') {
        // Native token (e.g., BNB on BSC)
        tokenAddress = ZERO_ADDRESS as `0x${string}`;
        amount = params.funds.amount;
      } else {
        // ERC20 token. CEA handles gateway approval internally around sendUniversalTxToUEA.
        tokenAddress = token.address as `0x${string}`;
        amount = params.funds.amount;
      }
    }
  } else if (params.value && params.value > BigInt(0)) {
    // Native value transfer (e.g., BNB, ETH)
    tokenAddress = ZERO_ADDRESS as `0x${string}`;
    amount = params.value;
  }

  // bridgeAmount = only the burn amount (what the Vault will actually deposit to CEA).
  // Previously this included ceaExistingBalance (CEA's pre-existing balance on the
  // external chain), but that approach is racy: the balance can change between the SDK
  // query and relay execution, causing sendUniversalTxToUEA to revert with
  // InsufficientBalance. Pre-existing CEA funds remain parked and can be swept separately.
  const bridgeAmount = amount;
  // The post-audit CEA allows amount=0 for payload-only sendUniversalTxToUEA.

  // Pre-fetch UEA nonce — needed for the inbound UniversalPayload struct
  // Skip getCode if accountStatusCache already confirmed deployment
  let isUEADeployed: boolean;
  let ueaNonce: bigint;
  const isNativePushEOAR3 = isPushChain(ctx.universalSigner.account.chain);
  const deployedHintR3 = ctx.accountStatusCache?.uea?.deployed;
  if (isNativePushEOAR3) {
    // Native Push accounts execute directly as EOAs. EIP-7702 delegation code
    // is not a UEA proxy and its executor does not expose the UEA nonce ABI.
    // Treat the execution account as ready while using no UEA nonce.
    isUEADeployed = true;
    ueaNonce = BigInt(0);
  } else if (deployedHintR3) {
    isUEADeployed = true;
    ueaNonce = await getUEANonce(ctx, ueaAddress);
  } else {
    const ueaCode = await ctx.pushClient.publicClient.getCode({
      address: ueaAddress,
    });
    isUEADeployed = ueaCode !== undefined;
    ueaNonce = isUEADeployed ? await getUEANonce(ctx, ueaAddress) : BigInt(0);
  }

  // Build payload for Push Chain execution (if any)
  // This is what happens AFTER funds arrive on Push Chain.
  // The relay expects a full UniversalPayload struct (to, value, data, gasLimit, ...),
  // where `data` contains the multicall payload (with UEA_MULTICALL_SELECTOR prefix).
  let pushPayload: `0x${string}` = '0x';
  if (
    hasExecutablePayloadData(params.data) ||
    (params.funds?.amount && (params.value ?? BigInt(0)) > BigInt(0))
  ) {
    const multicallData = buildExecuteMulticall({
      execute: {
        to: pushDestination,
        value: params.value,
        data: params.data,
      },
      ueaAddress,
      allowSelfValueCall: true,
    });
    const multicallPayload = buildMulticallPayloadData(ctx, pushDestination, multicallData);
    // Use ueaNonce + 1: the outbound tx itself consumes one nonce via execute(),
    // so the inbound will arrive when the UEA nonce is already incremented.
    pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonce + BigInt(1) });
  }

  // Build sendUniversalTxToUEA self-call on CEA. CEA self-calls must always
  // use value=0; native sends spend from the CEA's existing balance.
  // CEA internally calls gateway.sendUniversalTxFromCEA(...)
  // Uses bridgeAmount (= burn amount deposited by Vault)
  const sendUniversalTxCall = buildSendUniversalTxToUEA(
    ceaAddress,     // to: CEA address (self-call)
    tokenAddress,   // token: address(0) for native, ERC20 address otherwise
    bridgeAmount,   // amount: burn amount only (Vault-deposited)
    pushPayload,    // payload: Push Chain execution payload
    ueaAddress      // revertRecipient: UEA on Push Chain (receives refund if inbound fails)
  );
  ceaMulticalls.push(sendUniversalTxCall);

  // 7. Encode CEA multicalls into outbound payload
  // CEA will self-execute this multicall (to=CEA, value=0)
  const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

  printLog(
    ctx,
    `executeCeaToPush — CEA payload (first 100 chars): ${ceaPayload.slice(0, 100)}...`
  );

  // 8. Determine PRC-20 token for the outbound relay.
  // Route 3: ALWAYS use native PRC-20 for chain namespace lookup + gas fees.
  // The CEA uses its OWN pre-existing balance on the external chain to bridge
  // tokens back — no PRC-20 burn is needed on Push Chain.
  // burnAmount = 0 makes this a payload-only outbound relay.
  //
  // Previously this burned pUSDT/pToken equal to the bridge amount, which failed
  // because the UEA never holds pUSDT — the whole point of Route 3 is to get
  // tokens FROM the CEA back to Push Chain, not to round-trip them.
  const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
  const burnAmount = BigInt(0);
  const outboundGasLimit =
    params.gasLimit ?? DEFAULT_CEA_TO_PUSH_GAS_LIMIT;

  printLog(
    ctx,
    `executeCeaToPush — prc20Token: ${prc20Token}, burnAmount: ${burnAmount.toString()}`
  );

  // 9. Build outbound request (same structure as Route 2)
  // recipient = CEA address (for self-execution), value = 0 in payload
  let outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    ceaAddress,              // recipient: CEA address (to=CEA for self-execution)
    prc20Token,              // token: native PRC-20 for source chain (for namespace lookup)
    burnAmount,              // amount: 0 (payload-only, CEA uses its own balance)
    outboundGasLimit,
    ceaPayload,              // payload: ABI-encoded CEA multicall
    ueaAddress,              // revertRecipient: UEA
    params.maxPCForGas ?? BigInt(0)
  );

  printLog(
    ctx,
    `executeCeaToPush — outbound request: ${JSON.stringify(
      {
        recipient: outboundReq.recipient,
        token: outboundReq.token,
        amount: outboundReq.amount.toString(),
        gasLimit: outboundReq.gasLimit.toString(),
        maxPCForGas: outboundReq.maxPCForGas.toString(),
        payloadLength: outboundReq.payload.length,
        revertRecipient: outboundReq.revertRecipient,
      },
      null,
      2
    )}`
  );

  // 10. Fetch UEA balance — needed for gas value calculation
  // (UEA code + nonce already fetched above for the inbound UniversalPayload)
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const ueaBalance = await ctx.pushClient.getBalance(ueaAddress);

  // 11. Query gas fees from UniversalCore
  let gasFee = BigInt(0);
  let protocolFeeR3 = BigInt(0);
  let nativeValueForGas = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let sizingDecisionR3: GasSizingDecision | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_302_01, sourceChain);
    try {
      const result = await queryOutboundGasFee(ctx, prc20Token, outboundGasLimit, sourceChain);
      gasToken = result.gasToken;
      gasFee = result.gasFee;
      protocolFeeR3 = result.protocolFee;
      nativeValueForGas = result.nativeValueForGas;
      sizingDecisionR3 = result.sizing;
      outboundReq = buildOutboundRequest(
        ceaAddress,
        prc20Token,
        burnAmount,
        outboundGasLimit,
        ceaPayload,
        ueaAddress,
        params.maxPCForGas ?? BigInt(0)
      );
      printLog(
        ctx,
        `executeCeaToPush — queried gas fee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}, sizing=${result.sizing?.category ?? 'legacy'}`
      );
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_302_02,
        sourceChain,
        protocolFeeR3,
        gasFee
      );
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee for Route 3: ${err}`);
    }
  }

  // Account-resolution checkpoint fires before the gas-sizing sub-hook so
  // consumers see the full account-resolution phase (303-xx) complete before
  // the sizing decision is surfaced.
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_303_01, sourceChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_303_02,
    ueaAddress,
    ceaAddress,
    sourceChain
  );

  if (sizingDecisionR3) {
    fireSizingHook(ctx, 'R3', sourceChain, sizingDecisionR3);
  }

  // R3 Case C: unlike R2, R3 has no destination funds-delivery semantic
  // (CEA self-executes and bridges funds BACK to Push Chain). When the
  // sizer returns Case C, we simply top up msg.value with the overflow so
  // `swapAndBurnGas` can afford the full gas cost on destination. No
  // bridge-swap entries, no fold-in — contract refunds any excess.
  if (
    sizingDecisionR3?.category === 'C' &&
    sizingDecisionR3.overflowNativePc > BigInt(0)
  ) {
    const bumped = nativeValueForGas + sizingDecisionR3.overflowNativePc;
    printLog(
      ctx,
      `executeCeaToPush — Case C: bumping nativeValueForGas from ${nativeValueForGas} to ${bumped} (overflow=${sizingDecisionR3.overflowNativePc})`
    );
    nativeValueForGas = bumped;
  }

  // Adjust nativeValueForGas using UEA balance (contract refunds excess)
  // Reuse ueaBalance from line 978 — no tx sent between, balance is stable
  const currentBalance = ueaBalance;
  // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
  const OUTBOUND_GAS_RESERVE_R3 = BigInt(3e18);
  const ROUTE3_MINIMUM_DEPOSIT_USD = Utils.helpers.parseUnits('10', 8); // $10

  // For fresh wallets: predict post-fee-locking UPC balance using the same
  // Uniswap V3 quoter the chain uses (pETH → WPC swap), matching Route 2 logic.
  let effectiveBalance = currentBalance;
  if (!isUEADeployed && effectiveBalance <= OUTBOUND_GAS_RESERVE_R3) {
    const signerChain = ctx.universalSigner.account.chain;
    const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(signerChain);
    const nativeAmountETH = ethPrice > BigInt(0)
      ? (ROUTE3_MINIMUM_DEPOSIT_USD * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1)
      : BigInt(0);

    if (nativeAmountETH > BigInt(0)) {
      const originPrc20 = getNativePRC20ForChain(signerChain, ctx.pushNetwork);
      const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);
      if (predictedUPC > BigInt(0)) {
        effectiveBalance = (predictedUPC * BigInt(90)) / BigInt(100);
        printLog(ctx,
          `executeCeaToPush — fresh wallet: Uniswap quote predicts ${predictedUPC.toString()} UPC ` +
          `from ${nativeAmountETH.toString()} wei pETH, using ${effectiveBalance.toString()} (90%)`
        );
      }
    }
  }

  // Balance-aware *upward* allocation. The previous behaviour silently
  // clamped to a 200 PC target whenever balance had headroom — which was
  // a downward clamp when the calibrated value already exceeded 200 PC,
  // masking under-funded swaps with opaque ExecutionFailed reverts. The
  // new logic preserves the "consume extra to reduce STF risk" intent for
  // small calibrated values while never reducing a calibrated value that
  // happened to land above 200 PC. Down-clamp + zero-balance throws live
  // in `runPreflight` below.
  const EVM_NATIVE_VALUE_TARGET_R3 = BigInt(200e18); // 200 UPC target floor
  if (effectiveBalance > EVM_NATIVE_VALUE_TARGET_R3 + OUTBOUND_GAS_RESERVE_R3) {
    // Balance can cover the target. Bump nativeValueForGas UP to 200 PC,
    // but never reduce a calibrated value already above 200.
    const newValue =
      nativeValueForGas > EVM_NATIVE_VALUE_TARGET_R3
        ? nativeValueForGas
        : EVM_NATIVE_VALUE_TARGET_R3;
    if (newValue !== nativeValueForGas) {
      printLog(
        ctx,
        `executeCeaToPush — adjusting nativeValueForGas UP from ${nativeValueForGas.toString()} to ${newValue.toString()} (EVM_NATIVE_VALUE_TARGET_R3 floor)`
      );
      nativeValueForGas = newValue;
    }
  }

  // Pre-flight (R3 EVM): no PRC-20 burn check — `burnAmount = 0` makes this
  // payload-only (UEA never holds the source-chain PRC-20; see plan §9 #4).
  // Native UPC check still applies for the gas swap. It warns by default and
  // throws only when options.enforceGasCheck=true.
  const requiredNativeBalanceR3Evm = getRequiredNativeBalanceForOutbound(
    nativeValueForGas,
    OUTBOUND_GAS_RESERVE_R3
  );
  const skipFeeLockingR3Evm = shouldSkipFeeLockingForOutbound({
    isUEADeployed,
    balance: effectiveBalance,
    nativeValueForGas,
    gasReserve: OUTBOUND_GAS_RESERVE_R3,
  });

  runPreflight({
    ctx,
    ueaAddress,
    ueaBalance: effectiveBalance,
    requiredValue: nativeValueForGas,
    gasReserve: OUTBOUND_GAS_RESERVE_R3,
    pathTag: 'R3_EVM',
    enforceGasCheck: params.options?.enforceGasCheck === true,
  });

  // 12. Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  printLog(
    ctx,
    `executeCeaToPush — Push Chain multicall has ${pushChainMulticalls.length} operations`
  );

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  // 13. Execute through the normal execute() flow
  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: ueaBalance,
    },
    _skipFeeLocking: skipFeeLockingR3Evm,
    _requiredFundsOverride: requiredNativeBalanceR3Evm,
    // Ensure fee-locking deposits enough for the outbound swap whenever it is needed.
    ...(!skipFeeLockingR3Evm ? { _minimumDepositUsd: ROUTE3_MINIMUM_DEPOSIT_USD } : {}),
  };

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_304_04,
      err instanceof Error ? err.message : String(err)
    );
    // Suppress the outer orchestrator catch's 399-02 terminal — 304-04
    // already surfaced the signature/broadcast failure to the consumer.
    ctx._routeTerminalEmitted = true;
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_03);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_307, sourceChain);

  // Add Route 3 context to response
  response.chain = sourceChain;
  const chainInfo = CHAIN_INFO[sourceChain];
  response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;
  // R3 inbound round-trip tracking: enable only when funds actually flow
  // back (amount > 0). Payload-only R3 has no child inbound UTX on Push
  // Chain, so polling would hang until timeout — skip the inbound block
  // for amount == 0.
  //
  // Child-utxId correlation uses the universal-tx-detector's deterministic
  // sha256(caip:txHash:logIndex) derivation (see inbound-tracker.ts
  // findChildUtxIdFromExternalTx), with the original cosmos
  // `universal_tx_created.inbound_tx_hash` search kept as a fallback.
  response._expectsInboundRoundTrip = amount > BigInt(0);

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToPushSvm  (Route 3 — SVM)
// ---------------------------------------------------------------------------

/**
 * Route 3 SVM: Execute CEA-to-Push for Solana chains.
 *
 * Unlike EVM Route 3 which builds CEA multicalls, SVM Route 3 encodes a
 * `send_universal_tx_to_uea` instruction as an execute payload targeting
 * the SVM gateway program (self-call). For funds-bearing calls the outbound
 * request amount must match the drain amount embedded in the instruction data.
 */
export async function executeCeaToPushSvm(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  sourceChain: CHAIN,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {
  if (typeof params.to !== 'string') {
    throw new Error('Route 3 SVM (CEA -> Push): to must be a Push Chain address (string), not a ChainTarget');
  }

  const ueaAddress = computeUEAOffchain(ctx);

  // Get gateway program ID from chain config and convert to 0x-hex 32 bytes
  const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
  if (!lockerContract) {
    throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
  }
  const programPk = new PublicKey(lockerContract);
  const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_301, sourceChain, lockerContract);

  printLog(ctx, `executeCeaToPushSvm — sourceChain: ${sourceChain}, gateway: ${lockerContract}`);

  // Route 3 SVM drains pre-existing funds from the Solana CEA. The Push-side
  // outbound is a payload relay; do not burn pSOL/pSPL from the UEA for the
  // drain amount.
  const { prc20Token, drainAmount, tokenMintHex } = resolveR3SvmDrain(
    params,
    sourceChain,
    ctx.pushNetwork
  );

  // Derive CEA PDA as revert recipient: ["push_identity", ueaAddress_20_bytes]
  const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex'); // 20 bytes
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), ueaBytes],
    programPk
  );
  const ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

  // Pre-fetch UEA status before payload construction. The inbound
  // UniversalPayload must use the nonce after this outbound execution, because
  // the Push-side execute() below consumes one UEA nonce before the Solana
  // round-trip payload returns.
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const isNativePushEOAR3Svm = isPushChain(ctx.universalSigner.account.chain);
  let isUEADeployed: boolean;
  let ueaNonce: bigint;
  let ueaBalance: bigint;
  if (isNativePushEOAR3Svm) {
    isUEADeployed = true;
    ueaNonce = BigInt(0);
    ueaBalance = await ctx.pushClient.getBalance(ueaAddress);
  } else {
    const [ueaCode, balance] = await Promise.all([
      ctx.pushClient.publicClient.getCode({ address: ueaAddress }),
      ctx.pushClient.getBalance(ueaAddress),
    ]);
    isUEADeployed = ueaCode !== undefined;
    ueaNonce = isUEADeployed ? await getUEANonce(ctx, ueaAddress) : BigInt(0);
    ueaBalance = balance;
  }

  const svmPayload = encodeSvmCeaToUeaPayload({
    gatewayProgramHex,
    drainAmount,
    tokenMintHex,
    extraPayload: buildR3SvmExtraPayload(
      ctx,
      params,
      ueaAddress,
      sourceChain,
      ueaNonce + BigInt(1)
    ),
    revertRecipientHex: ceaPdaHex,
  });
  assertSvmPayloadWithinRelayLimit(
    svmPayload,
    `Route 3 SVM ${sourceChain}`
  );

  printLog(
    ctx,
    `executeCeaToPushSvm — drainAmount: ${drainAmount.toString()}, payload length: ${(svmPayload.length - 2) / 2} bytes`
  );

  const burnAmount = BigInt(0);

  let effectiveGasLimit = params.gasLimit ?? BigInt(0);

  // Build outbound request: recipient = gateway program (self-call)
  let outboundReq: UniversalOutboundTxRequest = buildOutboundRequest(
    gatewayProgramHex,
    prc20Token,
    burnAmount,
    effectiveGasLimit,
    svmPayload,
    ueaAddress,
    params.maxPCForGas ?? BigInt(0)
  );

  printLog(
    ctx,
    `executeCeaToPushSvm — outbound request: recipient=${outboundReq.recipient.slice(0, 20)}..., token=${outboundReq.token}, maxPCForGas=${outboundReq.maxPCForGas}`
  );

  // Query gas fees
  let gasFee = BigInt(0);
  let protocolFeeR3Svm = BigInt(0);
  let nativeValueForGas = BigInt(0);
  let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
  let sizingDecisionR3Svm: GasSizingDecision | undefined;
  if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_302_01, sourceChain);
    try {
      let result = await queryOutboundGasFee(ctx, prc20Token, outboundReq.gasLimit, sourceChain);
      result = await ensureSvmFinalizeGasBudgetQuote({
        ctx,
        ueaAddress,
        targetChain: sourceChain,
        prc20Token,
        quote: result,
        splMintBase58: undefined,
        burnAmount,
        pathTag: 'executeCeaToPushSvm',
      });
      gasToken = result.gasToken;
      gasFee = result.gasFee;
      protocolFeeR3Svm = result.protocolFee;
      nativeValueForGas = result.nativeValueForGas;
      sizingDecisionR3Svm = result.sizing;
      effectiveGasLimit = result.gasLimitUsed;
      outboundReq = buildOutboundRequest(
        gatewayProgramHex,
        prc20Token,
        burnAmount,
        effectiveGasLimit,
        svmPayload,
        ueaAddress,
        params.maxPCForGas ?? BigInt(0)
      );
      printLog(
        ctx,
        `executeCeaToPushSvm — resolved effectiveGasLimit: ${effectiveGasLimit} ` +
          `(gasFee=${result.gasFee}, gasPrice=${result.gasPrice})`
      );
      printLog(ctx, `executeCeaToPushSvm — gasFee: ${gasFee.toString()}, gasToken: ${gasToken}, nativeValueForGas: ${nativeValueForGas.toString()}, sizing=${result.sizing?.category ?? 'legacy'}`);
      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_302_02,
        sourceChain,
        protocolFeeR3Svm,
        gasFee
      );
    } catch (err) {
      throw new Error(`Failed to query outbound gas fee for SVM Route 3: ${err}`);
    }
  }

  // Account-resolution checkpoint fires before the gas-sizing sub-hook so
  // consumers see the full account-resolution phase (303-xx) complete before
  // the sizing decision is surfaced.
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_303_01, sourceChain);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_303_02,
    ueaAddress,
    lockerContract,
    sourceChain
  );

  if (sizingDecisionR3Svm) {
    fireSizingHook(ctx, 'R3', sourceChain, sizingDecisionR3Svm);
  }

  // R3 SVM Case C: same minimal interpretation as R3 EVM — bump msg.value
  // by the overflow so swapAndBurnGas can afford the full gas cost. No
  // bridge-swap entries (R3 has no destination funds-delivery semantic).
  if (
    sizingDecisionR3Svm?.category === 'C' &&
    sizingDecisionR3Svm.overflowNativePc > BigInt(0)
  ) {
    const bumped = nativeValueForGas + sizingDecisionR3Svm.overflowNativePc;
    printLog(
      ctx,
      `executeCeaToPushSvm — Case C: bumping nativeValueForGas from ${nativeValueForGas} to ${bumped} (overflow=${sizingDecisionR3Svm.overflowNativePc})`
    );
    nativeValueForGas = bumped;
  }

  // Re-fetch balance to minimize staleness from gas fee query RPC roundtrips.
  const currentBalance = await ctx.pushClient.getBalance(ueaAddress);
  // Cosmos-EVM tx overhead costs ~1 PC per operation; 3 PC covers approve(s) + buffer.
  const OUTBOUND_GAS_RESERVE_R3_SVM = BigInt(3e18);
  // Upward-allocation ceiling: cap the upward adjust at max(200 PC, 5x calibrated)
  // so a UEA with a giant balance doesn't submit msg.value=balance for a small
  // gas swap. The contract refunds excess via swapAndBurnGas, but pushing
  // hundreds of thousands of PC into a Uniswap pool moves the price for other
  // users. 200 PC mirrors EVM's safety cap; 5x calibrated covers pool-skew
  // scenarios where the calibrated value itself is > 40 PC (5x40 = 200).
  const UPWARD_BASE_CEILING_R3_SVM = BigInt(200) * BigInt(1e18);
  const calibratedCeiling = nativeValueForGas * BigInt(5);
  const upwardCeiling =
    calibratedCeiling > UPWARD_BASE_CEILING_R3_SVM
      ? calibratedCeiling
      : UPWARD_BASE_CEILING_R3_SVM;

  // Upward-only allocation: when balance has headroom over the calibrated
  // value, consume more of it (up to the ceiling above). Down-clamp +
  // zero-balance handling lives in pre-flight.
  // Ordering note: pre-flight runs AFTER the upward adjust below; the
  // semantics are equivalent to running it before — when upward adjust
  // applies it sets nativeValueForGas to balance-reserve (capped), and the
  // post-adjust pre-flight check is always satisfied. When upward adjust is
  // skipped (balance too low), pre-flight runs against the calibrated value
  // and either warns or throws based on options.enforceGasCheck.
  if (
    currentBalance > OUTBOUND_GAS_RESERVE_R3_SVM &&
    currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM > nativeValueForGas
  ) {
    const balanceDriven = currentBalance - OUTBOUND_GAS_RESERVE_R3_SVM;
    const adjustedValue =
      balanceDriven > upwardCeiling ? upwardCeiling : balanceDriven;
    if (adjustedValue !== nativeValueForGas) {
      printLog(
        ctx,
        `executeCeaToPushSvm — adjusting nativeValueForGas from ${nativeValueForGas.toString()} to ${adjustedValue.toString()} ` +
          `(UEA balance: ${currentBalance.toString()}, upwardCeiling: ${upwardCeiling.toString()})`
      );
      nativeValueForGas = adjustedValue;
    }
  }

  // SVM warn-threshold telemetry (no truncation — pre-flight handles drain protection).
  maybeFireSvmWarnThreshold(ctx, nativeValueForGas, gasToken, 'R3_SVM');

  const requiredNativeBalanceR3Svm = getRequiredNativeBalanceForOutbound(
    nativeValueForGas,
    OUTBOUND_GAS_RESERVE_R3_SVM
  );
  const skipFeeLockingR3Svm = shouldSkipFeeLockingForOutbound({
    isUEADeployed,
    balance: currentBalance,
    nativeValueForGas,
    gasReserve: OUTBOUND_GAS_RESERVE_R3_SVM,
  });

  // Pre-flight (R3 SVM): no PRC-20 burn check. The drain amount lives in the
  // embedded Solana instruction and is withdrawn from the external CEA.
  runPreflight({
    ctx,
    ueaAddress,
    ueaBalance: currentBalance,
    requiredValue: nativeValueForGas,
    gasReserve: OUTBOUND_GAS_RESERVE_R3_SVM,
    pathTag: 'R3_SVM',
    enforceGasCheck: params.options?.enforceGasCheck === true,
  });

  // Build Push Chain multicalls (approvals + sendUniversalTxOutbound)
  const pushChainMulticalls: MultiCall[] = buildOutboundApprovalAndCall({
    prc20Token,
    gasToken,
    burnAmount,
    gasFee,
    nativeValueForGas,
    gatewayPcAddress,
    outboundRequest: outboundReq,
  });

  // Sum native values from multicall entries for proper fee calculation
  const multicallNativeValue = pushChainMulticalls.reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );

  // Execute through the normal execute() flow
  const executeParams: ExecuteParams = {
    to: ueaAddress,
    value: multicallNativeValue, // ensures correct requiredFunds calculation
    data: pushChainMulticalls,
    _ueaStatus: {
      isDeployed: isUEADeployed,
      nonce: ueaNonce,
      balance: currentBalance,
    },
    _skipFeeLocking: skipFeeLockingR3Svm,
    _requiredFundsOverride: requiredNativeBalanceR3Svm,
    // Ensure fee-locking deposits enough for the outbound swap whenever it is needed.
    ...(!skipFeeLockingR3Svm ? { _minimumDepositUsd: Utils.helpers.parseUnits('10', 8) } : {}),
  };

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_01);
  let response: UniversalTxResponse;
  try {
    response = await executeFn(executeParams);
  } catch (err) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_304_04,
      err instanceof Error ? err.message : String(err)
    );
    // Suppress the outer orchestrator catch's 399-02 terminal.
    ctx._routeTerminalEmitted = true;
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_02);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_304_03);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_307, sourceChain);

  // Add Route 3 SVM context to response
  response.chain = sourceChain;
  const chainInfo = CHAIN_INFO[sourceChain];
  response.chainNamespace = `${VM_NAMESPACE[chainInfo.vm]}:${chainInfo.chainId}`;
  // R3 SVM mirrors EVM R3: when funds drain back to Push, the Solana-side
  // send_universal_tx_to_uea emits an inbound leg whose payload can execute on
  // Push. Payload-only R3 has no child inbound UTX, so skip round-trip tracking
  // when no amount is being drained.
  response._expectsInboundRoundTrip = drainAmount > BigInt(0);

  return response;
}

// ---------------------------------------------------------------------------
// executeCeaToCea  (Route 4 — stub)
// ---------------------------------------------------------------------------

/**
 * Route 4: Execute CEA to CEA transaction via Push Chain.
 */
export async function executeCeaToCea(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  executeFn: ExecuteFn
): Promise<UniversalTxResponse> {

  // CEA -> CEA requires chaining Route 3 (CEA -> Push) and Route 2 (Push -> CEA)
  // This is a complex flow that requires coordination
  throw new Error(
    'CEA -> CEA transactions are not yet fully implemented. ' +
      'Use prepareTransaction() and executeTransactions() to chain Route 3 -> Route 2 manually.'
  );
}

// ---------------------------------------------------------------------------
// buildPayloadForRoute
// ---------------------------------------------------------------------------

/**
 * Build payload for a specific route.
 */
export async function buildPayloadForRoute(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  route: TransactionRoute,
  nonce: bigint
): Promise<{
  payload: `0x${string}`;
  gatewayRequest: UniversalTxRequest | UniversalOutboundTxRequest;
}> {
  const ueaAddress = computeUEAOffchain(ctx);

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH: {
      // Build standard Push Chain payload
      const executeParams = toExecuteParams(params);
      const multicallData = buildExecuteMulticall({
        execute: executeParams,
        ueaAddress,
      });
      const payload = buildMulticallPayloadData(
        ctx,
        executeParams.to,
        multicallData
      );
      const req = buildUniversalTxRequest(
        ctx.universalSigner.account.address as `0x${string}`,
        {
          recipient: zeroAddress,
          token: zeroAddress,
          amount: BigInt(0),
          payload,
        }
      );
      return { payload, gatewayRequest: req };
    }

    case TransactionRoute.UOA_TO_CEA: {
      const target = params.to as ChainTarget;

      // Branch: SVM vs EVM
      if (isSvmChain(target.chain)) {
        // SVM: build SVM payload (binary or empty for withdraw) via IDL resolver
        const {
          svmPayload: payload,
          targetBytes,
          hasExecute,
        } = buildSvmPayloadFromParams({
          data: params.data,
          to: target,
          senderUea: ueaAddress,
        });
        assertSvmPayloadWithinRelayLimit(
          payload,
          `Route 2 SVM ${target.chain}`
        );

        let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let burnAmount = BigInt(0);
        if (params.funds?.amount) {
          const token = (params.funds as { token: MoveableToken }).token;
          if (token) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
            burnAmount = params.funds.amount;
          }
        } else if (params.value && params.value > BigInt(0)) {
          prc20Token = getNativePRC20ForChain(target.chain, ctx.pushNetwork);
          burnAmount = params.value;
        } else if (hasExecute) {
          prc20Token = getNativePRC20ForChain(target.chain, ctx.pushNetwork);
          burnAmount = BigInt(0);
        }

        const outboundReq = buildOutboundRequest(
          targetBytes,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          payload,
          ueaAddress,
          params.maxPCForGas ?? BigInt(0)
        );

        return { payload, gatewayRequest: outboundReq };
      }

      // EVM path: Resolve CEA address first (needed for self-transfer check)
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        target.chain,
        ctx.rpcUrls[target.chain]?.[0]
      );

      const payload = buildR2CeaPayloadEvm(
        params,
        ceaAddress,
        target.address as `0x${string}`,
        target.chain,
        ctx.pushNetwork
      );
      const { prc20Token, burnAmount } = resolveR2Prc20TokenEvm(
        params,
        target.chain,
        ctx.pushNetwork
      );

      const targetBytes = payload === '0x'
        ? (ZERO_ADDRESS as `0x${string}`)
        : ceaAddress;
      assertCeaFundsParkingInvariant(targetBytes, payload);

      const outboundReq = buildOutboundRequest(
        targetBytes,
        prc20Token,
        burnAmount,
        params.gasLimit ?? BigInt(0),
        payload,
        ueaAddress,
        params.maxPCForGas ?? BigInt(0)
      );

      return { payload, gatewayRequest: outboundReq };
    }

    case TransactionRoute.CEA_TO_PUSH: {
      // Route 3: CEA -> Push Chain
      // Build CEA multicall (sendUniversalTxToUEA self-call) and wrap in outbound
      if (!params.from?.chain) {
        throw new Error('Route 3 (CEA -> Push) requires from.chain');
      }
      const sourceChain = params.from.chain;
      const pushDestination = params.to as `0x${string}`;

      // SVM chains use gateway self-call, not CEA multicall
      if (isSvmChain(sourceChain)) {
        const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
        if (!lockerContract) {
          throw new Error(`No SVM gateway program configured for chain ${sourceChain}`);
        }
        const programPk = new PublicKey(lockerContract);
        const gatewayProgramHex = ('0x' + Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

        const { prc20Token, drainAmount, tokenMintHex } = resolveR3SvmDrain(
          params,
          sourceChain,
          ctx.pushNetwork
        );

        // Derive CEA PDA as revert recipient
        const ueaBytes2 = Buffer.from(ueaAddress.slice(2), 'hex');
        const [ceaPda2] = PublicKey.findProgramAddressSync(
          [Buffer.from('push_identity'), ueaBytes2],
          programPk
        );
        const ceaPdaHex2 = ('0x' + Buffer.from(ceaPda2.toBytes()).toString('hex')) as `0x${string}`;

        const svmPayload = encodeSvmCeaToUeaPayload({
          gatewayProgramHex,
          drainAmount,
          tokenMintHex,
          extraPayload: buildR3SvmExtraPayload(
            ctx,
            params,
            ueaAddress,
            sourceChain,
            nonce + BigInt(1)
          ),
          revertRecipientHex: ceaPdaHex2,
        });
        assertSvmPayloadWithinRelayLimit(
          svmPayload,
          `Route 3 SVM ${sourceChain}`
        );

        // Payload-only outbound: drain amount lives inside ixData.
        const burnAmount = BigInt(0);
        const outboundReq = buildOutboundRequest(
          gatewayProgramHex,
          prc20Token,
          burnAmount,
          params.gasLimit ?? BigInt(0),
          svmPayload,
          ueaAddress,
          params.maxPCForGas ?? BigInt(0)
        );

        return { payload: svmPayload, gatewayRequest: outboundReq };
      }

      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        sourceChain,
        ctx.rpcUrls[sourceChain]?.[0]
      );

      // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
      // if CEA doesn't exist yet. No SDK-side blocking needed.

      // Build CEA multicalls (self-calls via sendUniversalTxToUEA)
      const ceaMulticalls: MultiCall[] = [];
      let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let amount = BigInt(0);

      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          if (token.mechanism === 'native') {
            tokenAddress = ZERO_ADDRESS as `0x${string}`;
            amount = params.funds.amount;
          } else {
            tokenAddress = token.address as `0x${string}`;
            amount = params.funds.amount;
          }
        }
      } else if (params.value && params.value > BigInt(0)) {
        tokenAddress = ZERO_ADDRESS as `0x${string}`;
        amount = params.value;
      }

      // prepareTransaction already resolved the correct nonce semantics. For a
      // native Push EOA this is zero; for an external-origin account it is the
      // current UEA nonce. Do not reclassify EIP-7702 code as a deployed UEA.
      const ueaNonceHop = nonce;

      // Build Push Chain payload (what executes after inbound arrives)
      // Wrap in UniversalPayload struct for the relay.
      let pushPayload: `0x${string}` = '0x';
      if (
        hasExecutablePayloadData(params.data) ||
        (params.funds?.amount && (params.value ?? BigInt(0)) > BigInt(0))
      ) {
        const multicallData = buildExecuteMulticall({
          execute: {
            to: pushDestination,
            value: params.value,
            data: params.data,
          },
          ueaAddress,
          allowSelfValueCall: true,
        });
        const multicallPayload = buildMulticallPayloadData(ctx, pushDestination, multicallData);
        pushPayload = buildInboundUniversalPayload(multicallPayload, { nonce: ueaNonceHop + BigInt(1) });
      }

      // Build sendUniversalTxToUEA self-call on CEA. CEA self-calls must
      // always use value=0; native sends spend from the CEA balance.
      const sendCall = buildSendUniversalTxToUEA(
        ceaAddress,
        tokenAddress,
        amount,
        pushPayload,
        ceaAddress
      );
      ceaMulticalls.push(sendCall);

      const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);
      const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
      // Route 3: CEA uses its own pre-existing balance — no PRC-20 burn needed.
      // burnAmount = 0 makes this a payload-only outbound relay.
      const burnAmount = BigInt(0);
      const outboundGasLimit =
        params.gasLimit ?? DEFAULT_CEA_TO_PUSH_GAS_LIMIT;

      const outboundReq = buildOutboundRequest(
        ceaAddress,
        prc20Token,
        burnAmount,
        outboundGasLimit,
        ceaPayload,
        ueaAddress,
        params.maxPCForGas ?? BigInt(0)
      );

      return { payload: ceaPayload, gatewayRequest: outboundReq };
    }

    default:
      throw new Error(`Cannot build payload for route: ${route}`);
  }
}
