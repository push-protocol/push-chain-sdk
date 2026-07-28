/**
 * Funds-only execution flow (no payload) — extracted from Orchestrator.execute().
 *
 * Handles bridging funds from an external chain to Push Chain
 * for both EVM and SVM origin chains.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { stringToBytes } from 'viem';
import SVM_GATEWAY_IDL from '../../constants/abi/universalGatewayV0.json';
import { CHAIN_INFO, SVM_PYTH_PRICE_FEED } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { MOVEABLE_TOKENS, MoveableToken } from '../../constants/tokens';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import { EvmClient } from '../../vm-client/evm-client';
import { getOriginEvmClient } from './context';
import { SvmClient } from '../../vm-client/svm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import type {
  LegacyExecuteParams,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import {
  calculateNativeAmountForDeposit,
  ensureErc20Allowance,
  estimateNativeForDesiredDeposit,
} from './gas-calculator';
import { sendGatewayTxWithFallback } from './gateway-client';
import { sizeR1PushGas } from './gas-usd-sizer';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { Utils } from '../../utils';
import { getNativePRC20ForChain, SUPPORTED_GATEWAY_CHAINS } from './helpers';
import { buildGatewayPayloadAndGas } from './payload-builder';
import { getUeaStatusAndNonce, getUEANonce, computeUEAOffchain } from './uea-manager';
import { waitForEvmConfirmationsWithCountdown, waitForSvmConfirmationsWithCountdown } from './confirmation';
import { queryUniversalTxStatusFromGatewayTx } from './response-builder';
import { extractPcTxAndTransform, PushChainExecutionError } from './push-chain-tx';
import { buildSvmUniversalTxRequest, getSvmProtocolFee } from './svm-helpers';
import { fetchOriginChainTransactionForProgress } from './helpers';
import type { ResponseBuilderCallbacks } from './response-builder';
import { transformToUniversalTxResponse } from './response-builder';
import { normalizePublicErrorMessage } from '../../formatters';

export async function executeFundsOnly(
  ctx: OrchestratorContext,
  execute: LegacyExecuteParams,
  eventBuffer: ProgressEvent[],
  getResponseCallbacks: () => ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const transformFn = (tx: TxResponse, buf: ProgressEvent[] = []) =>
    transformToUniversalTxResponse(ctx, tx, buf, getResponseCallbacks());

  const chain = ctx.universalSigner.account.chain;
  const { vm } = CHAIN_INFO[chain];
  if (!SUPPORTED_GATEWAY_CHAINS.includes(chain)) {
    throw new Error(
      `Funds bridging is not supported on chain ${chain}. Supported chains: ${SUPPORTED_GATEWAY_CHAINS.join(', ')}`
    );
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, chain, ctx.universalSigner.account.address);

  const { defaultRPC, lockerContract } = CHAIN_INFO[chain];
  const rpcUrls: string[] = ctx.rpcUrls[chain] || defaultRPC;

  // Resolve token: default to native token based on VM
  if (!execute.funds!.token) {
    const available: MoveableToken[] =
      (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
    const preferredSymbol = vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
    const nativeToken = preferredSymbol
      ? available.find((t) => t.symbol === preferredSymbol)
      : undefined;
    if (!nativeToken) {
      throw new Error('Native token not configured for this chain');
    }
    execute.funds!.token = nativeToken;
  }

  const amount = execute.funds!.amount;
  const symbol = execute.funds!.token.symbol;
  const bridgeAmount = amount;

  if (vm === VM.EVM) {
    return executeFundsOnlyEvm(ctx, execute, eventBuffer, transformFn, chain, rpcUrls, lockerContract, bridgeAmount, symbol);
  } else {
    return executeFundsOnlySvm(ctx, execute, eventBuffer, transformFn, chain, rpcUrls, bridgeAmount, symbol);
  }
}

// ============================================================================
// EVM funds-only path
// ============================================================================

async function executeFundsOnlyEvm(
  ctx: OrchestratorContext,
  execute: LegacyExecuteParams,
  eventBuffer: ProgressEvent[],
  transformFn: (tx: TxResponse, buf?: ProgressEvent[]) => Promise<UniversalTxResponse>,
  chain: CHAIN,
  rpcUrls: string[],
  lockerContract: string | undefined,
  bridgeAmount: bigint,
  symbol: string
): Promise<UniversalTxResponse> {
  const evmClient = getOriginEvmClient(ctx);
  const gatewayAddress = lockerContract as `0x${string}`;
  const tokenAddr = execute.funds!.token!.address as `0x${string}`;
  const isNative = execute.funds!.token!.mechanism === 'native';
  // Skip getCode if accountStatusCache already confirmed deployment
  let nonce: bigint;
  let deployed: boolean;
  const deployedHint = ctx.accountStatusCache?.uea?.deployed;
  if (deployedHint) {
    deployed = true;
    nonce = await getUEANonce(ctx, computeUEAOffchain(ctx));
  } else {
    const status = await getUeaStatusAndNonce(ctx);
    nonce = status.nonce;
    deployed = status.deployed;
  }
  const { payload: universalPayload, req } = await buildGatewayPayloadAndGas(
    ctx, execute, nonce, 'sendFunds', bridgeAmount
  );

  const ueaAddress = computeUEAOffchain(ctx);

  printLog(ctx, 'sendFunds — buildGatewayPayloadAndGas result: ' + JSON.stringify({
    recipient: execute.to, ueaAddress,
    isSelfBridge: execute.to.toLowerCase() === ueaAddress.toLowerCase(),
    bridgeAmount: bridgeAmount.toString(), isNative, tokenAddr,
    nonce: nonce.toString(), deployed,
  }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  const ueaBalanceForGas = await ctx.pushClient.getBalance(ueaAddress);
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasPrice = await ctx.pushClient.getGasPrice();
  const requiredGasFee = gasEstimate * gasPrice;
  const requiredFunds = requiredGasFee + (execute.value ?? BigInt(0));
  let nativeAmount = await calculateNativeAmountForDeposit(
    ctx,
    chain,
    requiredFunds,
    ueaBalanceForGas,
    // Defer the 103-03-04 ("Prepaid Deposit Estimated") hook — we emit the full
    // 103-03 sizing sequence below, after 103-01/103-02 (UEA resolution), to
    // match the funds-payload path ordering.
    { emitDepositEstimated: false }
  );

  // For EVM fee-locking, fixed-rate PC→USD sizing can underfund when the
  // live WPC/native pool prices PC above the SDK's fallback price. Size the
  // native deposit against the same Push Chain pool used by the gateway.
  if (CHAIN_INFO[chain].vm === VM.EVM && requiredFunds > ueaBalanceForGas) {
    const deficit = requiredFunds - ueaBalanceForGas;
    const targetWpc = (deficit * BigInt(12)) / BigInt(10);
    const originPrc20 = getNativePRC20ForChain(chain, ctx.pushNetwork);
    const poolNativeAmount = await estimateNativeForDesiredDeposit(
      ctx,
      targetWpc,
      originPrc20
    );

    if (poolNativeAmount > nativeAmount) {
      printLog(
        ctx,
        `sendFunds — pool-based deposit sizing overrides fixed-rate estimate: fixedNative=${nativeAmount.toString()}, ` +
          `poolNative=${poolNativeAmount.toString()}, requiredFunds=${requiredFunds.toString()}, ` +
          `ueaBalance=${ueaBalanceForGas.toString()}`
      );
      nativeAmount = poolNativeAmount;
    }
  }

  printLog(
    ctx,
    `sendFunds — nativeAmount: ${nativeAmount.toString()}, ueaBalanceForGas: ${ueaBalanceForGas.toString()}, ` +
      `requiredFunds: ${requiredFunds.toString()}`
  );

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_01);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_02, ueaAddress, deployed);
  printLog(ctx, `UEA resolved: ${ueaAddress}, deployed: ${deployed}`);

  // SDK 5.2 R1 deposit-sizing progress (parent + Case A/B/C + terminal),
  // emitted here — after UEA resolution — to match the funds-payload path's
  // ordering. The terminal 103-03-04 hook was suppressed inside
  // calculateNativeAmountForDeposit above so it lands in this position instead
  // of before 103-01/103-02. Purely cosmetic: a pool/price read failure here
  // must never block the bridge, so we fall back to the terminal hook alone.
  try {
    const r1Sizing = await sizeR1PushGas(ctx, {
      pushGasFeeWei: requiredGasFee,
      originChain: chain,
    });
    const nativeTokenUsdPrice = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
    const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
    const oneNativeUnit = Utils.helpers.parseUnits('1', nativeDecimals);
    const plannedPCDeposit =
      nativeTokenUsdPrice === BigInt(0)
        ? BigInt(0)
        : (r1Sizing.paddedDepositUsd * oneNativeUnit +
            (nativeTokenUsdPrice - BigInt(1))) /
            nativeTokenUsdPrice +
          BigInt(1);
    const extraDepositPC =
      plannedPCDeposit > requiredGasFee
        ? plannedPCDeposit - requiredGasFee
        : BigInt(0);

    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_103_03,
      chain,
      r1Sizing.paddedDepositUsd
    );
    const r1SizingHookId = {
      A: PROGRESS_HOOK.SEND_TX_103_03_01,
      B: PROGRESS_HOOK.SEND_TX_103_03_02,
      C: PROGRESS_HOOK.SEND_TX_103_03_03,
    }[r1Sizing.category];
    fireProgressHook(
      ctx,
      r1SizingHookId,
      chain,
      requiredGasFee,
      extraDepositPC,
      r1Sizing.paddedDepositUsd
    );
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_103_03_04,
      nativeAmount,
      r1Sizing.paddedDepositUsd,
      chain
    );
  } catch {
    fireProgressHook(
      ctx,
      PROGRESS_HOOK.SEND_TX_103_03_04,
      nativeAmount,
      BigInt(0),
      chain
    );
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_01, execute.funds!.amount, execute.funds!.token!.decimals, symbol);

  // Approve gateway to pull tokens if ERC-20.
  //
  // A PC20 wrapper is deliberately NOT approved. The gateway's configured
  // PC20Factory burns it directly via `burnFrom(sourceAsset, caller, amount)`,
  // so an allowance here would be granted and never used — a pointless
  // approval tx and a standing allowance on the user's wrapper balance.
  if (execute.funds!.token!.mechanism === 'approve') {
    await ensureErc20Allowance(ctx, evmClient, tokenAddr, gatewayAddress, execute.funds!.amount);
  } else if (execute.funds!.token!.mechanism === 'permit2') {
    throw new Error('Permit2 is not supported yet');
  }

  let txHash: `0x${string}`;
  try {
    printLog(ctx, (execute.to.toLowerCase() === ueaAddress.toLowerCase() ? 'FUNDS ONLY SELF' : 'FUNDS ONLY OTHER') +
      ' — gateway call payload: ' + JSON.stringify({
        gatewayAddress, functionName: 'sendUniversalTx', req,
        value: (isNative ? nativeAmount + bridgeAmount : nativeAmount).toString(),
        isNative, bridgeAmount: bridgeAmount.toString(), nativeAmount: nativeAmount.toString(),
      }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    txHash = await sendGatewayTxWithFallback(
      ctx, evmClient, gatewayAddress, req, ctx.universalSigner,
      isNative ? nativeAmount + bridgeAmount : nativeAmount,
    );
  } catch (err) {
    const errMsg = normalizePublicErrorMessage(err);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_04, errMsg);
    ctx._routeTerminalEmitted = true;
    throw new Error(errMsg);
  }

  const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, txHash, txHash);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_02, txHash, bridgeAmount, execute.funds!.token!.decimals, symbol, originTx);

  await waitForEvmConfirmationsWithCountdown(ctx, evmClient, txHash, CHAIN_INFO[chain].confirmations, CHAIN_INFO[chain].timeout);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_04, txHash);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_05);

  printLog(ctx, 'sendFunds — querying Push Chain status: ' + JSON.stringify({
    txHash, evmGatewayMethod: execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds',
  }));

  let response: UniversalTxResponse;
  try {
    const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
      ctx, evmClient, gatewayAddress, txHash,
      execute.to === ueaAddress ? 'sendFunds' : 'sendTxWithFunds'
    );
    // extractPcTxAndTransform fires 199-02 itself on pcTx FAILED; only emit
    // for non-typed failures (RPC lookup error, timeout).
    response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, txHash, eventBuffer, 'sendFunds', transformFn);
  } catch (err) {
    if (!(err instanceof PushChainExecutionError)) {
      const errMsg = normalizePublicErrorMessage(err);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMsg);
      throw new PushChainExecutionError(errMsg, { gatewayTxHash: txHash });
    }
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_06, bridgeAmount, execute.funds!.token!.decimals, symbol);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [response]);
  return response;
}

// ============================================================================
// SVM funds-only path
// ============================================================================

async function executeFundsOnlySvm(
  ctx: OrchestratorContext,
  execute: LegacyExecuteParams,
  eventBuffer: ProgressEvent[],
  transformFn: (tx: TxResponse, buf?: ProgressEvent[]) => Promise<UniversalTxResponse>,
  chain: CHAIN,
  rpcUrls: string[],
  bridgeAmount: bigint,
  symbol: string
): Promise<UniversalTxResponse> {
  const svmClient = new SvmClient({ rpcUrls });
  const programId = new PublicKey(SVM_GATEWAY_IDL.address);
  const [configPda] = PublicKey.findProgramAddressSync([stringToBytes('config')], programId);
  const [vaultPda] = PublicKey.findProgramAddressSync([stringToBytes('vault')], programId);
  const { feeVaultPda, protocolFeeLamports } = await getSvmProtocolFee(svmClient, programId);
  const [rateLimitConfigPda] = PublicKey.findProgramAddressSync([stringToBytes('rate_limit_config')], programId);
  const userPk = new PublicKey(ctx.universalSigner.account.address);
  const priceUpdatePk = new PublicKey(SVM_PYTH_PRICE_FEED);

  if (execute.payGasWith !== undefined) {
    throw new Error('Pay-with token is not supported on Solana');
  }

  const recipientEvm20: number[] = Array.from(
    Buffer.from((execute.to as `0x${string}`).slice(2).padStart(40, '0'), 'hex').subarray(0, 20)
  );

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_01);
  const ueaAddress = computeUEAOffchain(ctx);
  const { nonce, deployed } = await getUeaStatusAndNonce(ctx);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_02, ueaAddress, deployed);

  let txSignature: string;

  if (execute.funds!.token!.mechanism === 'native') {
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), PublicKey.default.toBuffer()], programId
    );
    const reqNative = buildSvmUniversalTxRequest({
      recipient: recipientEvm20, token: PublicKey.default, amount: bridgeAmount,
      payload: '0x', revertRecipient: userPk, signatureData: '0x',
    });
    txSignature = await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL, address: programId.toBase58(), functionName: 'sendUniversalTx',
      args: [reqNative, bridgeAmount + protocolFeeLamports], signer: ctx.universalSigner,
      accounts: {
        config: configPda, vault: vaultPda, feeVault: feeVaultPda,
        userTokenAccount: vaultPda, gatewayTokenAccount: vaultPda, user: userPk,
        priceUpdate: priceUpdatePk, rateLimitConfig: rateLimitConfigPda,
        tokenRateLimit: tokenRateLimitPda,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        systemProgram: SystemProgram.programId,
      },
    });
  } else if (execute.funds!.token!.mechanism === 'approve') {
    const mintPk = new PublicKey(execute.funds!.token!.address);
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const userAta = PublicKey.findProgramAddressSync(
      [userPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    const vaultAta = PublicKey.findProgramAddressSync(
      [vaultPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), mintPk.toBuffer()], programId
    );

    const reqSpl = buildSvmUniversalTxRequest({
      recipient: recipientEvm20, token: mintPk, amount: bridgeAmount,
      payload: '0x', revertRecipient: userPk, signatureData: '0x',
    });
    txSignature = await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL, address: programId.toBase58(), functionName: 'sendUniversalTx',
      args: [reqSpl, protocolFeeLamports], signer: ctx.universalSigner,
      accounts: {
        config: configPda, vault: vaultPda, feeVault: feeVaultPda,
        userTokenAccount: userAta, gatewayTokenAccount: vaultAta, user: userPk,
        tokenProgram: TOKEN_PROGRAM_ID, priceUpdate: priceUpdatePk,
        rateLimitConfig: rateLimitConfigPda, tokenRateLimit: tokenRateLimitPda,
        systemProgram: SystemProgram.programId,
      },
    });
  } else {
    throw new Error('Unsupported token mechanism on Solana');
  }

  const originTx = await fetchOriginChainTransactionForProgress(ctx, chain, '0x', txSignature);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_02, txSignature, bridgeAmount, execute.funds!.token!.decimals, symbol, originTx);

  await waitForSvmConfirmationsWithCountdown(ctx, svmClient, txSignature, CHAIN_INFO[chain].confirmations, CHAIN_INFO[chain].timeout);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_04, txSignature);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_05);

  let response: UniversalTxResponse;
  try {
    const pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(ctx, undefined, undefined, txSignature, 'sendFunds');
    response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, txSignature, eventBuffer, 'sendFunds (SVM)', transformFn);
  } catch (err) {
    if (!(err instanceof PushChainExecutionError)) {
      const errMsg = normalizePublicErrorMessage(err);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMsg);
      throw new PushChainExecutionError(errMsg, { gatewayTxHash: txSignature });
    }
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_06, bridgeAmount, execute.funds!.token!.decimals, symbol);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [response]);
  return response;
}
