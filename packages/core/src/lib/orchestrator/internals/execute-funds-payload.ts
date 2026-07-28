/**
 * Funds+payload execution flow — extracted from Orchestrator.execute().
 *
 * Handles bridging funds AND executing a payload on Push Chain
 * for both EVM and SVM origin chains.
 */

import { bs58 } from '../../internal/bs58';
import { PublicKey } from '@solana/web3.js';
import { bytesToHex, stringToBytes } from 'viem';
import SVM_GATEWAY_IDL from '../../constants/abi/universalGatewayV0.json';
import { CHAIN_INFO } from '../../constants/chain';
import { CHAIN, VM } from '../../constants/enums';
import { MOVEABLE_TOKENS, MoveableToken } from '../../constants/tokens';
import type { UniversalTx } from '../../generated/uexecutor/v1/types';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import { PriceFetch } from '../../price-fetch/price-fetch';
import { PushChain } from '../../push-chain/push-chain';
import { Utils } from '../../utils';
import { EvmClient } from '../../vm-client/evm-client';
import { SvmClient } from '../../vm-client/svm-client';
import type { TxResponse } from '../../vm-client/vm-client.types';
import type {
  LegacyExecuteParams,
  UniversalTokenTxRequest,
  UniversalTxResponse,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { fireProgressHook, printLog } from './context';
import {
  ensureErc20Allowance,
  calculateGasAmountFromAmountOutMinETH,
  estimateNativeForDesiredDeposit,
} from './gas-calculator';
import {
  sendGatewayTxWithFallback,
  sendGatewayTokenTxWithFallback,
  getOriginGatewayContext,
} from './gateway-client';
import { buildGatewayPayloadAndGas } from './payload-builder';
import { sizeR1PushGas } from './gas-usd-sizer';
import { computeUEAOffchain, getUeaStatusAndNonce, getUEANonce } from './uea-manager';
import {
  waitForEvmConfirmationsWithCountdown,
  waitForSvmConfirmationsWithCountdown,
} from './confirmation';
import {
  queryUniversalTxStatusFromGatewayTx,
  transformToUniversalTxResponse,
  type ResponseBuilderCallbacks,
} from './response-builder';
import { extractPcTxAndTransform, PushChainExecutionError } from './push-chain-tx';
import { sendSVMTxWithFunds } from './svm-bridge';
import { encodeUniversalPayload } from './signing';
import type { UniversalPayload } from '../../generated/v1/tx';
import { quoteExactOutput } from './quote';
import { normalizePublicErrorMessage } from '../../formatters';
import { getNativePRC20ForChain } from './helpers';

export async function executeFundsWithPayload(
  ctx: OrchestratorContext,
  execute: LegacyExecuteParams,
  eventBuffer: ProgressEvent[],
  getResponseCallbacks: () => ResponseBuilderCallbacks
): Promise<UniversalTxResponse> {
  const transformFn = (tx: TxResponse, buf: ProgressEvent[] = []) =>
    transformToUniversalTxResponse(ctx, tx, buf, getResponseCallbacks());

  const { chain, evmClient, gatewayAddress } = getOriginGatewayContext(ctx);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_101, chain, ctx.universalSigner.account.address);

  // Default token to native ETH if none provided
  if (!execute.funds!.token) {
    const available: MoveableToken[] =
      (MOVEABLE_TOKENS[chain] as MoveableToken[] | undefined) || [];
    const vm = CHAIN_INFO[chain].vm;
    const preferredSymbol = vm === VM.EVM ? 'ETH' : vm === VM.SVM ? 'SOL' : undefined;
    const nativeToken = preferredSymbol
      ? available.find((t) => t.symbol === preferredSymbol)
      : undefined;
    if (!nativeToken) {
      throw new Error('Native token not configured for this chain');
    }
    execute.funds!.token = nativeToken;
  }

  const mechanism = execute.funds!.token.mechanism;

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
    ctx, execute, nonce, 'sendTxWithFunds', execute.funds!.amount
  );

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_102_01);

  // Compute required gas funding on Push Chain and current UEA balance
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasPrice = await ctx.pushClient.getGasPrice();
  const requiredGasFee = gasEstimate * gasPrice;
  const payloadValue = execute.value ?? BigInt(0);
  const requiredFunds = requiredGasFee + payloadValue;

  const ueaAddress = computeUEAOffchain(ctx);
  const ueaBalance = await ctx.pushClient.getBalance(ueaAddress);

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_01);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_103_02, ueaAddress, deployed);

  // SDK 5.2 Case A/B/C sizing on the Push-chain gas portion.
  // Floor pad comes from the sizer ($1 for Case A); upper bound now lives in
  // the origin gateway (MAX_CAP_UNIVERSAL_TX_USD) — the SDK no longer caps.
  const r1Sizing = await sizeR1PushGas(ctx, {
    pushGasFeeWei: requiredGasFee,
    originChain: chain,
  });

  // Convert the sizer's USD result into planned PC native deposit so the
  // sizer progress hook can surface the user-facing `extraDepositPC` =
  // totalPCDeposit - gasRequired. The same conversion is reused below for
  // the final nativeAmount calc (after SVM clamp).
  const nativeTokenUsdPrice = await new PriceFetch(ctx.rpcUrls).getPrice(chain);
  const nativeDecimals = CHAIN_INFO[chain].vm === VM.SVM ? 9 : 18;
  const oneNativeUnit = Utils.helpers.parseUnits('1', nativeDecimals);
  const usdToNative = (usd: bigint): bigint => {
    if (nativeTokenUsdPrice === BigInt(0)) return BigInt(0);
    const out = (usd * oneNativeUnit + (nativeTokenUsdPrice - BigInt(1))) / nativeTokenUsdPrice;
    return out + BigInt(1);
  };
  const plannedPCDeposit = usdToNative(r1Sizing.paddedDepositUsd);
  const extraDepositPC =
    plannedPCDeposit > requiredGasFee ? plannedPCDeposit - requiredGasFee : BigInt(0);

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

  const deficit = requiredFunds > ueaBalance ? requiredFunds - ueaBalance : BigInt(0);
  let depositUsd = deficit > BigInt(0) ? ctx.pushClient.pushToUSDC(deficit) : BigInt(0);

  // Apply sizer floor: Case A pads to $1, Cases B/C pass-through.
  if (depositUsd < r1Sizing.paddedDepositUsd) depositUsd = r1Sizing.paddedDepositUsd;

  // Match funds-only and standard fee-lock sizing: fixed PC→USD conversion can
  // underfund large PC deposits when the live pETH/WPC pool has meaningful
  // slippage. Quote the native amount required for the target WPC output and
  // raise the USD deposit before converting back to source-chain native value.
  if (CHAIN_INFO[chain].vm === VM.EVM && requiredFunds > ueaBalance) {
    const deficit = requiredFunds - ueaBalance;
    const targetWpc = (deficit * BigInt(12)) / BigInt(10);
    const originPrc20 = getNativePRC20ForChain(chain, ctx.pushNetwork);
    const poolNativeAmount = await estimateNativeForDesiredDeposit(
      ctx,
      targetWpc,
      originPrc20
    );

    if (poolNativeAmount > BigInt(0)) {
      const poolBasedUsd =
        (poolNativeAmount * nativeTokenUsdPrice) / oneNativeUnit;
      if (poolBasedUsd > depositUsd) {
        printLog(
          ctx,
          `sendFundsWithPayload — pool-based deposit sizing overrides fixed-rate estimate: ` +
            `fixedUsd=${depositUsd.toString()}, poolBasedUsd=${poolBasedUsd.toString()}, ` +
            `requiredFunds=${requiredFunds.toString()}, ueaBalance=${ueaBalance.toString()}`
        );
        depositUsd = poolBasedUsd;
      }
    }
  }

  // If SVM, clamp depositUsd to on-chain Config caps
  if (CHAIN_INFO[chain].vm === VM.SVM) {
    const svmClient = new SvmClient({
      rpcUrls: ctx.rpcUrls[CHAIN.SOLANA_DEVNET] || CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
    });
    const programId = new PublicKey(SVM_GATEWAY_IDL.address);
    const [configPda] = PublicKey.findProgramAddressSync([stringToBytes('config')], programId);
    try {
      const cfg: any = await svmClient.readContract({
        abi: SVM_GATEWAY_IDL, address: SVM_GATEWAY_IDL.address,
        functionName: 'config', args: [configPda.toBase58()],
      });
      const minCapUsd = BigInt((cfg.minCapUniversalTxUsd ?? cfg.min_cap_universal_tx_usd).toString());
      const maxCapUsd = BigInt((cfg.maxCapUniversalTxUsd ?? cfg.max_cap_universal_tx_usd).toString());
      if (depositUsd < minCapUsd) depositUsd = minCapUsd;
      const withMargin = (minCapUsd * BigInt(12)) / BigInt(10);
      if (depositUsd < withMargin) depositUsd = withMargin;
      if (depositUsd > maxCapUsd) depositUsd = maxCapUsd;
    } catch {
      // best-effort
    }
  }

  // Final USD(8) -> native conversion reusing the cached price fetched above.
  const nativeAmount = usdToNative(depositUsd);

  fireProgressHook(
    ctx,
    PROGRESS_HOOK.SEND_TX_103_03_04,
    nativeAmount,
    depositUsd,
    chain
  );

  const bridgeAmount = execute.funds!.amount;
  const symbol = execute.funds!.token.symbol;

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_01, bridgeAmount, execute.funds!.token.decimals, symbol);

  if (CHAIN_INFO[ctx.universalSigner.account.chain].vm === VM.EVM) {
    const tokenAddr = execute.funds!.token.address as `0x${string}`;
    if (mechanism === 'approve') {
      const evmClientEvm = evmClient as EvmClient;
      const gatewayAddressEvm = gatewayAddress as `0x${string}`;
      await ensureErc20Allowance(ctx, evmClientEvm, tokenAddr, gatewayAddressEvm, bridgeAmount);
    } else if (mechanism === 'permit2') {
      throw new Error('Permit2 is not supported yet');
    }
  }

  let txHash: `0x${string}` | string;
  try {
    if (CHAIN_INFO[ctx.universalSigner.account.chain].vm === VM.EVM) {
      const tokenAddr = execute.funds!.token.address as `0x${string}`;
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_01);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_02);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_03);
      const evmClientEvm = evmClient as EvmClient;
      const gatewayAddressEvm = gatewayAddress as `0x${string}`;
      const payloadBytes = encodeUniversalPayload(universalPayload as unknown as UniversalPayload);
      const payWith = execute.payGasWith;
      const gasTokenAddress = payWith?.token?.address as `0x${string}` | undefined;

      if (gasTokenAddress) {
        if (chain !== CHAIN.ETHEREUM_SEPOLIA) {
          throw new Error(
            `Only ${PushChain.utils.chains.getChainName(CHAIN.ETHEREUM_SEPOLIA)} is supported for paying gas fees with ERC-20 tokens`
          );
        }
        let amountOutMinETH = payWith?.minAmountOut !== undefined ? BigInt(payWith.minAmountOut) : nativeAmount;
        const slippageBps = payWith?.slippageBps ?? 100;
        amountOutMinETH = BigInt(
          PushChain.utils.conversion.slippageToMinAmount(amountOutMinETH.toString(), { slippageBps })
        );

        const quoteExactOutputFn = (amountOut: bigint, opts: any) => quoteExactOutput(ctx, amountOut, opts);
        const { gasAmount } = await calculateGasAmountFromAmountOutMinETH(
          ctx, gasTokenAddress, amountOutMinETH, quoteExactOutputFn
        );
        const deadline = BigInt(0);

        const ownerAddress = ctx.universalSigner.account.address as `0x${string}`;
        const gasTokenBalance = await evmClientEvm.getErc20Balance({
          tokenAddress: gasTokenAddress, ownerAddress,
        });
        if (gasTokenBalance < gasAmount) {
          const sym = payWith?.token?.symbol ?? 'gas token';
          const decimals = payWith?.token?.decimals ?? 18;
          throw new Error(
            `Insufficient ${sym} balance to cover gas fees: need ${Utils.helpers.formatUnits(gasAmount, decimals)}, have ${Utils.helpers.formatUnits(gasTokenBalance, decimals)}`
          );
        }

        await ensureErc20Allowance(ctx, evmClientEvm, gasTokenAddress, gatewayAddressEvm, gasAmount);

        const reqToken: UniversalTokenTxRequest = {
          ...req, gasToken: gasTokenAddress, gasAmount, amountOutMinETH, deadline,
        };
        txHash = await sendGatewayTokenTxWithFallback(ctx, evmClientEvm, gatewayAddressEvm, reqToken, ctx.universalSigner);
      } else {
        const isNativeToken = mechanism === 'native';
        const totalValue = isNativeToken ? nativeAmount + bridgeAmount : nativeAmount;
        txHash = await sendGatewayTxWithFallback(ctx, evmClientEvm, gatewayAddressEvm, req, ctx.universalSigner, totalValue);
      }
    } else {
      txHash = await sendSVMTxWithFunds(ctx, {
        execute, mechanism, universalPayload, bridgeAmount, nativeAmount, req,
      });
    }
  } catch (err) {
    const errMsg = normalizePublicErrorMessage(err);
    fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_04, errMsg);
    ctx._routeTerminalEmitted = true;
    throw new Error(errMsg);
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_104_03);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_02, txHash, bridgeAmount, execute.funds!.token.decimals, symbol);

  // Awaiting confirmations
  const signerChain = ctx.universalSigner.account.chain;
  if (CHAIN_INFO[signerChain].vm === VM.EVM) {
    await waitForEvmConfirmationsWithCountdown(
      ctx, evmClient as EvmClient, txHash as `0x${string}`, CHAIN_INFO[signerChain].confirmations, CHAIN_INFO[signerChain].timeout
    );
  } else {
    const svmClient = new SvmClient({
      rpcUrls: ctx.rpcUrls[CHAIN.SOLANA_DEVNET] || CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
    });
    await waitForSvmConfirmationsWithCountdown(
      ctx, svmClient, txHash as string, CHAIN_INFO[signerChain].confirmations, CHAIN_INFO[signerChain].timeout
    );
  }

  // Funds Flow: Confirmed on origin
  let feeLockTxHash = txHash;
  if (CHAIN_INFO[ctx.universalSigner.account.chain].vm === VM.SVM) {
    if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
      const decoded = bs58.decode(feeLockTxHash);
      feeLockTxHash = bytesToHex(new Uint8Array(decoded));
    }
  }

  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_04, txHash as string);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_05);

  let response: UniversalTxResponse;
  try {
    let pushChainUniversalTx: UniversalTx | undefined;
    if (CHAIN_INFO[ctx.universalSigner.account.chain].vm === VM.EVM) {
      pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
        ctx, evmClient as EvmClient, gatewayAddress as `0x${string}`, txHash as `0x${string}`, 'sendTxWithFunds'
      );
    } else {
      pushChainUniversalTx = await queryUniversalTxStatusFromGatewayTx(
        ctx, undefined, undefined, txHash as string, 'sendTxWithFunds'
      );
    }
    response = await extractPcTxAndTransform(ctx, pushChainUniversalTx, txHash as string, eventBuffer, 'sendTxWithFunds', transformFn);
  } catch (err) {
    if (!(err instanceof PushChainExecutionError)) {
      const errMsg = normalizePublicErrorMessage(err);
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_02, errMsg);
      throw new PushChainExecutionError(errMsg, { gatewayTxHash: txHash as string });
    }
    throw err;
  }
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_106_06, bridgeAmount, execute.funds!.token.decimals, symbol);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
  fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_199_01, [response]);
  return response;
}
