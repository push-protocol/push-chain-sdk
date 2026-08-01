/**
 * Payload construction functions for the orchestrator.
 *
 * buildUniversalTxRequest:     Creates gateway request with revert instruction
 * buildMulticallPayloadData:   Encodes UEA_MULTICALL selector + abi-encoded calls
 * buildGatewayPayloadAndGas:   Constructs UniversalPayload + gateway request for fund flows
 */

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  toBytes,
  zeroAddress,
} from 'viem';
import { VerificationType } from '../../generated/v1/tx';
import type {
  LegacyExecuteParams,
  MultiCall,
  UniversalTxRequest,
} from '../orchestrator.types';
import { buildExecuteMulticall } from '../payload-builders';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import { SUPPORTED_GATEWAY_CHAINS } from './helpers';
import { encodeUniversalPayload } from './signing';
import { computeUEAOffchain } from './uea-manager';

// ============================================================================
// Universal Tx Request Builder
// ============================================================================

export function buildUniversalTxRequest(
  signerAddress: `0x${string}`,
  {
    recipient,
    token,
    amount,
    payload,
  }: {
    recipient: `0x${string}`;
    token: `0x${string}`;
    amount: bigint;
    payload: `0x${string}`;
  }
): UniversalTxRequest {
  const revertInstruction = {
    fundRecipient: signerAddress,
    revertMsg: '0x' as `0x${string}`,
  };
  return {
    recipient,
    token,
    amount,
    payload,
    revertInstruction,
    signatureData: '0x',
  };
}

// ============================================================================
// Multicall Encoding
// ============================================================================

export function buildMulticallPayloadData(
  ctx: OrchestratorContext,
  to: `0x${string}`,
  data: MultiCall[]
): `0x${string}` {
  printLog(
    ctx,
    '_buildMulticallPayloadData — input: ' +
      data.length +
      ' calls: ' +
      JSON.stringify(data, (_: string, v: any) => (typeof v === 'bigint' ? v.toString() : v), 2)
  );

  if (!SUPPORTED_GATEWAY_CHAINS.includes(ctx.universalSigner.account.chain)) {
    throw new Error(
      'Multicall is only enabled for Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia, BNB Testnet and Solana Devnet'
    );
  }

  // Normalize and validate calls
  const normalizedCalls = data.map((c: MultiCall) => ({
    to: getAddress(c.to),
    value: c.value,
    data: c.data,
  }));

  // bytes4(keccak256("UEA_MULTICALL")) selector
  const selector = keccak256(toBytes('UEA_MULTICALL')).slice(
    0,
    10
  ) as `0x${string}`;

  // abi.encode(Call[]), where Call = { address to; uint256 value; bytes data; }
  const encodedCalls = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    [normalizedCalls]
  );

  return (selector + encodedCalls.slice(2)) as `0x${string}`;
}

// ============================================================================
// Gateway Payload + Gas Builder
// ============================================================================

/**
 * Builds the universal payload and gateway request for sendFunds / sendTxWithFunds flows.
 */
export async function buildGatewayPayloadAndGas(
  ctx: OrchestratorContext,
  execute: LegacyExecuteParams,
  nonce: bigint,
  type: 'sendFunds' | 'sendTxWithFunds',
  fundsValue?: bigint
): Promise<{ payload: never; gasAmount: bigint; req: UniversalTxRequest }> {
  const gasEstimate = execute.gasLimit || BigInt(1e7);
  const gasAmount = execute.value ?? BigInt(0);
  const ueaAddress = computeUEAOffchain(ctx);

  /**
   * `req.recipient` for the gateway request.
   *
   * Normally `address(0)`, the protocol's "attribute funds to the caller's
   * UEA" sentinel. It is only ever read on routes that resolve it — the chain
   * overwrites `recipient` with zero for non-CEA payload-type inbounds
   * (`x/uexecutor/types/inbound.go`), and the gateway's ERC20 route sends any
   * excess native value down the GAS path, where zero is handled.
   *
   * A PC20 burn is the exception. `UniversalGateway._routePC20Tx` forwards the
   * post-fee native value as a *FUNDS* request (not GAS, unlike the ERC20
   * route) while copying this `recipient` verbatim. A FUNDS inbound deposits
   * straight to `inbound.Recipient`, so a zero there makes the chain mint the
   * prepaid gas to `address(0)` and revert — the deposit is silently lost.
   * Verified by eth_call: `depositPRC20Token(pETH, amount, 0x0)` reverts,
   * the same call with the UEA succeeds.
   *
   * Naming the UEA explicitly is a no-op for the PC20 burn event itself (the
   * chain zeroes it for that leg regardless) and makes the native leg credit
   * the account the gateway already intends: "route excess native value as a
   * standard FUNDS transfer to caller's UEA".
   */
  const requestRecipient =
    execute._pc20?.direction === 'import' ? ueaAddress : zeroAddress;

  if (type === 'sendTxWithFunds') {
    if (!execute.funds?.token)
      throw new Error(`Invalid ${execute.funds?.token}`);

    const multicallData: MultiCall[] = buildExecuteMulticall({
      execute,
      ueaAddress,
    });
    const universalPayload = {
      to: zeroAddress,
      value: execute.value ?? BigInt(0),
      data: buildMulticallPayloadData(ctx, execute.to, multicallData),
      gasLimit: gasEstimate,
      maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
      nonce,
      deadline: execute.deadline || BigInt(9999999999),
      vType: VerificationType.universalTxVerification,
    } as unknown as never;

    printLog(ctx, '(universalPayload) ' + universalPayload);

    let tokenAddress = execute.funds?.token?.address as `0x${string}`;
    if (
      execute.funds?.token?.address ===
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ) {
      tokenAddress = zeroAddress;
    }

    const req = buildUniversalTxRequest(
      ctx.universalSigner.account.address as `0x${string}`,
      {
        recipient: requestRecipient,
        token: tokenAddress,
        amount: execute.funds?.amount as bigint,
        payload: encodeUniversalPayload(universalPayload),
      }
    );

    return { payload: universalPayload, gasAmount, req };
  } else {
    if (!fundsValue) throw new Error('fundsValue property must not be empty');
    const multicallData: MultiCall[] = buildExecuteMulticall({
      execute,
      ueaAddress,
    });

    printLog(ctx, 'sendFunds — execute params: ' + JSON.stringify({
      to: execute.to,
      value: execute.value?.toString() ?? 'undefined',
      data: execute.data ?? 'undefined',
      fundsAmount: execute.funds?.amount?.toString(),
      fundsToken: execute.funds?.token?.symbol,
      tokenMechanism: execute.funds?.token?.mechanism,
      tokenAddress: execute.funds?.token?.address,
      gasLimit: execute.gasLimit?.toString() ?? 'undefined',
    }, null, 2));

    printLog(ctx, 'sendFunds — multicallData: ' + JSON.stringify(
      multicallData,
      (_, v) => typeof v === 'bigint' ? v.toString() : v,
      2
    ) + ' (length: ' + multicallData.length + ')');

    const multicallPayloadData =
      buildMulticallPayloadData(ctx, execute.to, multicallData);

    printLog(ctx, 'sendFunds — multicallPayloadData (first 66 chars): ' + multicallPayloadData.slice(0, 66) + ' (full length: ' + multicallPayloadData.length + ')');

    const universalPayload = {
      to: zeroAddress,
      value: execute.value ?? BigInt(0),
      data: multicallPayloadData,
      gasLimit: gasEstimate,
      maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
      nonce,
      deadline: execute.deadline || BigInt(9999999999),
      vType: VerificationType.universalTxVerification,
    } as unknown as never;

    printLog(ctx, 'sendFunds — universalPayload (pre-encode): ' + JSON.stringify({
      to: zeroAddress,
      value: (execute.value ?? BigInt(0)).toString(),
      data: multicallPayloadData,
      gasLimit: gasEstimate.toString(),
      maxFeePerGas: (execute.maxFeePerGas || BigInt(1e10)).toString(),
      maxPriorityFeePerGas: (execute.maxPriorityFeePerGas || BigInt(0)).toString(),
      nonce: nonce.toString(),
      deadline: (execute.deadline || BigInt(9999999999)).toString(),
    }, null, 2));

    let tokenAddress = execute.funds?.token?.address as `0x${string}`;
    if (
      execute.funds?.token?.address ===
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ) {
      tokenAddress = zeroAddress;
    }

    const encodedPayload = encodeUniversalPayload(universalPayload);
    printLog(ctx, 'sendFunds — encodedPayload (first 66 chars): ' + encodedPayload.slice(0, 66) + ' (full length: ' + encodedPayload.length + ')');

    const req = buildUniversalTxRequest(
      ctx.universalSigner.account.address as `0x${string}`,
      {
        recipient: requestRecipient,
        token: tokenAddress,
        amount: execute.funds?.amount as bigint,
        payload: encodedPayload,
      }
    );

    printLog(ctx, 'sendFunds — final req: ' + JSON.stringify({
      recipient: requestRecipient,
      token: tokenAddress,
      amount: (execute.funds?.amount as bigint)?.toString(),
      payloadLength: encodedPayload.length,
    }, null, 2));

    return { payload: universalPayload, gasAmount, req };
  }
}
