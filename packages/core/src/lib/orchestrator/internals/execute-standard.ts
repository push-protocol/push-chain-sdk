import { assertLegacyFunds } from './pc20/gate';
/**
 * Standard payload execution flow (no funds) — extracted from Orchestrator.execute().
 *
 * Handles payload-only execution on Push Chain:
 * - Push-to-Push direct transactions
 * - Fee-locking path for undeployed/underfunded UEA
 * - Signed verification path for deployed UEA with funds
 */

import { bs58 } from '../../internal/bs58';
import { bytesToHex, zeroAddress } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { VM } from '../../constants/enums';
import {
  UniversalPayload,
  VerificationType,
} from '../../generated/v1/tx';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import {
  formatPc,
  normalizePublicErrorMessage,
} from '../../formatters';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import type {
  ExecuteParams,
  UniversalTxRequest,
  UniversalTxResponse,
} from '../orchestrator.types';
import { buildExecuteMulticall } from '../payload-builders';
import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import {
  isPushChain,
  validateMainnetConnection,
  validateFeeLockTxHash,
  bigintReplacer,
  fetchOriginChainTransactionForProgress,
} from './helpers';
import {
  buildUniversalTxRequest,
  buildMulticallPayloadData,
} from './payload-builder';
import { encodeUniversalPayload, encodeUniversalPayloadSvm, signUniversalPayload } from './signing';
import { classifyDeclineError } from '../../progress-hook/progress-hook';
import { computeUEAOffchain, getUEANonce, fetchUEAVersion } from './uea-manager';
import { waitForLockerFeeConfirmation } from './confirmation';
import { lockFee } from './gateway-client';
import {
  queryUniversalTxStatusFromGatewayTx,
  transformToUniversalTxResponse,
  type ResponseBuilderCallbacks,
} from './response-builder';
import {
  sendPushTx,
  sendUniversalTx,
  extractPcTxAndTransform,
  PushChainExecutionError,
} from './push-chain-tx';
import {
  estimateDepositFromLockedNative,
  estimateNativeForDesiredDeposit,
} from './gas-calculator';
import { getNativePRC20ForChain } from './helpers';
import { PriceFetch } from '../../price-fetch/price-fetch';

/**
 * Encode a UniversalPayload for transport over the origin chain's gateway.
 * - EVM origin → ABI encoding (chain decodes via DecodeUniversalPayloadEVM).
 * - SVM origin → Borsh encoding (chain decodes via DecodeUniversalPayloadSolana).
 *
 * The encoded bytes are placed in the Solana gateway's UniversalTx event
 * (or the EVM UniversalGateway's SendUniversalTx event) payload field. Push
 * Chain's uexecutor module decodes from that same field using the source
 * chain's namespace (see push-chain/x/uexecutor/types/decode_payload.go).
 * Using the wrong encoder for SVM origin results in garbage fields — in
 * particular gasLimit=0 — which surfaces as "intrinsic gas too low" when
 * the chain calls executeUniversalTx on the (possibly lazy-deployed) UEA.
 */
function encodePayloadForOrigin(
  ctx: OrchestratorContext,
  payload: UniversalPayload
): `0x${string}` {
  const { vm } = CHAIN_INFO[ctx.universalSigner.account.chain];
  if (vm === VM.SVM) {
    const buf = encodeUniversalPayloadSvm(payload);
    return ('0x' + buf.toString('hex')) as `0x${string}`;
  }
  return encodeUniversalPayload(payload);
}

/**
 * Lazy variant of `encodePayloadForOrigin`. The encoded bytes only ride to
 * the chain on the fee-locking branch (consumed by `lockFee` → origin
 * gateway → relayer → `DecodeUniversalPayloadSolana`). On the non-fee-
 * locking branch the bytes are placed into `req` but `req` is never sent —
 * `sendUniversalTx` ships the proto-struct UniversalPayload via
 * `MsgExecutePayload` instead.
 *
 * Skipping the encode on the non-fee-locking branch sidesteps the SVM
 * encoder's u64 ceiling for the R2 SVM outbound recursive seam (Slack
 * 2026-04-23 regression), which sets `execute.value = multicallNativeValue`
 * — a wei-scale UPC budget that routinely exceeds 2^64 on thin pSOL/WPC
 * pools. The chain decoder is u64-only, so we can't widen the wire format
 * without coordinated chain work; this skip is the SDK-only fix that
 * unblocks Riyanshu's case without changing the wire format.
 */
function encodePayloadForOriginIfNeeded(
  ctx: OrchestratorContext,
  payload: UniversalPayload,
  feeLockingRequired: boolean
): `0x${string}` {
  if (!feeLockingRequired) {
    return '0x';
  }
  return encodePayloadForOrigin(ctx, payload);
}

export function resolveRequiredFunds(
  requiredGasFee: bigint,
  executeValue: bigint,
  requiredFundsOverride?: bigint
): bigint {
  const baseRequiredFunds = requiredGasFee + executeValue;
  return requiredFundsOverride && requiredFundsOverride > baseRequiredFunds
    ? requiredFundsOverride
    : baseRequiredFunds;
}

export async function executeStandardPayload(
  ctx: OrchestratorContext,
  execute: ExecuteParams,
  eventBuffer: ProgressEvent[],
  getResponseCallbacks: () => ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const transformFn = (tx: TxResponse, buf: ProgressEvent[] = []) =>
    transformToUniversalTxResponse(ctx, tx, buf, getResponseCallbacks());

  // Set default value for value if undefined
  if (execute.value === undefined) {
    execute.value = BigInt(0);
  }

  const chain = ctx.universalSigner.account.chain;
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, chain, ctx.universalSigner.account.address);
  validateMainnetConnection(chain, ctx.pushClient.pushChainInfo.chainId);

  // Gas estimation fires for both Push-to-Push and external-origin flows so
  // reconstructProgressEvents (which always emits 102-01/02) and live execute
  // stay in lockstep. For the Push-to-Push shortcut we have no origin-chain
  // gas to estimate; surface the tx gas limit as the "cost" to match what
  // the reconstruction path does (it reads universalTxResponse.gasLimit).
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_01);

  // Push to Push Tx
  if (isPushChain(chain)) {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_103_03_04,
      execute.gasLimit ?? BigInt(21000),
      BigInt(0),
      chain
    );
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
    let tx: UniversalTxResponse;
    try {
      tx = await sendPushTx(ctx, execute, eventBuffer, transformFn);
    } catch (err) {
      // Push Chain broadcast failed. Wallet rejection surfaces as 104-04;
      // everything else (RPC fail, on-chain revert) as 199-02.
      const errMsg = normalizePublicErrorMessage(err);
      const { isUserDecline } = classifyDeclineError(errMsg);
      fireProgressHook(
        ctx,
        isUserDecline ? PROGRESS_HOOK.SEND_TX_104_04 : PROGRESS_HOOK.SEND_TX_199_02,
        errMsg
      );
      // Mark that a terminal-ish error hook has already fired so the
      // outer orchestrator catch doesn't emit a second 199-02 on top.
      ctx._routeTerminalEmitted = true;
      if (!isUserDecline && !(err instanceof PushChainExecutionError)) {
        throw new PushChainExecutionError(errMsg);
      }
      throw err;
    }
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [tx]);
    return tx;
  }

  // Fetch Gas details and estimate cost of execution
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasPrice = await ctx.pushClient.getGasPrice();
  const requiredGasFee = gasEstimate * gasPrice;
  const requiredFunds = resolveRequiredFunds(
    requiredGasFee,
    execute.value,
    execute._requiredFundsOverride
  );

  // Fetch UEA Details (or use pre-fetched status if available)
  const UEA = computeUEAOffchain(ctx);
  let isUEADeployed: boolean;
  let nonce: bigint;
  let funds: bigint;

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_01);
  if (execute._ueaStatus) {
    isUEADeployed = execute._ueaStatus.isDeployed;
    nonce = execute._ueaStatus.nonce;
    funds = execute._ueaStatus.balance;
  } else {
    // Skip getCode if accountStatusCache already confirmed deployment
    const deployedHint = ctx.accountStatusCache?.uea?.deployed;
    if (deployedHint) {
      const [balance, ueaNonce] = await Promise.all([
        ctx.pushClient.getBalance(UEA),
        getUEANonce(ctx, UEA),
      ]);
      isUEADeployed = true;
      nonce = ueaNonce;
      funds = balance;
    } else {
      const [code, balance] = await Promise.all([
        ctx.pushClient.publicClient.getCode({ address: UEA }),
        ctx.pushClient.getBalance(UEA),
      ]);
      isUEADeployed = code !== undefined;
      nonce = isUEADeployed ? await getUEANonce(ctx, UEA) : BigInt(0);
      funds = balance;
    }
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_02, UEA, isUEADeployed);
  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_103_03_04,
    requiredFunds,
    BigInt(0),
    chain
  );

  // Validate and decode feeLockTxHash
  let feeLockTxHash: string | undefined = execute.feeLockTxHash;
  if (feeLockTxHash) {
    validateFeeLockTxHash(feeLockTxHash);
    if (!feeLockTxHash.startsWith('0x')) {
      const decoded = bs58.decode(feeLockTxHash);
      feeLockTxHash = bytesToHex(new Uint8Array(decoded));
    }
  }

  const feeLockingRequired =
    !execute._skipFeeLocking &&
    (!isUEADeployed || funds < requiredFunds) && !feeLockTxHash;

  // Support multicall payload encoding when execute.data is an array
  let payloadData: `0x${string}`;
  let payloadTo: `0x${string}`;
  let req: UniversalTxRequest;

  if (Array.isArray(execute.data)) {
    payloadTo = zeroAddress;
    payloadData = buildMulticallPayloadData(
      ctx, execute.to, buildExecuteMulticall({ execute: assertLegacyFunds(execute), ueaAddress: UEA })
    );
    // Wrap in full UniversalPayload encoding for gateway req (matches non-array paths)
    const universalPayloadForReq = JSON.parse(
      JSON.stringify({
        to: zeroAddress, value: execute.value,
        data: payloadData,
        gasLimit: execute.gasLimit || BigInt(5e7),
        maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
        maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
        nonce, deadline: execute.deadline || BigInt(9999999999),
        vType: feeLockingRequired
          ? VerificationType.universalTxVerification
          : VerificationType.signedVerification,
      }, bigintReplacer)
    ) as UniversalPayload;
    req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
      recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
      payload: encodePayloadForOriginIfNeeded(ctx, universalPayloadForReq, feeLockingRequired),
    });
  } else {
    if (execute.to.toLowerCase() !== UEA.toLowerCase()) {
      if (execute.funds) {
        payloadTo = zeroAddress;
        payloadData = buildMulticallPayloadData(
          ctx, execute.to, buildExecuteMulticall({ execute: assertLegacyFunds(execute), ueaAddress: UEA })
        );
        req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
          recipient: zeroAddress, token: zeroAddress, amount: BigInt(0), payload: payloadData,
        });
      } else {
        payloadTo = execute.to;
        payloadData = execute.data || '0x';
        const reqData = buildMulticallPayloadData(
          ctx, execute.to, buildExecuteMulticall({ execute: assertLegacyFunds(execute), ueaAddress: UEA })
        );
        const universalPayloadOther = JSON.parse(
          JSON.stringify({
            to: zeroAddress, value: execute.value,
            data: reqData,
            gasLimit: execute.gasLimit || BigInt(5e7),
            maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
            maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
            nonce, deadline: execute.deadline || BigInt(9999999999),
            vType: feeLockingRequired
              ? VerificationType.universalTxVerification
              : VerificationType.signedVerification,
          }, bigintReplacer)
        ) as UniversalPayload;
        req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
          recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
          payload: encodePayloadForOriginIfNeeded(ctx, universalPayloadOther, feeLockingRequired),
        });
      }
    } else {
      payloadTo = execute.to;
      payloadData = execute.data || '0x';
      const reqData = buildMulticallPayloadData(
        ctx, execute.to, buildExecuteMulticall({ execute: assertLegacyFunds(execute), ueaAddress: UEA })
      );
      const universalPayloadSelf = JSON.parse(
        JSON.stringify({
          to: zeroAddress, value: execute.value,
          data: reqData,
          gasLimit: execute.gasLimit || BigInt(5e7),
          maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
          maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
          nonce, deadline: execute.deadline || BigInt(9999999999),
          vType: feeLockingRequired
            ? VerificationType.universalTxVerification
            : VerificationType.signedVerification,
        }, bigintReplacer)
      ) as UniversalPayload;
      req = buildUniversalTxRequest(ctx.universalSigner.account.address as `0x${string}`, {
        recipient: zeroAddress, token: zeroAddress, amount: BigInt(0),
        payload: encodePayloadForOriginIfNeeded(ctx, universalPayloadSelf, feeLockingRequired),
      });
    }
  }

  const universalPayload = JSON.parse(
    JSON.stringify({
      to: payloadTo, value: execute.value, data: payloadData,
      gasLimit: execute.gasLimit || BigInt(5e7),
      maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
      nonce, deadline: execute.deadline || BigInt(9999999999),
      vType: feeLockingRequired
        ? VerificationType.universalTxVerification
        : VerificationType.signedVerification,
    }, bigintReplacer)
  ) as UniversalPayload;

  // Prepare verification data by either signature or fund locking
  let verificationData: `0x${string}`;

  if (!feeLockingRequired) {
    const ueaVersion = await fetchUEAVersion(ctx);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_02);
    let signature: Uint8Array;
    try {
      signature = await signUniversalPayload(ctx, universalPayload, UEA, ueaVersion);
    } catch (err) {
      // Wallet decline, contract revert during sign, or RPC failure — the
      // 104-04 builder's classifyDeclineError heuristic picks the right
      // copy (real decline → "Verification Declined"; else "Signature Failed").
      const errMsg = normalizePublicErrorMessage(err);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_04, errMsg);
      ctx._routeTerminalEmitted = true;
      throw new Error(errMsg);
    }
    verificationData = bytesToHex(signature);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_03);
  } else {
    // Fee Locking
    const fundDifference = requiredFunds - funds;
    const fixedPushAmount = Utils.helpers.parseUnits('0.001', 18);
    const lockAmount = funds < requiredFunds ? fundDifference : fixedPushAmount;

    // Size the USD deposit against the REAL Uniswap pool rate (not the fixed
    // $0.10/PC SDK rate) for EVM origins. The pool typically prices PC much
    // higher than $0.10, so pushToUSDC under-provisions and the resulting
    // deposit gets clamped up to the $1 minimum, producing near-zero WPC.
    // When the quoted USD exceeds the $1000 cap the later clamp kicks in
    // (pool limit surfaces via the pre-flight capacity message).
    // Falls back to pushToUSDC if the quoter is unavailable.
    const { vm: sizingOriginVm } = CHAIN_INFO[chain];
    let lockAmountInUSD: bigint = ctx.pushClient.pushToUSDC(lockAmount);
    if (sizingOriginVm === VM.EVM && lockAmount > BigInt(0)) {
      // Target lockAmount × 1.2 so that the 10% slippage margin applied by
      // the pre-flight check (safeUPC = predictedUPC × 0.9) leaves enough
      // headroom even when Uniswap V3 exactOutput↔exactInput quotes aren't
      // perfectly symmetric (tick-math rounding).
      const targetWPC = (lockAmount * BigInt(12)) / BigInt(10);
      const originPrc20ForSizing = getNativePRC20ForChain(chain, ctx.pushNetwork);
      const requiredNative = await estimateNativeForDesiredDeposit(
        ctx,
        targetWPC,
        originPrc20ForSizing,
      );
      if (requiredNative > BigInt(0)) {
        const ethPriceForSizing = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
        if (ethPriceForSizing > BigInt(0)) {
          // requiredNative (18-dec wei) × ethPrice (8-dec USD/ETH) / 1e18 = USD in 8-dec
          const poolBasedUsd = (requiredNative * ethPriceForSizing) / BigInt(1e18);
          printLog(ctx,
            `Fee-lock sizing: pushToUSDC=${lockAmountInUSD.toString()} (fixed $0.10/PC), ` +
            `poolBased=${poolBasedUsd.toString()} (pool quote for ${targetWPC.toString()} WPC) — using poolBased`
          );
          lockAmountInUSD = poolBasedUsd;
        }
      }
    }

    // Apply minimum deposit override (e.g., Route 2 needs enough UPC for outbound swap)
    const effectiveLockAmountInUSD = execute._minimumDepositUsd && execute._minimumDepositUsd > lockAmountInUSD
      ? execute._minimumDepositUsd
      : lockAmountInUSD;

    // Pre-flight: predict the actual $PC the UEA will receive after the
    // on-chain pETH → WPC swap and validate it covers requiredFunds.
    // Uses the same Uniswap V3 quoter the chain uses (execute_inbound_gas.go).
    // Mirrors the pattern in route-handlers.ts (Route 2/3).
    const { vm: originVm } = CHAIN_INFO[chain];
    if (originVm === VM.EVM) {
      try {
        // Replicate lockFee's USD → native conversion (with its $1–$1000 clamp)
        const oneUsd = Utils.helpers.parseUnits('1', 8);
        const maxUsd = Utils.helpers.parseUnits('1000', 8);
        let depositUsd = effectiveLockAmountInUSD < oneUsd ? oneUsd : effectiveLockAmountInUSD;
        if (depositUsd > maxUsd) depositUsd = maxUsd;

        const ethPrice = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
        if (ethPrice > BigInt(0)) {
          const nativeAmountETH =
            (depositUsd * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1);
          const originPrc20 = getNativePRC20ForChain(chain, ctx.pushNetwork);
          const predictedUPC = await estimateDepositFromLockedNative(ctx, nativeAmountETH, originPrc20);

          if (predictedUPC > BigInt(0)) {
            // 10% slippage margin (same as route-handlers.ts)
            const safeUPC = (predictedUPC * BigInt(90)) / BigInt(100);
            const totalAvailable = safeUPC + funds;
            printLog(ctx,
              `Fee-lock pre-flight: deposit ${depositUsd.toString()} USD → ` +
              `~${nativeAmountETH.toString()} wei ETH → ~${predictedUPC.toString()} UPC ` +
              `(safe: ${safeUPC.toString()}), existing: ${funds.toString()}, ` +
              `total: ${totalAvailable.toString()}, required: ${requiredFunds.toString()}`
            );

            if (totalAvailable < requiredFunds) {
              const shortfall = requiredFunds - totalAvailable;

              // On failure only: probe pool capacity at the max cap so the
              // caller gets a readable "max transferable right now" number.
              // One extra quoter call — not run on the success path.
              let maxTransferableNote = '';
              if (depositUsd < maxUsd) {
                const maxNativeAmountETH =
                  (maxUsd * BigInt(1e18) + (ethPrice - BigInt(1))) / ethPrice + BigInt(1);
                const maxPredictedUPC = await estimateDepositFromLockedNative(
                  ctx,
                  maxNativeAmountETH,
                  originPrc20,
                );
                if (maxPredictedUPC > BigInt(0)) {
                  const maxSafeUPC = (maxPredictedUPC * BigInt(90)) / BigInt(100);
                  const gasReserve = Utils.helpers.parseUnits('0.01', 18);
                  const maxFromDeposit =
                    maxSafeUPC > gasReserve ? maxSafeUPC - gasReserve : BigInt(0);
                  const maxTransferable = funds + maxFromDeposit;
                  maxTransferableNote =
                    `Max transferable right now (at $1000 cap, pool-limited): ` +
                    `~${formatPc(maxTransferable, 4)} ` +
                    `(UEA balance ${formatPc(funds, 4)} + ` +
                    `pool-safe deposit ${formatPc(maxFromDeposit, 4)} - gas).`;
                  printLog(ctx, `Fee-lock capacity: ${maxTransferableNote}`);
                }
              }

              throw new Error(
                `Insufficient deposit: the fee-lock will deposit ~${formatPc(safeUPC, 4)} ` +
                `but the transaction requires ~${formatPc(requiredFunds, 4)} ` +
                `(shortfall: ~${formatPc(shortfall, 4)}). ` +
                `The fee-lock deposit is capped at $1000 USD. ` +
                (maxTransferableNote ? maxTransferableNote + ' ' : '') +
                `Reduce the transfer value or pre-fund the UEA (${UEA}) on Push Chain.`
              );
            }
          }
        }
      } catch (err) {
        // If the error is our own insufficient-deposit error, rethrow it
        if (err instanceof Error && err.message.startsWith('Insufficient deposit')) {
          throw err;
        }
        // Otherwise quoter failed — log and continue (same fallback as route-handlers)
        printLog(ctx, `Fee-lock pre-flight quote failed, proceeding without validation: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_01);
    let feeLockTxHashBytes: Uint8Array;
    try {
      feeLockTxHashBytes = await lockFee(ctx, effectiveLockAmountInUSD, universalPayload, req);
    } catch (err) {
      // User declined the fee-lock tx submission or the origin-chain RPC
      // rejected it — classifier picks decline vs generic signature failure.
      const errMsg = normalizePublicErrorMessage(err);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_04, errMsg);
      ctx._routeTerminalEmitted = true;
      throw new Error(errMsg);
    }
    feeLockTxHash = bytesToHex(feeLockTxHashBytes);
    verificationData = bytesToHex(feeLockTxHashBytes);

    const { vm } = CHAIN_INFO[chain];
    const feeLockTxHashDisplay = vm === VM.SVM
      ? bs58.encode(Buffer.from(feeLockTxHashBytes))
      : feeLockTxHash;

    const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, feeLockTxHash, feeLockTxHashDisplay);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_105_01, feeLockTxHashDisplay, originTx);

    await waitForLockerFeeConfirmation(ctx, feeLockTxHashBytes);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_105_02, feeLockTxHashDisplay);

    const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
    let response: UniversalTxResponse;
    try {
      const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
        ctx,
        new EvmClient({ rpcUrls: ctx.rpcUrls[chain] || defaultRPC }),
        lockerContract as `0x${string}`,
        feeLockTxHash,
        'sendTxWithGas'
      );
      // extractPcTxAndTransform fires 199-02 itself on pcTx FAILED and throws
      // PushChainExecutionError — don't double-emit. Anything else thrown
      // here (gateway-tx lookup failure, RPC error) hasn't emitted 199-02
      // yet, so the catch below surfaces it.
      response = await extractPcTxAndTransform(
        ctx, pushChainUniversalTx, feeLockTxHash, eventBuffer, 'sendTxWithGas', transformFn
      );
    } catch (err) {
      if (!(err instanceof PushChainExecutionError)) {
        const errMsg = normalizePublicErrorMessage(err);
        fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMsg);
        throw new PushChainExecutionError(errMsg, { gatewayTxHash: feeLockTxHash });
      }
      throw err;
    }
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [response]);
    return response;
  }

  // Non-fee-locking path: Broadcasting Tx to PC via sendUniversalTx.
  // Provide a resign callback so sendUniversalTx can recover from the
  // UEA-nonce race: the EIP-712 hash uses the UEA's live storage nonce
  // (not payload.nonce), so if anything advances it between our read and
  // Cosmos inclusion the tx reverts with InvalidEVMSignature(0xc7dbd31d).
  const resignOnSigMismatch = async () => {
    const freshNonce = await getUEANonce(ctx, UEA);
    const freshUeaVersion = await fetchUEAVersion(ctx);
    const freshPayload = JSON.parse(
      JSON.stringify({ ...universalPayload, nonce: freshNonce }, bigintReplacer)
    ) as UniversalPayload;
    const freshSig = await signUniversalPayload(ctx, freshPayload, UEA, freshUeaVersion);
    return {
      universalPayload: freshPayload,
      verificationData: bytesToHex(freshSig),
    };
  };

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
  let transactions: UniversalTxResponse[];
  try {
    transactions = await sendUniversalTx(
      ctx, isUEADeployed, feeLockTxHash, universalPayload, verificationData, eventBuffer, transformFn,
      resignOnSigMismatch,
    );
  } catch (err) {
    // Push Chain broadcast failed (Cosmos reject, UEA revert, nonce race
    // exhaustion). Surface terminal 199-02 before re-throwing so the stream
    // ends with the spec'd error hook. Typed PushChainExecutionError lets
    // callers classify via instanceof without message sniffing.
    const errMsg = normalizePublicErrorMessage(err);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMsg);
    if (err instanceof PushChainExecutionError) throw err;
    throw new PushChainExecutionError(errMsg);
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, transactions);
  return transactions[transactions.length - 1];
}
