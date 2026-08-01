import {
  assertLegacyFunds,
  assertPC20ImportHasPayload,
  gateFunds,
  isPC20ImportWithFunds,
  revalidatePreparedPC20,
} from './pc20/gate';
/**
 * Cascade composition functions extracted from Orchestrator.
 *
 * Covers: prepareTransaction, buildHopDescriptor, classifyIntoSegments,
 * getSegmentType, composeCascade, createCascadedBuilder, createChainedBuilder.
 */

import { PublicKey } from '@solana/web3.js';
import { encodeFunctionData } from 'viem';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { CHAIN_INFO, UNIVERSAL_GATEWAY_ADDRESSES } from '../../constants/chain';
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import { MoveableToken } from '../../constants/tokens';
import { isPC20Reference } from '../orchestrator.types';
import {
  DEFAULT_CEA_TO_PUSH_GAS_LIMIT,
  DEFAULT_OUTBOUND_GAS_LIMIT,
  ZERO_ADDRESS,
} from '../../constants/selectors';
import {
  TransactionRoute,
  detectRoute,
  validateRouteParams,
} from '../route-detector';
import { getCEAAddress } from '../cea-utils';
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
  encodeSvmExecutePayload,
  encodeSvmCeaToUeaPayload,
} from '../payload-builders';
import { hasExecutablePayloadData, isEmptyPayloadData } from '../data-utils';
import { PushChain } from '../../push-chain/push-chain';
import type {
  HopDescriptor,
  CascadeSegment,
  CascadeSegmentType,
  PreparedUniversalTx,
  CascadedTxResponse,
  CascadeHopInfo,
  CascadeCompletionResult,
  CascadeTrackOptions,
  UniversalTxResponse,
  UniversalExecuteParams,
  ExecuteParams,
  LegacyExecuteParams,
  MultiCall,
  ChainTarget,
  CascadeExecutionOptions,
  WaitForOutboundOptions,
  OutboundTxDetails,
} from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import {
  getUniversalGatewayPCAddress,
  getNativePRC20ForChain,
  toExecuteParams,
  getPushChainForNetwork,
  isPushChain,
  toExternalTxHashDisplay,
} from './helpers';
import { buildMulticallPayloadData } from './payload-builder';
import {
  computeUEAOffchain,
  getUEANonce,
  getUeaStatusAndNonce,
} from './uea-manager';
import {
  queryOutboundGasFee,
  estimateNativeValueForSwap,
} from './gas-calculator';
import type { GasSizingDecision } from './gas-usd-sizer';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import {
  buildPayloadForRoute,
  resolveR2DestinationFundsToken,
} from './route-handlers';
import { pickWaitHooks } from './progress-route-hooks';
import PROGRESS_HOOKS from '../../progress-hook/progress-hook';
import {
  PROGRESS_HOOK,
  type ProgressEvent,
} from '../../progress-hook/progress-hook.types';
import { buildSvmPayloadFromParams } from '../svm-idl/build-payload';
import { runPreflight, maybeFireSvmWarnThreshold } from './preflight';
import {
  deriveAtaPubkey,
  ensureSvmFinalizeGasBudgetQuote,
} from './svm-rent';
import { buildPC20SvmCeaBurnPayload } from './pc20/svm';
import type { ResolvedPC20 } from './pc20/resolver';
import { InsufficientUEABalanceError } from './errors';
import { fireProgressHook } from './context';
import {
  InboundTimeoutError,
  waitForInboundPushTx,
  type InboundPushTxDetails,
  type WaitForInboundOptions,
} from './inbound-tracker';

// ============================================================================
// Callback interfaces
// ============================================================================

export interface CascadeCallbacks {
  executeFn: (params: any) => Promise<UniversalTxResponse>;
  waitForOutboundTxFn: (
    hash: string,
    opts?: WaitForOutboundOptions
  ) => Promise<OutboundTxDetails>;
  waitForInboundPushTxFn?: (
    outboundExternalTxHash: string,
    sourceChain: string,
    opts?: WaitForInboundOptions
  ) => Promise<InboundPushTxDetails>;
  waitForAllOutboundTxsFn: (
    hash: string,
    hops: CascadeHopInfo[],
    opts: any
  ) => Promise<{ success: boolean; failedAt?: number }>;
}

// ============================================================================
// dispatchCascadeProgressEvent
// ============================================================================

/**
 * Fan out a cascade progress event to up to two listeners with dedup.
 *
 * The two listener slots are:
 *   - `primary`: explicit `eventHook` from CascadeTrackOptions (passed at call
 *     time to `waitForAll` / `wait`).
 *   - `secondary`: init-time `ctx.progressHook` from PushChain.initialize.
 *
 * Both may be undefined; if both reference the same function we invoke once.
 * Events with an empty `id` (the no-op sentinel returned by pickWaitHooks for
 * R4/unknown routes) are dropped so consumers don't see placeholder frames.
 *
 * Exported for unit testing. Production code calls this from the
 * `emitHopEvent` closure inside `createCascadedBuilder.waitForAll`.
 */
export function dispatchCascadeProgressEvent(
  event: import('../../progress-hook/progress-hook.types').ProgressEvent,
  primary?: (
    e: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void,
  secondary?: (
    e: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void
): void {
  if (!event.id) return;
  if (primary) primary(event);
  if (secondary && secondary !== primary) secondary(event);
}

// ============================================================================
// prepareTransaction
// ============================================================================

export async function prepareTransaction(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  callbacks: CascadeCallbacks
): Promise<PreparedUniversalTx> {
  validateRouteParams(params, {
    clientChain: ctx.universalSigner.account.chain,
  });
  const route = detectRoute(params);

  // Push native EOA: block Route 1 — use sendTransaction() for direct Push calls
  const signerChain = ctx.universalSigner.account.chain;
  const isPushNativeEOA = isPushChain(signerChain);

  if (isPushNativeEOA && route === TransactionRoute.UOA_TO_PUSH) {
    throw new Error(
      'Push native accounts cannot use prepareTransaction for Push Chain transactions. ' +
        'Use sendTransaction() instead for direct Push Chain calls.'
    );
  }

  // Fetch UEA nonce (skip for Push native EOA — uses EVM nonce, not UEA contract nonce)
  let nonce: bigint;
  const ueaAddress = computeUEAOffchain(ctx);

  if (isPushNativeEOA) {
    nonce = BigInt(0);
  } else {
    const deployedHintCascade = ctx.accountStatusCache?.uea?.deployed;
    if (deployedHintCascade) {
      nonce = await getUEANonce(ctx, ueaAddress);
    } else {
      const status = await getUeaStatusAndNonce(ctx);
      nonce = status.nonce;
    }
  }

  // PC20 resolution for a prepared transaction.
  //
  // A prepared tx is signed now and sent later, so the registry state it was
  // built against can move in between — most importantly, a first export can
  // land and create a mapping that did not exist at prepare time. The
  // descriptor is therefore resolved here to build the payload, and
  // deliberately NOT cached as authoritative: `revalidatePreparedPC20` re-runs
  // the critical reads at send time.
  const preparedParams = (await gateFunds(
    ctx,
    params as unknown as ExecuteParams
  )) as unknown as UniversalExecuteParams;

  // Build the payload based on route
  const { payload, gatewayRequest } = await buildPayloadForRoute(
    ctx,
    preparedParams,
    route,
    nonce
  );

  const gasEstimate = params.gasLimit || DEFAULT_OUTBOUND_GAS_LIMIT;
  const deadline =
    params.deadline || BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Build the HopDescriptor with all metadata needed for cascade nesting
  const hop = await buildHopDescriptor(
    ctx,
    preparedParams,
    route,
    ueaAddress
  );

  const prepared: PreparedUniversalTx = {
    route,
    payload,
    gatewayRequest,
    estimatedGas: gasEstimate,
    nonce,
    deadline,
    _hop: hop,
  };

  return prepared;
}

// ============================================================================
// buildHopDescriptor
// ============================================================================

export async function buildHopDescriptor(
  ctx: OrchestratorContext,
  params: UniversalExecuteParams,
  route: TransactionRoute,
  ueaAddress: `0x${string}`
): Promise<HopDescriptor> {
  // Pass 0 when user omits gasLimit so the contract uses the per-chain base,
  // except EVM Route 3 where a CEA deploy + sendUniversalTxToUEA needs more
  // than the generic 500k source-chain base.
  const defaultGasLimit =
    route === TransactionRoute.CEA_TO_PUSH &&
    params.from?.chain &&
    !isSvmChain(params.from.chain)
      ? DEFAULT_CEA_TO_PUSH_GAS_LIMIT
      : BigInt(0);
  const gasLimit = params.gasLimit ?? defaultGasLimit;
  const routeStr = route as unknown as string;

  const baseDescriptor: HopDescriptor = {
    params,
    route: routeStr as HopDescriptor['route'],
    gasLimit,
    maxPCForGas: params.maxPCForGas ?? BigInt(0),
    ueaAddress,
    revertRecipient: ueaAddress,
  };

  switch (route) {
    case TransactionRoute.UOA_TO_PUSH: {
      // Route 1: Build Push Chain multicalls
      const seedAmount = params.value ?? BigInt(0);
      if (
        isValueOnlyNativeSeedToOwnUea(params, ueaAddress, {
          allowFunds: true,
        })
      ) {
        return {
          ...baseDescriptor,
          pushMulticalls: [],
          nativeSeedOnly: true,
          nativeSeedAmount: seedAmount,
        };
      }

      const executeParams = assertLegacyFunds(toExecuteParams(params));
      const pushMulticalls = buildExecuteMulticall({
        execute: executeParams,
        ueaAddress,
      });

      return {
        ...baseDescriptor,
        pushMulticalls,
      };
    }

    case TransactionRoute.UOA_TO_CEA: {
      // Route 2: Build outbound metadata
      const target = params.to as ChainTarget;
      const targetChain = target.chain;

      // Branch: SVM vs EVM
      if (isSvmChain(targetChain)) {
        // SVM path: no CEA lookup, build SVM payload via IDL resolver
        const { svmPayload, hasExecute: hasSvmExecute } =
          buildSvmPayloadFromParams({
            data: params.data,
            to: target,
            senderUea: ueaAddress,
          });
        assertSvmPayloadWithinRelayLimit(
          svmPayload,
          `Route 2 SVM ${targetChain}`
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
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = params.value;
        } else if (hasSvmExecute) {
          // PAYLOAD-only SVM execute: still need native PRC-20 for chain namespace
          // + gas fees, but burn amount must be zero. Matches executeUoaToCeaSvm
          // (route-handlers.ts) and the EVM cascade branch below.
          // Using burnAmount=1 would trigger transferFrom on the PRC-20 token,
          // which reverts with InsufficientBalance when the UEA has no pSOL balance.
          prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
          burnAmount = BigInt(0);
        }

        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let gasPrice = BigInt(0);
        let sizing: GasSizingDecision | undefined;

        // SVM finalize budget: compare the quoted gasFee in lamports against
        // the gateway finalize minimum, then re-query with a bumped gasLimit
        // if the default quote is too low.
        const svmFundsToken =
          burnAmount > BigInt(0)
            ? (params.funds as { token?: MoveableToken } | undefined)?.token
            : undefined;
        const splMintBase58 =
          svmFundsToken?.mechanism === 'approve'
            ? svmFundsToken.address
            : undefined;
        let effectiveGasLimit = gasLimit;

        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          let result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            effectiveGasLimit,
            targetChain
          );
          result = await ensureSvmFinalizeGasBudgetQuote({
            ctx,
            ueaAddress,
            targetChain,
            prc20Token,
            quote: result,
            splMintBase58,
            burnAmount,
            pathTag: 'buildHopDescriptor',
          });
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          gasPrice = result.gasPrice;
          sizing = result.sizing;
          effectiveGasLimit = result.gasLimitUsed;
          if (!params.gasLimit) {
            printLog(
              ctx,
              `buildHopDescriptor — SVM resolved effectiveGasLimit: ${effectiveGasLimit} ` +
                `(gasFee=${result.gasFee}, gasPrice=${result.gasPrice})`
            );
          }
        }

        return {
          ...baseDescriptor,
          targetChain,
          isSvmTarget: true,
          svmPayload,
          prc20Token,
          burnAmount,
          gasToken,
          gasFee,
          gasPrice,
          gasLimit: effectiveGasLimit,
          sizing,
        };
      }

      // EVM path: Resolve CEA address + build CEA multicalls
      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        targetChain,
        ctx.rpcUrls[targetChain]?.[0]
      );

      // Migration path: raw MIGRATION_SELECTOR payload, no multicall wrapping
      if (params.migration) {
        const prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        const burnAmount = BigInt(0); // Migration is logic-only — no funds. CEA rejects msg.value != 0.
        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let gasPrice = BigInt(0);
        let sizing: GasSizingDecision | undefined;
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          const result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            gasLimit,
            targetChain
          );
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          gasPrice = result.gasPrice;
          sizing = result.sizing;
        }
        return {
          ...baseDescriptor,
          targetChain,
          ceaAddress,
          ceaMulticalls: [],
          prc20Token,
          burnAmount,
          gasToken,
          gasFee,
          gasPrice,
          isMigration: true,
          sizing,
        };
      }

      // Build CEA multicalls
      const ceaMulticalls: MultiCall[] = [];
      const hasData = hasExecutablePayloadData(params.data);
      const fundsToken = params.funds?.amount
        ? resolveR2DestinationFundsToken(
            (params.funds as { token: MoveableToken }).token,
            targetChain,
            ctx.pushNetwork
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
          // target address. This mirrors the Route 1 behavior in buildExecuteMulticall.
          if (params.funds?.amount) {
            if (fundsToken && fundsToken.mechanism !== 'native') {
              const erc20Transfer = encodeFunctionData({
                abi: ERC20_EVM,
                functionName: 'transfer',
                args: [target.address, params.funds.amount],
              });
              ceaMulticalls.push({
                to: fundsToken.address as `0x${string}`,
                value: BigInt(0),
                data: erc20Transfer,
              });
            }
          }
          // Single call with data. Forward native value (if any) so the target
          // contract receives it alongside the payload call. The vault deposits
          // native value to the CEA, and the multicall forwards it to the target.
          ceaMulticalls.push({
            to: target.address as `0x${string}`,
            value: (params.value ?? BigInt(0)) + nativeFundsValue,
            data: params.data as `0x${string}`,
          });
        }
      } else {
        if (
          params.funds?.amount &&
          fundsToken &&
          fundsToken.mechanism !== 'native'
        ) {
          const erc20Transfer = encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [target.address, params.funds.amount],
          });
          ceaMulticalls.push({
            to: fundsToken.address as `0x${string}`,
            value: BigInt(0),
            data: erc20Transfer,
          });
        }

        if (params.value) {
          // Skip multicall when sending native value to own CEA — gateway deposits directly.
          // Self-call with value would revert (CEA._handleMulticall rejects it).
          if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
            ceaMulticalls.push({
              to: target.address as `0x${string}`,
              value: params.value,
              data: '0x',
            });
          }
        } else if (nativeFundsValue > BigInt(0)) {
          if (target.address.toLowerCase() !== ceaAddress.toLowerCase()) {
            ceaMulticalls.push({
              to: target.address as `0x${string}`,
              value: nativeFundsValue,
              data: '0x',
            });
          }
        }
      }

      // Determine PRC-20 token and burn amount
      let prc20Token: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let burnAmount = BigInt(0);
      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
          burnAmount = params.funds.amount;
        }
      } else if (params.value && params.value > BigInt(0)) {
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = params.value;
      } else if (hasExecutablePayloadData(params.data)) {
        // PAYLOAD-only (no value transfer): still need native PRC-20 token for
        // chain namespace lookup + gas fees, but burn amount must be zero.
        // Matches the direct executeUoaToCea path (route-handlers.ts).
        // Using burnAmount=1 would trigger transferFrom on the PRC-20 token,
        // which reverts when the UEA has no PRC-20 balance for that chain.
        prc20Token = getNativePRC20ForChain(targetChain, ctx.pushNetwork);
        burnAmount = BigInt(0);
      }

      // Query gas fee
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      let gasPrice = BigInt(0);
      let sizing: GasSizingDecision | undefined;
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(
          ctx,
          prc20Token,
          gasLimit,
          targetChain
        );
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        gasPrice = result.gasPrice;
        sizing = result.sizing;
      }

      return {
        ...baseDescriptor,
        targetChain,
        ceaAddress,
        ceaMulticalls,
        prc20Token,
        burnAmount,
        gasToken,
        gasFee,
        gasPrice,
        sizing,
      };
    }

    case TransactionRoute.CEA_TO_PUSH: {
      // Route 3: Build CEA multicalls for sendUniversalTxFromCEA
      const sourceChain = params.from!.chain;
      const seedAmount = params.value ?? BigInt(0);
      if (isValueOnlyNativeSeedToOwnUea(params, ueaAddress)) {
        return {
          ...baseDescriptor,
          sourceChain,
          burnAmount: BigInt(0),
          gasToken: ZERO_ADDRESS as `0x${string}`,
          gasFee: BigInt(0),
          nativeSeedOnly: true,
          nativeSeedAmount: seedAmount,
        };
      }

      // SVM chains use PDA-based CEA, not factory-deployed CEA
      if (isSvmChain(sourceChain)) {
        const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
        if (!lockerContract) {
          throw new Error(
            `No SVM gateway program configured for chain ${sourceChain}`
          );
        }
        const programPk = new PublicKey(lockerContract);
        const gatewayProgramHex = ('0x' +
          Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

        // Derive CEA PDA
        const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex');
        const [ceaPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('push_identity'), ueaBytes],
          programPk
        );
        const ceaPdaHex = ('0x' +
          Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

        let amount = BigInt(0);
        let prc20Token: `0x${string}`;
        if (params.funds?.amount && params.funds.amount > BigInt(0)) {
          amount = params.funds.amount;
          const token = (params.funds as { token: MoveableToken }).token;
          const pc20 = (params as { _pc20?: ResolvedPC20 })._pc20;
          if (pc20?.direction === 'import') {
            // PC20 CEA burns use the native PRC-20 only for the outbound
            // relay's chain namespace and gas. The wrapper amount is carried
            // inside the Solana self-call and must not be burned on Push.
            prc20Token = getNativePRC20ForChain(
              sourceChain,
              ctx.pushNetwork
            );
          } else if (token && token.address) {
            prc20Token = PushChain.utils.tokens.getPRC20Address(token).address;
          } else {
            prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
          }
        } else if (params.value && params.value > BigInt(0)) {
          amount = params.value;
          prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
        } else {
          // Payload-only Route 3 SVM
          prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
        }

        let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let gasFee = BigInt(0);
        let gasPrice = BigInt(0);
        let sizing: GasSizingDecision | undefined;
        let effectiveGasLimit = gasLimit;
        if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
          let result = await queryOutboundGasFee(
            ctx,
            prc20Token,
            effectiveGasLimit,
            sourceChain
          );
          result = await ensureSvmFinalizeGasBudgetQuote({
            ctx,
            ueaAddress,
            targetChain: sourceChain,
            prc20Token,
            quote: result,
            splMintBase58: undefined,
            burnAmount: BigInt(0),
            pathTag: 'buildHopDescriptor',
          });
          gasToken = result.gasToken;
          gasFee = result.gasFee;
          gasPrice = result.gasPrice;
          sizing = result.sizing;
          effectiveGasLimit = result.gasLimitUsed;
        }

        return {
          ...baseDescriptor,
          sourceChain,
          ceaAddress: ceaPdaHex,
          isSvmTarget: true,
          prc20Token,
          // Route 3 drains pre-existing funds from the external CEA. The
          // Push-side outbound is a payload relay, so no PRC-20 is burned.
          burnAmount: BigInt(0),
          gasToken,
          gasFee,
          gasPrice,
          gasLimit: effectiveGasLimit,
          sizing,
        };
      }

      const { cea: ceaAddress } = await getCEAAddress(
        ueaAddress,
        sourceChain,
        ctx.rpcUrls[sourceChain]?.[0]
      );

      // CEA auto-deploys on-chain: Vault.finalizeUniversalTx calls CEAFactory.deployCEA()
      // if CEA doesn't exist yet. No SDK-side blocking needed.

      // Determine token/amount for the inbound
      let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let amount = BigInt(0);
      let nativeValue = BigInt(0);
      if (params.funds?.amount) {
        const token = (params.funds as { token: MoveableToken }).token;
        if (token) {
          if (token.mechanism === 'native') {
            amount = params.funds.amount;
            nativeValue = params.funds.amount;
          } else {
            tokenAddress = token.address as `0x${string}`;
            amount = params.funds.amount;
          }
        }
      } else if (params.value && params.value > BigInt(0)) {
        amount = params.value;
        nativeValue = params.value;
      }

      // The PRC-20 for the outbound wrapper (Route 2 to source chain)
      const prc20Token = getNativePRC20ForChain(sourceChain, ctx.pushNetwork);
      let gasToken: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
      let gasFee = BigInt(0);
      let gasPrice = BigInt(0);
      let sizing: GasSizingDecision | undefined;
      if (prc20Token !== (ZERO_ADDRESS as `0x${string}`)) {
        const result = await queryOutboundGasFee(
          ctx,
          prc20Token,
          gasLimit,
          sourceChain
        );
        gasToken = result.gasToken;
        gasFee = result.gasFee;
        gasPrice = result.gasPrice;
        sizing = result.sizing;
      }

      return {
        ...baseDescriptor,
        sourceChain,
        ceaAddress,
        prc20Token,
        // Route 3 is payload-only on Push: the CEA-side sendUniversalTxToUEA
        // carries `amount`. Burning here would require the UEA to pre-hold the
        // token it is trying to receive from the external CEA.
        burnAmount: BigInt(0),
        gasToken,
        gasFee,
        gasPrice,
        sizing,
      };
    }

    default:
      return baseDescriptor;
  }
}

// ============================================================================
// classifyIntoSegments
// ============================================================================

export function classifyIntoSegments(hops: HopDescriptor[]): CascadeSegment[] {
  if (hops.length === 0) return [];

  const segments: CascadeSegment[] = [];
  let currentSegment: CascadeSegment | null = null;

  for (const hop of hops) {
    const segType = getSegmentType(hop.route);
    const chain = hop.targetChain || hop.sourceChain;

    const canMerge =
      currentSegment &&
      currentSegment.type === segType &&
      // Same-chain merging for OUTBOUND_TO_CEA (EVM only — SVM hops are atomic).
      // Same-source merging for INBOUND_FROM_CEA (EVM only) — multiple R3 hops
      // that share a source chain collapse into ONE CEA→UEA round-trip whose
      // inbound multicall runs every hop's target op. Without this merge the
      // cascade composer would nest the second R3 as an outbound from inside
      // the first inbound's UEA multicall, which fails inside UGPC.
      // sendUniversalTxOutbound because the UEA holds no PRC20 at that point
      // (see cascade.ts composeCascade INBOUND_FROM_CEA branch).
      (segType === 'OUTBOUND_TO_CEA'
        ? currentSegment.targetChain === hop.targetChain && !hop.isSvmTarget
        : segType === 'INBOUND_FROM_CEA'
        ? currentSegment.sourceChain === hop.sourceChain &&
          !isSvmChain(hop.sourceChain as CHAIN) &&
          isNativeSeedOnlyHop(currentSegment.hops[0]) ===
            isNativeSeedOnlyHop(hop)
        : segType === 'PUSH_EXECUTION');

    if (canMerge && currentSegment) {
      // Merge into current segment
      currentSegment.hops.push(hop);

      if (segType === 'OUTBOUND_TO_CEA') {
        currentSegment.mergedCeaMulticalls = [
          ...(currentSegment.mergedCeaMulticalls || []),
          ...(hop.ceaMulticalls || []),
        ];
        currentSegment.totalBurnAmount =
          (currentSegment.totalBurnAmount || BigInt(0)) +
          (hop.burnAmount || BigInt(0));
        // Gas fee: take the max gasLimit across merged hops
        if (hop.gasLimit > (currentSegment.gasLimit || BigInt(0))) {
          currentSegment.gasLimit = hop.gasLimit;
        }
        // Accumulate gas fees
        currentSegment.gasFee =
          (currentSegment.gasFee || BigInt(0)) + (hop.gasFee || BigInt(0));
        currentSegment.gasPrice = mergeGasPrice(
          currentSegment.gasPrice,
          hop.gasPrice
        );
        currentSegment.maxPCForGas = mergeMaxPCForGas(
          currentSegment.maxPCForGas,
          hop.maxPCForGas
        );
      } else if (segType === 'INBOUND_FROM_CEA') {
        // Sum burn amounts so the single sendUniversalTxToUEA carries the
        // combined native value forwarded from CEA back to the UEA.
        currentSegment.totalBurnAmount =
          (currentSegment.totalBurnAmount || BigInt(0)) +
          (hop.burnAmount || BigInt(0));
        if (hop.gasLimit > (currentSegment.gasLimit || BigInt(0))) {
          currentSegment.gasLimit = hop.gasLimit;
        }
        currentSegment.gasFee =
          (currentSegment.gasFee || BigInt(0)) + (hop.gasFee || BigInt(0));
        currentSegment.gasPrice = mergeGasPrice(
          currentSegment.gasPrice,
          hop.gasPrice
        );
        currentSegment.maxPCForGas = mergeMaxPCForGas(
          currentSegment.maxPCForGas,
          hop.maxPCForGas
        );
      } else if (segType === 'PUSH_EXECUTION') {
        currentSegment.mergedPushMulticalls = [
          ...(currentSegment.mergedPushMulticalls || []),
          ...(hop.pushMulticalls || []),
        ];
      }

      // Merge sizing: take the strictest category (C > B > A). Overflow
      // from a Case C hop wins so the segment's msg.value covers the
      // highest-cost hop in the merge.
      if (hop.sizing) {
        if (!currentSegment.sizing) {
          currentSegment.sizing = hop.sizing;
        } else if (
          categoryRank(hop.sizing.category) >
          categoryRank(currentSegment.sizing.category)
        ) {
          currentSegment.sizing = hop.sizing;
        }
      }
    } else {
      // Start a new segment
      currentSegment = {
        type: segType,
        hops: [hop],
        targetChain: hop.targetChain,
        sourceChain: hop.sourceChain,
        mergedCeaMulticalls:
          segType === 'OUTBOUND_TO_CEA'
            ? [...(hop.ceaMulticalls || [])]
            : undefined,
        mergedPushMulticalls:
          segType === 'PUSH_EXECUTION'
            ? [...(hop.pushMulticalls || [])]
            : undefined,
        totalBurnAmount: hop.burnAmount,
        prc20Token: hop.prc20Token,
        gasToken: hop.gasToken,
        gasFee: hop.gasFee,
        gasPrice: hop.gasPrice,
        gasLimit: hop.gasLimit,
        maxPCForGas: hop.maxPCForGas,
        sizing: hop.sizing,
      };
      segments.push(currentSegment);
    }
  }

  return segments;
}

/** Ordering for sizing-category severity (higher = stricter). */
function categoryRank(c: 'A' | 'B' | 'C'): number {
  return c === 'C' ? 2 : c === 'B' ? 1 : 0;
}

function mergeMaxPCForGas(current?: bigint, next?: bigint): bigint {
  const a = current ?? BigInt(0);
  const b = next ?? BigInt(0);
  if (a === BigInt(0) || b === BigInt(0)) return BigInt(0);
  return a + b;
}

function mergeGasPrice(current?: bigint, next?: bigint): bigint {
  const a = current ?? BigInt(0);
  const b = next ?? BigInt(0);
  return a > b ? a : b;
}

// ============================================================================
// getSegmentType
// ============================================================================

export function getSegmentType(route: string): CascadeSegmentType {
  switch (route) {
    case 'UOA_TO_PUSH':
      return 'PUSH_EXECUTION';
    case 'UOA_TO_CEA':
      return 'OUTBOUND_TO_CEA';
    case 'CEA_TO_PUSH':
      return 'INBOUND_FROM_CEA';
    default:
      return 'PUSH_EXECUTION';
  }
}

// ============================================================================
// composeCascade
// ============================================================================

export interface ComposeCascadeResult {
  multicalls: MultiCall[];
  requiredNativeValue: bigint;
}

function sumMulticallNativeValue(multicalls?: MultiCall[]): bigint {
  return (multicalls ?? []).reduce(
    (sum, mc) => sum + (mc.value ?? BigInt(0)),
    BigInt(0)
  );
}

function isValueOnlyNativeSeedToOwnUea(
  params: UniversalExecuteParams,
  ueaAddress: `0x${string}`,
  options?: { allowFunds?: boolean }
): boolean {
  return (
    (params.value ?? BigInt(0)) > BigInt(0) &&
    (options?.allowFunds === true || !params.funds?.amount) &&
    isEmptyPayloadData(params.data) &&
    typeof params.to === 'string' &&
    params.to.toLowerCase() === ueaAddress.toLowerCase()
  );
}

function getRootFundsDeposit(
  hops: HopDescriptor[]
): ExecuteParams['funds'] | undefined {
  let rootFunds: ExecuteParams['funds'] | undefined;

  for (const hop of hops) {
    // Only the leading Push execution segment is submitted through the root
    // source-chain gateway tx. Later UOA_TO_PUSH hops may be nested inside a
    // Route 3 child inbound and must not attach origin-chain funds to root.
    if (hop.route !== 'UOA_TO_PUSH') break;

    const funds = hop.params.funds;
    if (!funds?.amount || funds.amount <= BigInt(0)) continue;

    if (!rootFunds) {
      rootFunds = { ...funds };
      continue;
    }

    // Token identity across hops. Compared on the fields both union members
    // share (address) plus, for MoveableTokens, symbol/mechanism. A PC20
    // reference is identified by chain+address alone — it has no symbol or
    // mechanism to compare, and its chain is what distinguishes two wrappers
    // that happen to share an address on different chains.
    const currentToken = rootFunds.token;
    const nextToken = funds.token;
    const sameToken =
      currentToken === nextToken ||
      (!!currentToken &&
        !!nextToken &&
        currentToken.address.toLowerCase() === nextToken.address.toLowerCase() &&
        isPC20Reference(currentToken) === isPC20Reference(nextToken) &&
        (isPC20Reference(currentToken) && isPC20Reference(nextToken)
          ? currentToken.chain === nextToken.chain
          : (currentToken as MoveableToken).symbol ===
              (nextToken as MoveableToken).symbol &&
            (currentToken as MoveableToken).mechanism ===
              (nextToken as MoveableToken).mechanism));

    if (!sameToken) {
      throw new Error(
        'Cascade can only bridge one origin token in root Push execution hops. Split mixed-token deposits into separate transactions.'
      );
    }

    rootFunds = {
      ...rootFunds,
      amount: rootFunds.amount + funds.amount,
    };
  }

  return rootFunds;
}

function isNativeSeedOnlyHop(hop: HopDescriptor | undefined): boolean {
  return hop?.nativeSeedOnly === true;
}

function isNativeSeedOnlySegment(segment: CascadeSegment): boolean {
  return (
    segment.type === 'INBOUND_FROM_CEA' &&
    segment.hops.length > 0 &&
    segment.hops.every((hop) => isNativeSeedOnlyHop(hop))
  );
}

function segmentNeedsOutboundGas(segment: CascadeSegment): boolean {
  return segment.type !== 'PUSH_EXECUTION' && !isNativeSeedOnlySegment(segment);
}

function buildRootOutboundIndexByHop(
  segments: CascadeSegment[],
  hops: HopDescriptor[]
): Map<number, number> {
  const hopIndexByDescriptor = new Map<HopDescriptor, number>();
  hops.forEach((hop, index) => hopIndexByDescriptor.set(hop, index));

  const nextIndexByChain = new Map<CHAIN, number>();
  const result = new Map<number, number>();

  for (const segment of segments) {
    let chain: CHAIN | undefined;
    if (segment.type === 'OUTBOUND_TO_CEA') {
      chain = segment.targetChain;
    } else if (
      segment.type === 'INBOUND_FROM_CEA' &&
      !isNativeSeedOnlySegment(segment)
    ) {
      chain = segment.sourceChain;
    }

    if (!chain) continue;

    const outboundIndex = nextIndexByChain.get(chain) ?? 0;
    for (const hop of segment.hops) {
      const hopIndex = hopIndexByDescriptor.get(hop);
      if (hopIndex !== undefined) {
        result.set(hopIndex, outboundIndex);
      }
    }
    nextIndexByChain.set(chain, outboundIndex + 1);
  }

  return result;
}

function sumNativeSeedAmount(hops: HopDescriptor[]): bigint {
  return hops.reduce(
    (sum, hop) => sum + (hop.nativeSeedAmount ?? BigInt(0)),
    BigInt(0)
  );
}

function getCascadeNativeSeed(segments: CascadeSegment[]): bigint {
  let total = BigInt(0);
  for (const segment of segments) {
    for (const hop of segment.hops) {
      const value = hop.params.value ?? BigInt(0);
      if (isNativeSeedOnlyHop(hop)) {
        total += hop.nativeSeedAmount ?? value;
        continue;
      }

      // In a CEA->Push hop that also supplies `funds`, `value` is native PC
      // forwarded inside the inbound UEA payload. That value is available to
      // later Push-side cascade calls and must be counted for sizing fresh UEAs.
      if (
        segment.type === 'INBOUND_FROM_CEA' &&
        value > BigInt(0) &&
        hop.params.funds?.amount
      ) {
        total += value;
      }
    }
  }
  return total;
}

function getInboundFundingForBurnToken(
  segments: CascadeSegment[],
  beforeSegmentIndex: number,
  burnToken: `0x${string}`,
  pushNetwork: PUSH_NETWORK
): bigint {
  let total = BigInt(0);
  const normalizedBurnToken = burnToken.toLowerCase();

  for (const segment of segments.slice(0, beforeSegmentIndex)) {
    if (segment.type !== 'INBOUND_FROM_CEA') continue;

    for (const hop of segment.hops) {
      const params = hop.params;
      let fundedToken: `0x${string}` | undefined;
      let fundedAmount = BigInt(0);

      if (params.funds?.amount) {
        const token = (params.funds as { token?: MoveableToken }).token;
        if (token) {
          fundedToken = PushChain.utils.tokens.getPRC20Address(token).address;
          fundedAmount = params.funds.amount;
        }
      } else if (
        params.value &&
        params.value > BigInt(0) &&
        hop.sourceChain &&
        !isNativeSeedOnlyHop(hop)
      ) {
        fundedToken = getNativePRC20ForChain(hop.sourceChain, pushNetwork);
        fundedAmount = params.value;
      }

      if (fundedToken?.toLowerCase() === normalizedBurnToken) {
        total += fundedAmount;
      }
    }
  }

  return total;
}

export async function composeCascadeDetailed(
  ctx: OrchestratorContext,
  segments: CascadeSegment[],
  ueaAddress: `0x${string}`,
  ueaBalance?: bigint,
  ueaNonce?: bigint,
  options?: { enforceGasCheck?: boolean }
): Promise<ComposeCascadeResult> {
  let accumulatedPushMulticalls: MultiCall[] = [];
  let requiredNativeValue = BigInt(0);
  const gatewayPcAddress = getUniversalGatewayPCAddress();
  const currentUeaBalance = ueaBalance ?? BigInt(0);
  const cascadeNativeSeed = getCascadeNativeSeed(segments);
  const effectiveUeaBalance = currentUeaBalance + cascadeNativeSeed;
  const enforceGasCheck =
    options?.enforceGasCheck === true ||
    segments.some((segment) =>
      segment.hops.some((hop) => hop.params.options?.enforceGasCheck === true)
    );

  if (cascadeNativeSeed > BigInt(0)) {
    printLog(
      ctx,
      `composeCascade — counting cascade native seed ${cascadeNativeSeed.toString()} for cascade sizing (current UEA balance ${currentUeaBalance.toString()})`
    );
  }

  // Compute per-outbound nativeValueForGas from UEA balance
  // Each outbound segment needs native value for the gas swap on the destination chain.
  // The contract refunds excess, so over-allocating is safe.
  const numOutbounds = segments.filter(segmentNeedsOutboundGas).length;
  const CASCADE_GAS_RESERVE = BigInt(3e18); // 3 PC reserve for gas costs

  // Cascade pre-flight: catches the zero-balance silent-segment-zero failure
  // mode. When `ueaBalance <= CASCADE_GAS_RESERVE`, `perOutboundNativeValue`
  // is left undefined and downstream segments silently allocate value=0,
  // producing under-funded swaps that revert inside Uniswap. Warn by default
  // and throw only when enforceGasCheck=true.
  if (numOutbounds > 0) {
    runPreflight({
      ctx,
      ueaAddress,
      ueaBalance: effectiveUeaBalance,
      // Required = at least one wei of allocatable PC after reserve. The
      // per-segment min-swap check below catches finer-grained shortfalls.
      requiredValue: BigInt(1),
      gasReserve: CASCADE_GAS_RESERVE,
      pathTag: 'CASCADE',
      enforceGasCheck,
    });
  }
  let perOutboundNativeValue: bigint | undefined;
  if (numOutbounds > 0 && effectiveUeaBalance > CASCADE_GAS_RESERVE) {
    perOutboundNativeValue =
      (effectiveUeaBalance - CASCADE_GAS_RESERVE) / BigInt(numOutbounds);
  }

  let universalCoreAddressForSwap: `0x${string}` | undefined;
  const getUniversalCoreAddressForSwap = async (): Promise<`0x${string}`> => {
    if (!universalCoreAddressForSwap) {
      universalCoreAddressForSwap =
        await ctx.pushClient.readContract<`0x${string}`>({
          address: gatewayPcAddress,
          abi: UNIVERSAL_GATEWAY_PC,
          functionName: 'universalCore',
          args: [],
        });
    }
    return universalCoreAddressForSwap;
  };

  // Pool-price-based native-value override for SVM outbounds.
  // The flat split above works for EVM gas tokens (pBNB/pETH — cheap per unit),
  // but pSOL has a much higher WPC/pSOL pool price, so a flat balance split can
  // underfund the gas swap and make Uniswap revert with "STF". Mirror the
  // direct SVM route handlers' pool-price read for every SVM outbound-bearing
  // segment, including Route 3 SVM inbound round trips.
  const svmSegments = segments.filter(
    (s) =>
      ((s.type === 'OUTBOUND_TO_CEA' && s.hops[0]?.isSvmTarget === true) ||
        (s.type === 'INBOUND_FROM_CEA' &&
          !isNativeSeedOnlySegment(s) &&
          isSvmChain(s.sourceChain as CHAIN))) &&
      s.gasToken &&
      s.gasFee &&
      s.gasFee > BigInt(0)
  );
  const svmNativeValueBySegment = new Map<CascadeSegment, bigint>();
  if (svmSegments.length > 0 && effectiveUeaBalance > CASCADE_GAS_RESERVE) {
    const universalCoreAddress = await getUniversalCoreAddressForSwap();
    // Compute per-SVM budget = ueaBalance − (PC needed for EVM outbounds) − 1 PC safety
    // (outer-tx gas + refund headroom). Pass a huge accountBalance to the estimator so
    // its internal cap is effectively disabled; we cap externally to the per-SVM budget.
    const numEvmOutbounds = numOutbounds - svmSegments.length;
    const evmReservation =
      perOutboundNativeValue && numEvmOutbounds > 0
        ? perOutboundNativeValue * BigInt(numEvmOutbounds)
        : BigInt(0);
    const outerSafety = BigInt(1e18); // 1 PC for outer-tx gas
    const svmTotal =
      effectiveUeaBalance > evmReservation + outerSafety
        ? effectiveUeaBalance - evmReservation - outerSafety
        : BigInt(0);
    const perSvmCap = svmTotal / BigInt(svmSegments.length);
    const UNCAPPED_BALANCE = BigInt('1000000000000000000000000000000'); // effectively disable estimator's internal cap
    for (const seg of svmSegments) {
      // Cascade-level segment index (position in `segments`, not in `svmSegments`)
      // so the error's `segmentIndex` lines up with what the caller sees.
      const cascadeIdx = segments.indexOf(seg);
      const estimated = await estimateNativeValueForSwap(
        ctx,
        universalCoreAddress,
        seg.gasToken as `0x${string}`,
        seg.gasFee as bigint,
        UNCAPPED_BALANCE
      );
      // SVM warn-threshold telemetry (no truncation — pre-flight handles drain protection).
      maybeFireSvmWarnThreshold(
        ctx,
        estimated,
        seg.gasToken as `0x${string}`,
        'CASCADE'
      );
      const flat = perOutboundNativeValue ?? BigInt(0);
      let value = estimated > flat ? estimated : flat;
      if (perSvmCap > BigInt(0) && value > perSvmCap) {
        const cappedValue = perSvmCap >= estimated ? perSvmCap : estimated;
        if (cappedValue !== perSvmCap) {
          printLog(
            ctx,
            `composeCascade — SVM outbound to ${
              seg.targetChain ?? seg.sourceChain
            }: perSvmCap=${perSvmCap} is below live pool quote=${estimated}; using quote to avoid underfunded gas swap`
          );
        }
        value = cappedValue;
      }
      // Upward-allocation ceiling (mirrors R3 SVM Fix #4 in route-handlers.ts:1690).
      // When UEA balance is huge, the flat split or perSvmCap can produce a value
      // far above what the swap actually needs. Submitting that into a Uniswap
      // pool moves the price for other users. Cap at max(200 PC, 5×estimated):
      //   - fair pool (estimated ≈ 100 PC): cap = 500 PC → caps voluntary excess
      //   - skewed pool (estimated > 200 PC): cap = 5×estimated → still allows
      //     pool-skew margin; min-swap check below still fires if value < estimated
      // The contract still refunds excess via swapAndBurnGas, so this is purely
      // a guard against submitting wasteful msg.value to fair-priced pools.
      const UPWARD_BASE_CEILING_CASCADE_SVM = BigInt(200) * BigInt(1e18);
      const upwardCeilingCascadeSvm =
        estimated * BigInt(5) > UPWARD_BASE_CEILING_CASCADE_SVM
          ? estimated * BigInt(5)
          : UPWARD_BASE_CEILING_CASCADE_SVM;
      if (value > upwardCeilingCascadeSvm) {
        printLog(
          ctx,
          `composeCascade — SVM outbound to ${
            seg.targetChain ?? seg.sourceChain
          }: capping value from ${value} to upwardCeiling=${upwardCeilingCascadeSvm} (pool quote=${estimated})`
        );
        value = upwardCeilingCascadeSvm;
      }
      printLog(
        ctx,
        `composeCascade — SVM outbound to ${
          seg.targetChain ?? seg.sourceChain
        }: gasFee=${
          seg.gasFee
        }, estimatedWpc=${estimated}, flat=${flat}, perSvmCap=${perSvmCap}, upwardCeiling=${upwardCeilingCascadeSvm}, chosen=${value}`
      );
      // Per-segment minimum-viable-swap check: if the chosen `value` is below
      // the live pool quote (`estimated`), the cap squeezed the budget below
      // what the swap actually needs and the segment will revert inside
      // Uniswap with STF. Throw cleanly with `segmentIndex` so the caller
      // knows which hop's pool is misbehaving.
      if (estimated > BigInt(0) && value < estimated) {
        const shortfall = estimated - value;
        fireProgressHook(
          ctx,
          PROGRESS_HOOK.SEND_TX_003_03,
          estimated,
          value,
          false,
          ueaAddress,
          'CASCADE',
          {
            kind: 'NATIVE',
            segmentIndex: cascadeIdx,
            enforceGasCheck,
            shortfall,
          }
        );
        if (!enforceGasCheck) {
          printLog(
            ctx,
            `composeCascade — SVM outbound segment ${cascadeIdx} has native shortfall ${shortfall.toString()}; proceeding because enforceGasCheck=false`
          );
          svmNativeValueBySegment.set(seg, value);
          continue;
        }
        fireProgressHook(
          ctx,
          PROGRESS_HOOK.SEND_TX_003_04,
          estimated,
          value,
          shortfall,
          ueaAddress,
          'CASCADE',
          { kind: 'NATIVE', segmentIndex: cascadeIdx }
        );
        throw new InsufficientUEABalanceError({
          required: estimated,
          available: value,
          shortfall,
          ueaAddress,
          pathTag: 'CASCADE',
          reason: 'NATIVE',
          segmentIndex: cascadeIdx,
        });
      }
      svmNativeValueBySegment.set(seg, value);
    }
  }

  // Every EVM gas-bearing segment should follow the direct-route path: use the
  // live WPC/gasToken quote instead of blindly spending the flat balance split.
  // This includes Route 3 wrappers, which also call sendUniversalTxOutbound on
  // Push Chain before the source CEA can return. A fixed ceiling below the live
  // exact-output requirement deterministically reverts inside Uniswap with
  // `STF`; the caller-facing maxPCForGas field is the explicit spend ceiling.
  const evmSegments = segments.filter(
    (s) =>
      segmentNeedsOutboundGas(s) &&
      ((s.type === 'OUTBOUND_TO_CEA' && s.hops[0]?.isSvmTarget !== true) ||
        (s.type === 'INBOUND_FROM_CEA' &&
          !isSvmChain(s.sourceChain as CHAIN))) &&
      s.gasToken &&
      s.gasFee &&
      s.gasFee > BigInt(0)
  );
  const evmNativeValueBySegment = new Map<CascadeSegment, bigint>();
  if (evmSegments.length > 0 && effectiveUeaBalance > CASCADE_GAS_RESERVE) {
    const universalCoreAddress = await getUniversalCoreAddressForSwap();
    const UNCAPPED_BALANCE = BigInt('1000000000000000000000000000000');
    for (const seg of evmSegments) {
      const value = await estimateNativeValueForSwap(
        ctx,
        universalCoreAddress,
        seg.gasToken as `0x${string}`,
        seg.gasFee as bigint,
        UNCAPPED_BALANCE
      );
      printLog(
        ctx,
        `composeCascade — EVM outbound to ${
          seg.targetChain ?? seg.sourceChain
        }: gasFee=${
          seg.gasFee
        }, quotedNativeValue=${value}, flat=${
          perOutboundNativeValue ?? BigInt(0)
        }`
      );
      evmNativeValueBySegment.set(seg, value);
    }
  }

  for (let segIdxLoop = segments.length - 1; segIdxLoop >= 0; segIdxLoop--) {
    const segment = segments[segIdxLoop];
    const gasPriceForOutboundRequest = (chainForLog?: CHAIN): bigint => {
      const quotedGasPrice = segment.gasPrice ?? BigInt(0);
      const isInboundFromCea = segment.type === 'INBOUND_FROM_CEA';
      // If this outbound is being accumulated into an earlier Route 3
      // inbound payload, it may execute minutes after the quote. Keep
      // immediate outbounds pinned to the quote, but let delayed nested
      // outbounds resolve the live base gas price at execution time. Route 3
      // source-chain outbounds have the same quote-staleness risk because the
      // source CEA leg can execute after the Push Chain gateway quote changes.
      const executesAfterInbound = segments
        .slice(0, segIdxLoop)
        .some((s) => s.type === 'INBOUND_FROM_CEA');
      const shouldUseLiveGasPrice = isInboundFromCea || executesAfterInbound;

      if (shouldUseLiveGasPrice && quotedGasPrice > BigInt(0)) {
        printLog(
          ctx,
          `composeCascade — ${
            isInboundFromCea ? 'Route 3' : 'delayed'
          } outbound to ${
            chainForLog ?? 'unknown chain'
          }: using gasPrice=0 instead of quoted ${quotedGasPrice} so UGPC resolves the live base price at execution time`
        );
      }

      return shouldUseLiveGasPrice ? BigInt(0) : quotedGasPrice;
    };

    switch (segment.type) {
      case 'PUSH_EXECUTION': {
        // Prepend Push Chain multicalls to accumulated
        const seedAmount = sumNativeSeedAmount(segment.hops);
        if (seedAmount > requiredNativeValue) {
          requiredNativeValue = seedAmount;
        }
        requiredNativeValue += sumMulticallNativeValue(
          segment.mergedPushMulticalls
        );
        accumulatedPushMulticalls = [
          ...(segment.mergedPushMulticalls || []),
          ...accumulatedPushMulticalls,
        ];
        break;
      }

      case 'OUTBOUND_TO_CEA': {
        const firstHop = segment.hops[0];
        const isSvmSegment = firstHop?.isSvmTarget === true;

        let outboundPayload: `0x${string}`;
        let targetForOutbound: `0x${string}`;

        const isMigration = firstHop?.isMigration === true;

        if (isSvmSegment) {
          // SVM: use the pre-built SVM payload from the hop descriptor
          outboundPayload = firstHop.svmPayload ?? '0x';
          // For SVM, to.address IS the target (program for execute, recipient for withdraw)
          const svmTarget = firstHop.params.to as ChainTarget;
          targetForOutbound = svmTarget.address as `0x${string}`;
        } else if (isMigration) {
          // Migration: use raw 4-byte MIGRATION_SELECTOR, no multicall wrapping
          outboundPayload = buildMigrationPayload();
          targetForOutbound = firstHop?.ceaAddress || ueaAddress;
        } else {
          // EVM: build CEA payload from merged multicalls
          outboundPayload = buildCeaMulticallPayload(
            segment.mergedCeaMulticalls || []
          );
          // Get CEA address from the first hop
          targetForOutbound =
            outboundPayload === '0x'
              ? (ZERO_ADDRESS as `0x${string}`)
              : firstHop?.ceaAddress || ueaAddress;
          assertCeaFundsParkingInvariant(targetForOutbound, outboundPayload);
        }

        // Per-segment PRC-20 burn-balance pre-check. Fires whenever
        // burnAmount > 0 even when burn token equals gas token — the gateway's
        // transferFrom happens BEFORE the gas swap, so user must pre-hold the
        // burn amount.
        const segBurnAmount = segment.totalBurnAmount || BigInt(0);
        const segBurnToken = segment.prc20Token;
        if (segBurnAmount > BigInt(0) && segBurnToken && !isMigration) {
          const onHand = await ctx.pushClient.readContract<bigint>({
            address: segBurnToken,
            abi: ERC20_EVM,
            functionName: 'balanceOf',
            args: [ueaAddress],
          });
          const sufficient = onHand >= segBurnAmount;
          fireProgressHook(
            ctx,
            PROGRESS_HOOK.SEND_TX_003_03,
            segBurnAmount,
            onHand,
            sufficient,
            ueaAddress,
            'CASCADE',
            {
              kind: 'PRC20',
              burnToken: segBurnToken,
              segmentIndex: segIdxLoop,
              enforceGasCheck,
              shortfall: sufficient ? BigInt(0) : segBurnAmount - onHand,
            }
          );
          const priorPushExecutionMayFundBurn = segments
            .slice(0, segIdxLoop)
            .some((s) => s.type === 'PUSH_EXECUTION');
          const priorInboundFundingForBurn = getInboundFundingForBurnToken(
            segments,
            segIdxLoop,
            segBurnToken,
            ctx.pushNetwork
          );
          const priorInboundMayFundBurn =
            onHand + priorInboundFundingForBurn >= segBurnAmount;
          if (
            !sufficient &&
            !priorPushExecutionMayFundBurn &&
            !priorInboundMayFundBurn
          ) {
            const projectedOnHand = onHand + priorInboundFundingForBurn;
            const shortfall = segBurnAmount - projectedOnHand;
            if (!enforceGasCheck) {
              printLog(
                ctx,
                `composeCascade — PRC-20 shortfall ${shortfall.toString()} for segment ${segIdxLoop}; proceeding because enforceGasCheck=false`
              );
            } else {
              fireProgressHook(
                ctx,
                PROGRESS_HOOK.SEND_TX_003_04,
                segBurnAmount,
                projectedOnHand,
                shortfall,
                ueaAddress,
                'CASCADE',
                {
                  kind: 'PRC20',
                  burnToken: segBurnToken,
                  segmentIndex: segIdxLoop,
                }
              );
              throw new InsufficientUEABalanceError({
                required: segBurnAmount,
                available: projectedOnHand,
                shortfall,
                ueaAddress,
                pathTag: 'CASCADE',
                reason: 'PRC20',
                burnToken: segBurnToken,
                segmentIndex: segIdxLoop,
              });
            }
          } else if (!sufficient && priorPushExecutionMayFundBurn) {
            printLog(
              ctx,
              `composeCascade — skipping PRC-20 preflight failure for segment ${segIdxLoop}; earlier Push execution may fund ${segBurnToken} before this outbound runs`
            );
          } else if (!sufficient && priorInboundMayFundBurn) {
            printLog(
              ctx,
              `composeCascade — skipping PRC-20 preflight failure for segment ${segIdxLoop}; earlier inbound funds ${priorInboundFundingForBurn.toString()} units of ${segBurnToken} before this outbound runs`
            );
          }
        }

        // Build outbound request
        const outboundReq = buildOutboundRequest(
          targetForOutbound,
          segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
          segment.totalBurnAmount || BigInt(0),
          segment.gasLimit ?? BigInt(0),
          outboundPayload,
          ueaAddress,
          segment.maxPCForGas ?? BigInt(0),
          gasPriceForOutboundRequest(firstHop?.targetChain)
        );

        // Build approval + outbound multicalls
        const segGasFee = segment.gasFee || BigInt(0);
        const svmOverride = svmNativeValueBySegment.get(segment);
        // When UEA balance < CASCADE_GAS_RESERVE, perOutboundNativeValue is
        // undefined. Mirror the drained-UEA branch in executeUoaToCea
        // (route-handlers.ts): send the entire available balance divided
        // across outbound segments. The contract refunds excess via
        // swapAndBurnGas, so overshooting is safe; undershooting causes STF.
        let evmFallbackValue: bigint;
        if (effectiveUeaBalance > BigInt(0)) {
          evmFallbackValue =
            effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
        } else {
          evmFallbackValue = segGasFee * BigInt(1000000);
        }
        const nativeValueForGas =
          svmOverride ??
          evmNativeValueBySegment.get(segment) ??
          perOutboundNativeValue ??
          evmFallbackValue;

        // SDK 5.2 Case C: when the segment's sizing is category C, compose
        // R2/OUTBOUND_TO_CEA segments no longer apply Case A/B/C sizing
        // (scoped to R1 + R3 only). segment.sizing may still be populated
        // from the hop descriptor merge, but it is not consulted here —
        // nativeValueForGas is driven by pool-quote on the single-hop path
        // and by the cascade-level per-outbound allocation above.

        const outboundMulticalls = buildOutboundApprovalAndCall({
          prc20Token: segment.prc20Token || (ZERO_ADDRESS as `0x${string}`),
          gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(0),
          gasFee: segGasFee,
          nativeValueForGas,
          gatewayPcAddress,
          outboundRequest: outboundReq,
        });
        requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

        // Prepend to accumulated
        accumulatedPushMulticalls = [
          ...outboundMulticalls,
          ...accumulatedPushMulticalls,
        ];
        break;
      }

      case 'INBOUND_FROM_CEA': {
        // The accumulated multicalls = what runs on Push Chain AFTER inbound arrives.
        // Wrap in UniversalPayload struct with correct UEA nonce for the relay.

        if (isNativeSeedOnlySegment(segment)) {
          const seedAmount = sumNativeSeedAmount(segment.hops);
          if (seedAmount > requiredNativeValue) {
            requiredNativeValue = seedAmount;
          }
          printLog(
            ctx,
            `composeCascade — value-only CEA_TO_PUSH seed ${seedAmount.toString()} folded into root Push execution; no source-chain outbound needed`
          );
          break;
        }

        // Build push multicalls from EVERY merged hop's own data in original
        // order (e.g. counter.increment() + value transfer). Multi-hop R3
        // segments (same sourceChain) bundle all target ops into the single
        // UEA multicall so no nested outbound is needed.
        const mergedHopMulticalls: MultiCall[] = [];
        for (const h of segment.hops) {
          const pc20Forward = isPC20ImportWithFunds(h.params);
          if (
            hasExecutablePayloadData(h?.params?.data) ||
            h?.params?.value ||
            pc20Forward
          ) {
            const hopCalls = buildExecuteMulticall({
              execute: (pc20Forward
                ? assertLegacyFunds(toExecuteParams(h.params))
                : {
                    to: h.params.to as `0x${string}`,
                    value: h.params.value,
                    data: h.params.data,
                  }) as LegacyExecuteParams,
              ueaAddress,
              allowSelfValueCall: true,
            });
            mergedHopMulticalls.push(...hopCalls);
          }
        }
        if (mergedHopMulticalls.length > 0) {
          requiredNativeValue += sumMulticallNativeValue(mergedHopMulticalls);
          accumulatedPushMulticalls = [
            ...mergedHopMulticalls,
            ...accumulatedPushMulticalls,
          ];
        }
        // Primary hop carries the sourceChain / CEA address (shared across merged hops).
        const hop = segment.hops[0];
        const sourceChain = hop.sourceChain!;
        const ceaAddress = hop.ceaAddress || ueaAddress;
        let intermediatePayload: `0x${string}` = '0x';
        if (accumulatedPushMulticalls.length > 0) {
          const multicallPayload = buildMulticallPayloadData(
            ctx,
            ueaAddress,
            accumulatedPushMulticalls
          );
          // +1: the outbound tx consumes one nonce via execute()
          const nonce = (ueaNonce ?? BigInt(0)) + BigInt(1);
          intermediatePayload = isSvmChain(sourceChain)
            ? buildInboundUniversalPayloadSvm(multicallPayload, { nonce })
            : buildInboundUniversalPayload(multicallPayload, { nonce });
        }

        for (const segmentHop of segment.hops) {
          assertPC20ImportHasPayload(
            segmentHop.params,
            intermediatePayload !== '0x',
            `Cascaded Route 3 ${sourceChain}`
          );
        }

        // SVM chains: build SVM CPI payload instead of EVM CEA multicall
        if (isSvmChain(sourceChain)) {
          const lockerContract = CHAIN_INFO[sourceChain].lockerContract;
          if (!lockerContract) {
            throw new Error(
              `No SVM gateway program configured for chain ${sourceChain}`
            );
          }
          const programPk = new PublicKey(lockerContract);
          const gatewayProgramHex = ('0x' +
            Buffer.from(programPk.toBytes()).toString('hex')) as `0x${string}`;

          let drainAmount = BigInt(0);
          let tokenMintHex: `0x${string}` | undefined;
          const params = hop.params;
          if (params.funds?.amount && params.funds.amount > BigInt(0)) {
            drainAmount = params.funds.amount;
            const token = (params.funds as { token: MoveableToken }).token;
            if (token && token.address) {
              const mintPk = new PublicKey(token.address);
              tokenMintHex = ('0x' +
                Buffer.from(mintPk.toBytes()).toString('hex')) as `0x${string}`;
            }
          } else if (params.value && params.value > BigInt(0)) {
            drainAmount = params.value;
          }

          // Derive CEA PDA as revert recipient
          const ueaBytes = Buffer.from(ueaAddress.slice(2), 'hex');
          const [ceaPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('push_identity'), ueaBytes],
            programPk
          );
          const ceaPdaHex = ('0x' +
            Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;

          // Build SVM payload with intermediate Push Chain payload embedded.
          // PC20 burns use the gateway's dedicated send_universal_tx shape;
          // SPL/native drains keep send_universal_tx_to_uea.
          const extraPayload =
            intermediatePayload !== '0x'
              ? new Uint8Array(
                  Buffer.from(intermediatePayload.slice(2), 'hex')
                )
              : undefined;
          const pc20 = (params as { _pc20?: ResolvedPC20 })._pc20;
          let svmPayload: `0x${string}`;
          if (isPC20ImportWithFunds(params) && pc20) {
            const mintPk = new PublicKey(pc20.originAddress);
            const fields = buildPC20SvmCeaBurnPayload({
              gatewayProgram: programPk,
              mint: mintPk,
              ceaAuthority: ceaPda,
              ceaAta: deriveAtaPubkey(ceaPda, mintPk),
              ueaAddress,
              amount: drainAmount,
              pushPayload: extraPayload ?? new Uint8Array(0),
            });
            svmPayload = encodeSvmExecutePayload(fields);
          } else {
            svmPayload = encodeSvmCeaToUeaPayload({
              gatewayProgramHex,
              drainAmount,
              tokenMintHex,
              revertRecipientHex: ceaPdaHex,
              extraPayload,
            });
          }
          assertSvmPayloadWithinRelayLimit(
            svmPayload,
            `Route 3 SVM cascade ${sourceChain}`
          );

          const svmBurnAmount = segment.totalBurnAmount || BigInt(0);
          const outboundReq = buildOutboundRequest(
            gatewayProgramHex,
            segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            svmBurnAmount,
            segment.gasLimit ?? BigInt(0),
            svmPayload,
            ueaAddress,
            segment.maxPCForGas ?? BigInt(0),
            gasPriceForOutboundRequest(sourceChain)
          );

          const inboundGasFee = segment.gasFee || BigInt(0);
          let svmInboundFallback: bigint;
          if (effectiveUeaBalance > BigInt(0)) {
            svmInboundFallback =
              effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
          } else {
            svmInboundFallback = inboundGasFee * BigInt(1000000);
          }
          let svmInboundNativeValue =
            svmNativeValueBySegment.get(segment) ??
            perOutboundNativeValue ??
            svmInboundFallback;
          // SDK 5.2 R3-style Case C bump: when the inbound segment's sizing
          // is C, top up the swap budget by the overflow. No bridge-swap —
          // R3 has no destination funds delivery.
          if (
            segment.sizing?.category === 'C' &&
            segment.sizing.overflowNativePc > BigInt(0)
          ) {
            const bumped =
              svmInboundNativeValue + segment.sizing.overflowNativePc;
            printLog(
              ctx,
              `composeCascade — INBOUND_FROM_CEA (SVM) Case C: bumping nativeValueForGas from ${svmInboundNativeValue} to ${bumped} (overflow=${segment.sizing.overflowNativePc})`
            );
            svmInboundNativeValue = bumped;
          }
          const outboundMulticalls = buildOutboundApprovalAndCall({
            prc20Token:
              segment.prc20Token ||
              getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
            gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
            burnAmount: svmBurnAmount,
            gasFee: inboundGasFee,
            nativeValueForGas: svmInboundNativeValue,
            gatewayPcAddress,
            outboundRequest: outboundReq,
          });
          requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

          accumulatedPushMulticalls = [...outboundMulticalls];
          break;
        }

        // EVM path: Build CEA multicall: sendUniversalTxToUEA(payload).
        // CEA handles ERC20 gateway approval internally.
        const ceaMulticalls: MultiCall[] = [];

        // Add primary hop's own CEA operations if any
        // (e.g., approve + swap before bridging back)
        if (hop.ceaMulticalls && hop.ceaMulticalls.length > 0) {
          ceaMulticalls.push(...hop.ceaMulticalls);
        }

        // Aggregate token/amount across all merged hops so the single
        // sendUniversalTxToUEA call carries the combined forward amount.
        // For multi-hop R3 segments (same sourceChain), ERC20 funds across
        // hops must resolve to the same token — otherwise this path can't
        // express it in one call and the caller should split manually.
        let tokenAddress: `0x${string}` = ZERO_ADDRESS as `0x${string}`;
        let amount = BigInt(0);
        for (const mergedHop of segment.hops) {
          const hParams = mergedHop.params;
          if (hParams.funds?.amount) {
            const token = (hParams.funds as { token: MoveableToken }).token;
            if (token) {
              if (token.mechanism === 'native') {
                amount += hParams.funds.amount;
              } else {
                const addr = token.address as `0x${string}`;
                if (
                  tokenAddress !== (ZERO_ADDRESS as `0x${string}`) &&
                  tokenAddress.toLowerCase() !== addr.toLowerCase()
                ) {
                  throw new Error(
                    `composeCascade: merged R3 hops target different ERC20 tokens (${tokenAddress} vs ${addr}); split into separate executeTransactions batches`
                  );
                }
                tokenAddress = addr;
                amount += hParams.funds.amount;
              }
            }
          } else if (hParams.value && hParams.value > BigInt(0)) {
            amount += hParams.value;
          }
        }

        // Build sendUniversalTxToUEA self-call on CEA. CEA self-calls must
        // always use value=0; native funds are spent from the CEA balance.
        const sendCall = buildSendUniversalTxToUEA(
          ceaAddress,
          tokenAddress,
          amount,
          intermediatePayload,
          ceaAddress
        );
        ceaMulticalls.push(sendCall);

        // Wrap CEA multicall in outbound from Push Chain
        const ceaPayload = buildCeaMulticallPayload(ceaMulticalls);

        // The nested outbound back to the source chain needs a non-zero
        // gasLimit — UGPC.sendUniversalTxOutbound reverts with
        // "Missing or invalid parameters" on 0. When the hop didn't supply
        // one (typical for a pure-R3 leg composed inside a cascade), fall
        // back to the EVM Route 3 default.
        const effectiveGasLimit =
          segment.gasLimit && segment.gasLimit > BigInt(0)
            ? segment.gasLimit
            : DEFAULT_CEA_TO_PUSH_GAS_LIMIT;
        const outboundReq = buildOutboundRequest(
          ceaAddress,
          segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          segment.totalBurnAmount || BigInt(0),
          effectiveGasLimit,
          ceaPayload,
          ueaAddress,
          segment.maxPCForGas ?? BigInt(0),
          gasPriceForOutboundRequest(sourceChain)
        );

        const inboundGasFee = segment.gasFee || BigInt(0);
        let evmInboundFallback: bigint;
        if (effectiveUeaBalance > BigInt(0)) {
          evmInboundFallback =
            effectiveUeaBalance / BigInt(Math.max(numOutbounds, 1));
        } else {
          evmInboundFallback = inboundGasFee * BigInt(1000000);
        }
        let evmInboundNativeValue =
          evmNativeValueBySegment.get(segment) ??
          perOutboundNativeValue ??
          evmInboundFallback;
        // SDK 5.2 R3-style Case C bump: when the inbound segment's sizing
        // is C, top up the swap budget by the overflow. No bridge-swap —
        // R3 has no destination funds delivery.
        if (
          segment.sizing?.category === 'C' &&
          segment.sizing.overflowNativePc > BigInt(0)
        ) {
          const bumped =
            evmInboundNativeValue + segment.sizing.overflowNativePc;
          printLog(
            ctx,
            `composeCascade — INBOUND_FROM_CEA (EVM) Case C: bumping nativeValueForGas from ${evmInboundNativeValue} to ${bumped} (overflow=${segment.sizing.overflowNativePc})`
          );
          evmInboundNativeValue = bumped;
        }
        const outboundMulticalls = buildOutboundApprovalAndCall({
          prc20Token:
            segment.prc20Token ||
            getNativePRC20ForChain(sourceChain, ctx.pushNetwork),
          gasToken: segment.gasToken || (ZERO_ADDRESS as `0x${string}`),
          burnAmount: segment.totalBurnAmount || BigInt(0),
          gasFee: inboundGasFee,
          nativeValueForGas: evmInboundNativeValue,
          gatewayPcAddress,
          outboundRequest: outboundReq,
        });
        requiredNativeValue += sumMulticallNativeValue(outboundMulticalls);

        // Reset accumulated -- everything is now inside this outbound
        accumulatedPushMulticalls = [...outboundMulticalls];
        break;
      }
    }
  }

  if (requiredNativeValue > BigInt(0)) {
    runPreflight({
      ctx,
      ueaAddress,
      ueaBalance: effectiveUeaBalance,
      requiredValue: requiredNativeValue,
      gasReserve: CASCADE_GAS_RESERVE,
      pathTag: 'CASCADE',
      enforceGasCheck,
    });
  }

  return {
    multicalls: accumulatedPushMulticalls,
    requiredNativeValue,
  };
}

export async function composeCascade(
  ctx: OrchestratorContext,
  segments: CascadeSegment[],
  ueaAddress: `0x${string}`,
  ueaBalance?: bigint,
  ueaNonce?: bigint
): Promise<MultiCall[]> {
  const result = await composeCascadeDetailed(
    ctx,
    segments,
    ueaAddress,
    ueaBalance,
    ueaNonce
  );
  return result.multicalls;
}

// ============================================================================
// createCascadedBuilder
// ============================================================================

function txHashFromProgressEvent(event: ProgressEvent): string {
  const response = event.response as {
    txHash?: string;
    pushTxHash?: string;
    rootTxHash?: string;
    response?: Array<{ hash?: string }>;
  } | null;
  return (
    response?.txHash ??
    response?.pushTxHash ??
    response?.rootTxHash ??
    response?.response?.[0]?.hash ??
    ''
  );
}

async function withMultihopRootProgressMapping<T>(
  ctx: OrchestratorContext,
  run: () => Promise<T>
): Promise<T> {
  const originalHook = ctx.progressHook;
  if (!originalHook) return run();

  ctx.progressHook = (event) => {
    if (event.id === PROGRESS_HOOK.SEND_TX_199_01) {
      originalHook(
        PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_99](
          txHashFromProgressEvent(event)
        )
      );
      return;
    }
    originalHook(event);
  };

  try {
    return await run();
  } finally {
    ctx.progressHook = originalHook;
  }
}

export function createCascadedBuilder(
  ctx: OrchestratorContext,
  preparedTxs: PreparedUniversalTx[],
  callbacks: CascadeCallbacks,
  defaultEventHook?: (
    event: import('../../progress-hook/progress-hook.types').ProgressEvent
  ) => void,
  options?: Pick<CascadeExecutionOptions, 'enforceGasCheck'>
): { send: () => Promise<CascadedTxResponse> } {
  return {
    send: async (): Promise<CascadedTxResponse> => {
      const ueaAddress = computeUEAOffchain(ctx);

      // Extract HopDescriptors
      const hops = preparedTxs.map((tx) => tx._hop);

      // Prepared PC20 imports pin registry-derived identity into their
      // payload. Re-check that binding immediately before any route is
      // executed or composed; a stale descriptor must never reach broadcast.
      await Promise.all(
        hops.map((hop) =>
          revalidatePreparedPC20(
            ctx,
            hop.params as unknown as LegacyExecuteParams
          )
        )
      );

      const enforceGasCheck =
        options?.enforceGasCheck === true ||
        hops.some((hop) => hop.params.options?.enforceGasCheck === true);
      const withCascadeOptions = (params: UniversalExecuteParams) =>
        enforceGasCheck
          ? {
              ...params,
              options: {
                ...params.options,
                enforceGasCheck: true,
              },
            }
          : params;

      // Classify into segments
      const segments = classifyIntoSegments(hops);

      // Check if this is a single-hop Route 1 (no composition needed)
      if (preparedTxs.length === 1 && preparedTxs[0].route === 'UOA_TO_PUSH') {
        const response = await callbacks.executeFn(
          withCascadeOptions(hops[0].params)
        );
        const singleRoute1Result: CascadedTxResponse = {
          initialTxHash: response.hash,
          initialTxResponse: response,
          hops: [
            {
              hopIndex: 0,
              route: hops[0].route,
              executionChain: getPushChainForNetwork(ctx.pushNetwork),
              status: 'confirmed',
              txHash: response.hash,
            },
          ],
          hopCount: 1,
          finalTxHash: response.hash,
          waitForAll: async () => ({
            success: true,
            hops: [
              {
                hopIndex: 0,
                route: hops[0].route,
                executionChain: getPushChainForNetwork(ctx.pushNetwork),
                status: 'confirmed' as const,
                txHash: response.hash,
              },
            ],
            finalTxHash: response.hash,
            finalTxResponse: singleRoute1Result,
          }),
          wait: async (opts) => singleRoute1Result.waitForAll(opts),
        };
        return singleRoute1Result;
      }

      // Check if single-hop Route 2 (just execute directly)
      if (preparedTxs.length === 1 && preparedTxs[0].route === 'UOA_TO_CEA') {
        const response = await callbacks.executeFn(
          withCascadeOptions(hops[0].params)
        );
        const targetChain =
          hops[0].targetChain || getPushChainForNetwork(ctx.pushNetwork);
        const singleRoute2Result: CascadedTxResponse = {
          initialTxHash: response.hash,
          initialTxResponse: response,
          hops: [
            {
              hopIndex: 0,
              route: hops[0].route,
              executionChain: targetChain,
              status: 'confirmed',
              txHash: response.hash,
            },
          ],
          hopCount: 1,
          finalTxHash: response.hash,
          waitForAll: async () => ({
            success: true,
            hops: [
              {
                hopIndex: 0,
                route: hops[0].route,
                executionChain: targetChain,
                status: 'confirmed' as const,
                txHash: response.hash,
              },
            ],
            finalTxHash: response.hash,
            finalTxResponse: singleRoute2Result,
          }),
          wait: async (opts) => singleRoute2Result.waitForAll(opts),
        };
        return singleRoute2Result;
      }

      // Multi-hop: compose cascade bottom-to-top
      // Fetch UEA balance + nonce so composeCascade can allocate native value and build inbound payloads
      const ueaBalance = await ctx.pushClient.getBalance(ueaAddress);
      const ueaCodeCascade = await ctx.pushClient.publicClient.getCode({
        address: ueaAddress,
      });
      const ueaNonceCascade =
        ueaCodeCascade !== undefined
          ? await getUEANonce(ctx, ueaAddress)
          : BigInt(0);
      let composedMulticalls: MultiCall[];
      let cascadeRequiredNativeValue = BigInt(0);
      try {
        const composed = await composeCascadeDetailed(
          ctx,
          segments,
          ueaAddress,
          ueaBalance,
          ueaNonceCascade,
          { enforceGasCheck }
        );
        composedMulticalls = composed.multicalls;
        cascadeRequiredNativeValue = composed.requiredNativeValue;
      } catch (err) {
        // Pre-flight or per-segment min-swap failure inside composeCascade
        // throws before the cascade ever broadcasts. Fire 999-02 with the
        // segmentIndex (1-indexed for the failedAt slot) so consumers see a
        // terminal "cascade failed" frame instead of the stream stopping
        // silently after 203-04.
        if (err instanceof InsufficientUEABalanceError) {
          const failedHopIndex = err.segmentIndex ?? 0;
          fireProgressHook(
            ctx,
            PROGRESS_HOOK.SEND_TX_999_02,
            failedHopIndex + 1,
            preparedTxs.length,
            err.message
          );
        }
        throw err;
      }

      // Execute the composed multicall as a single Push Chain tx
      const executeParams: ExecuteParams = {
        to: ueaAddress,
        value: cascadeRequiredNativeValue,
        data: composedMulticalls,
      };
      const rootFundsDeposit = getRootFundsDeposit(hops);
      if (rootFundsDeposit) {
        executeParams.funds = rootFundsDeposit;
      }

      const response = await withMultihopRootProgressMapping(ctx, () =>
        callbacks.executeFn(executeParams)
      );

      // Build hop info for tracking
      const hopInfos: CascadeHopInfo[] = hops.map((hop, index) => ({
        hopIndex: index,
        route: hop.route,
        executionChain:
          hop.targetChain ||
          hop.sourceChain ||
          getPushChainForNetwork(ctx.pushNetwork),
        status: 'pending' as const,
      }));

      // Mark first hop as submitted
      if (hopInfos.length > 0) {
        hopInfos[0].status = 'submitted';
        hopInfos[0].txHash = response.hash;
      }

      const cascadeResponse: CascadedTxResponse = {
        initialTxHash: response.hash,
        initialTxResponse: response,
        hops: hopInfos,
        hopCount: hops.length,
        waitForAll: async (
          opts?: CascadeTrackOptions
        ): Promise<CascadeCompletionResult> => {
          const {
            pollingIntervalMs = 10000,
            timeout = 300000,
            progressHook: cascadeProgressHook,
            eventHook = defaultEventHook,
          } = opts || {};
          const startTime = Date.now();

          // Per-hop progress emission. Fans out cascade markers to BOTH the
          // explicit `eventHook` (passed into waitForAll) AND the init-time
          // `ctx.progressHook` (set on PushChain.initialize), deduping if the
          // two are the same reference. This is the bridge that lets UI-kit
          // consumers — which only listen on `ctx.progressHook` — receive the
          // cascade-level marker stream (001 / 002-xx / 203-xx / 204-xx /
          // 209-xx / 299-01 / 999-xx) without having to manually wire
          // `eventHook` at every call site. Drops events whose id is '' (the
          // no-op sentinel returned by pickWaitHooks for R4/unknown routes).
          const emitHopEvent = (
            event: import('../../progress-hook/progress-hook.types').ProgressEvent
          ) => {
            dispatchCascadeProgressEvent(event, eventHook, ctx.progressHook);
          };

          // ---- Multichain (multi-hop) cascade markers (001 / 002 / 999) ----
          // Only fire when this is genuinely a multi-hop cascade. Single-hop
          // R1/R2 takes the early-return paths above and never reaches here,
          // but guard explicitly in case someone wires a 1-element prepared list.
          const totalHops = hopInfos.length;
          const isMulti = totalHops > 1;
          const chainLabels = hops.map((h) =>
            String(
              h.targetChain ??
                h.sourceChain ??
                getPushChainForNetwork(ctx.pushNetwork)
            )
          );
          const signerOriginChain = String(
            ctx.universalSigner.account.chain ?? 'origin'
          );

          const emitHopStart = (hopIndex0: number) => {
            if (!isMulti) return;
            const n = hopIndex0 + 1;
            const fromChain =
              hopIndex0 === 0 ? signerOriginChain : chainLabels[hopIndex0 - 1];
            const toChain = chainLabels[hopIndex0];
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_01](
                n,
                totalHops,
                fromChain,
                toChain
              )
            );
          };
          const emitHopComplete = (hopIndex0: number) => {
            if (!isMulti) return;
            const n = hopIndex0 + 1;
            if (n >= totalHops) return; // skip after final hop — 999-01 takes over
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_002_99_99](n, totalHops)
            );
          };
          const currentFinalTxHash = () =>
            [...hopInfos]
              .reverse()
              .find((hop) => hop.status === 'confirmed' && hop.txHash)
              ?.txHash ?? response.hash;
          const emitCascadeSuccess = () => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_01](
                totalHops,
                currentFinalTxHash()
              )
            );
          };
          const emitCascadeFailed = (
            failedIdx0: number,
            errMsg: string,
            txHash?: string,
            pushTxHash?: string
          ) => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_02](
                failedIdx0 + 1,
                totalHops,
                errMsg,
                txHash,
                pushTxHash
              )
            );
          };
          const emitCascadeTimeout = (
            failedIdx0: number,
            txHash?: string,
            pushTxHash?: string
          ) => {
            if (!isMulti) return;
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_999_03](
                failedIdx0 + 1,
                totalHops,
                txHash,
                pushTxHash
              )
            );
          };
          const emitRouteIntermediateComplete = (
            hop: CascadeHopInfo,
            txHash?: string
          ) => {
            if (!isMulti) return;
            const n = hop.hopIndex + 1;
            if (n >= totalHops) return; // final terminal is 999-01
            const resolvedTxHash = txHash ?? hop.txHash ?? response.hash;
            if (hop.route === 'UOA_TO_PUSH') {
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_199_99](resolvedTxHash)
              );
              return;
            }
            if (hop.route === 'UOA_TO_CEA') {
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_299_99](
                  hop.executionChain,
                  resolvedTxHash
                )
              );
              return;
            }
            if (hop.route === 'CEA_TO_PUSH') {
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_99](
                  hop.executionChain,
                  resolvedTxHash
                )
              );
            }
          };
          const buildCompletionResult = (
            success: boolean,
            failedAt?: number
          ): CascadeCompletionResult => {
            const finalTxHash = currentFinalTxHash();
            cascadeResponse.finalTxHash = finalTxHash;
            return {
              success,
              hops: hopInfos,
              finalTxHash,
              finalTxResponse: cascadeResponse,
              ...(failedAt !== undefined ? { failedAt } : {}),
            };
          };

          if (isMulti) {
            emitHopEvent(
              PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_001](totalHops, chainLabels)
            );
          }

          try {
            // 1. Wait for initial Push Chain tx confirmation
            // Emit 002-01 for hop 0 ONLY when the first hop is a Push (R1) tx —
            // its "start" coincides with submitting the composed Push tx. For
            // cascades that begin with R2/R3, the per-outbound/inbound branches
            // below own the emitHopStart for hop 0 to avoid a duplicate marker.
            if (hopInfos[0]?.route === 'UOA_TO_PUSH') {
              emitHopStart(0);
            }
            cascadeProgressHook?.({
              hopIndex: 0,
              route: hopInfos[0]?.route || 'UOA_TO_PUSH',
              chain: getPushChainForNetwork(ctx.pushNetwork),
              status: 'waiting',
              elapsed: Date.now() - startTime,
            });

            await response.wait();

            const ceaToPushIndex = hopInfos.findIndex(
              (h, index) =>
                h.route === 'CEA_TO_PUSH' && !isNativeSeedOnlyHop(hops[index])
            );
            const isAfterCeaToPush = (index: number) =>
              ceaToPushIndex >= 0 && index > ceaToPushIndex;
            const rootOutboundIndexByHop = buildRootOutboundIndexByHop(
              segments,
              hops
            );

            const trackOutboundHops = async (
              outboundHops: CascadeHopInfo[],
              pushTxHash: string,
              resolvedSubTxId?: string,
              outboundIndexByHop?: Map<number, number>,
              trackingOptions?: { deferCeaToPushCompletion?: boolean }
            ): Promise<CascadeCompletionResult | null> => {
              if (outboundHops.length === 0) return null;

              const shouldDeferHopCompletion = (hop?: CascadeHopInfo) =>
                trackingOptions?.deferCeaToPushCompletion === true &&
                hop?.route === 'CEA_TO_PUSH';

              if (outboundHops.length === 1) {
                const hop = outboundHops[0];
                const hopHooks = pickWaitHooks(hop.route);
                const remainingTimeout = timeout - (Date.now() - startTime);
                if (remainingTimeout <= 0) {
                  hop.status = 'failed';
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: 'timeout',
                    elapsed: Date.now() - startTime,
                  });
                  emitHopEvent(
                    hopHooks.timeout(
                      hop.executionChain,
                      Date.now() - startTime,
                      pushTxHash
                    )
                  );
                  emitCascadeTimeout(hop.hopIndex, undefined, pushTxHash);
                  return buildCompletionResult(false, hop.hopIndex);
                }

                emitHopStart(hop.hopIndex);
                emitHopEvent(hopHooks.awaiting(hop.executionChain, pushTxHash));

                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: hop.executionChain,
                  status: 'polling',
                  elapsed: Date.now() - startTime,
                });

                let lastEmittedStatus: string | undefined;

                try {
                  const outboundDetails = await callbacks.waitForOutboundTxFn(
                    pushTxHash,
                    {
                      initialWaitMs: Math.min(60000, remainingTimeout),
                      pollingIntervalMs,
                      timeout: remainingTimeout,
                      _resolvedSubTxId: resolvedSubTxId,
                      _expectedDestinationChain: hop.executionChain,
                      ...(outboundIndexByHop
                        ? {
                            _outboundIndex:
                              outboundIndexByHop.get(hop.hopIndex) ?? 0,
                          }
                        : {}),
                      progressHook: (event) => {
                        cascadeProgressHook?.({
                          hopIndex: hop.hopIndex,
                          route: hop.route,
                          chain: hop.executionChain,
                          status: event.status as
                            | 'waiting'
                            | 'polling'
                            | 'found'
                            | 'confirmed'
                            | 'failed'
                            | 'timeout',
                          elapsed: Date.now() - startTime,
                        });
                        if (
                          event.status === 'polling' &&
                          lastEmittedStatus !== 'polling'
                        ) {
                          lastEmittedStatus = 'polling';
                          emitHopEvent(
                            hopHooks.polling(
                              hop.executionChain,
                              event.elapsed,
                              pushTxHash
                            )
                          );
                        }
                      },
                    }
                  );
                  // `outboundDetails.externalTxHash` from waitForOutboundTx
                  // is the raw `0x`-hex form (internal canonical). For the
                  // user-facing `hop.txHash`, `hop.outboundDetails`, and
                  // cascade progress event, normalize to base58 for SVM so
                  // consumers can paste it straight into a Solana explorer.
                  const displayTxHash =
                    toExternalTxHashDisplay(
                      outboundDetails.destinationChain,
                      outboundDetails.externalTxHash
                    ) ?? outboundDetails.externalTxHash;
                  const userFacingOutboundDetails = {
                    ...outboundDetails,
                    externalTxHash: displayTxHash,
                  };
                  const deferHopCompletion = shouldDeferHopCompletion(hop);
                  hop.status = deferHopCompletion ? 'pending' : 'confirmed';
                  hop.txHash = displayTxHash;
                  hop.outboundDetails = userFacingOutboundDetails;
                  if (!deferHopCompletion) {
                    if (isMulti) {
                      emitRouteIntermediateComplete(hop, displayTxHash);
                    } else {
                      emitHopEvent(hopHooks.success(userFacingOutboundDetails));
                    }
                    emitHopComplete(hop.hopIndex);
                  }
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: deferHopCompletion ? 'found' : 'confirmed',
                    txHash: displayTxHash,
                    elapsed: Date.now() - startTime,
                  });
                } catch (err) {
                  const errMsg =
                    err instanceof Error ? err.message : String(err);
                  const isTimeout = errMsg.startsWith(
                    'Timeout waiting for outbound transaction'
                  );
                  const failedExternalTxHash = (
                    err as { externalTxHash?: string }
                  )?.externalTxHash;
                  const failedDisplayTxHash =
                    toExternalTxHashDisplay(
                      hop.executionChain,
                      failedExternalTxHash
                    ) ?? failedExternalTxHash;
                  emitHopEvent(
                    isTimeout
                      ? hopHooks.timeout(
                          hop.executionChain,
                          remainingTimeout,
                          pushTxHash
                        )
                      : hopHooks.failed(hop.executionChain, errMsg, {
                          pushTxHash,
                          txHash: failedDisplayTxHash,
                        })
                  );
                  if (isTimeout) {
                    emitCascadeTimeout(
                      hop.hopIndex,
                      failedDisplayTxHash,
                      pushTxHash
                    );
                  } else {
                    emitCascadeFailed(
                      hop.hopIndex,
                      errMsg,
                      failedDisplayTxHash,
                      pushTxHash
                    );
                  }
                  if (failedDisplayTxHash) hop.txHash = failedDisplayTxHash;
                  hop.status = 'failed';
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: hop.executionChain,
                    status: 'failed',
                    txHash: failedDisplayTxHash,
                    elapsed: Date.now() - startTime,
                  });
                  return buildCompletionResult(false, hop.hopIndex);
                }
              } else {
                for (const outHop of outboundHops) {
                  emitHopStart(outHop.hopIndex);
                  emitHopEvent(
                    pickWaitHooks(outHop.route).awaiting(
                      outHop.executionChain,
                      pushTxHash
                    )
                  );
                }

                const perHopLastStatus = new Map<number, string>();
                const confirmedHops = new Set<number>();

                const allOutboundDetails =
                  await callbacks.waitForAllOutboundTxsFn(
                    pushTxHash,
                    outboundHops,
                    {
                      initialWaitMs: Math.min(
                        60000,
                        timeout - (Date.now() - startTime)
                      ),
                      pollingIntervalMs,
                      timeout: timeout - (Date.now() - startTime),
                      _resolvedSubTxId: resolvedSubTxId,
                      ...(outboundIndexByHop
                        ? { _outboundIndexByHop: outboundIndexByHop }
                        : {}),
                      progressHook: (event: any) => {
                        const matchedHop = outboundHops.find(
                          (h) => h.hopIndex === event.hopIndex
                        );
                        const eventHooks = pickWaitHooks(matchedHop?.route);
                        const deferHopCompletion =
                          shouldDeferHopCompletion(matchedHop);
                        const progressStatus =
                          deferHopCompletion && event.status === 'confirmed'
                            ? 'found'
                            : event.status;
                        cascadeProgressHook?.({
                          hopIndex: event.hopIndex,
                          route: event.route,
                          chain: event.chain,
                          status: progressStatus as
                            | 'waiting'
                            | 'polling'
                            | 'found'
                            | 'confirmed'
                            | 'failed'
                            | 'timeout',
                          txHash: event.txHash,
                          elapsed: Date.now() - startTime,
                        });

                        const prev = perHopLastStatus.get(event.hopIndex);
                        if (event.status === 'polling' && prev !== 'polling') {
                          perHopLastStatus.set(event.hopIndex, 'polling');
                          emitHopEvent(
                            eventHooks.polling(
                              matchedHop?.executionChain ?? event.chain ?? '',
                              Date.now() - startTime,
                              pushTxHash
                            )
                          );
                        }

                        if (
                          event.status === 'confirmed' &&
                          event.txHash &&
                          !confirmedHops.has(event.hopIndex)
                        ) {
                          // waitForAllOutboundTxsV2 populates hop.outboundDetails
                          // on the matched hop before emitting 'confirmed' (see
                          // outbound-sync.ts:348-355). Auto-promotion paths
                          // without a txHash are skipped by the `event.txHash`
                          // guard above, so we only reach here with full details.
                          if (matchedHop?.outboundDetails) {
                            confirmedHops.add(event.hopIndex);
                            if (!deferHopCompletion) {
                              if (isMulti) {
                                emitRouteIntermediateComplete(
                                  matchedHop,
                                  event.txHash
                                );
                              } else {
                                emitHopEvent(
                                  eventHooks.success(matchedHop.outboundDetails)
                                );
                              }
                              emitHopComplete(event.hopIndex);
                            }
                          }
                        }
                      },
                    }
                  );

                if (!allOutboundDetails.success) {
                  const failedIdx = allOutboundDetails.failedAt ?? 0;
                  const failedHop = outboundHops.find(
                    (h) => h.hopIndex === failedIdx
                  );
                  const failMsg = failedHop
                    ? `Outbound failed for hop ${failedIdx} on ${failedHop.executionChain}`
                    : `Outbound cascade failed at hop ${failedIdx}`;
                  emitHopEvent(
                    pickWaitHooks(failedHop?.route).failed(
                      failedHop?.executionChain ?? '',
                      failMsg,
                      {
                        pushTxHash,
                        txHash: failedHop?.txHash,
                      }
                    )
                  );
                  emitCascadeFailed(
                    failedIdx,
                    failMsg,
                    failedHop?.txHash,
                    pushTxHash
                  );
                  return buildCompletionResult(false, failedIdx);
                }

                if (trackingOptions?.deferCeaToPushCompletion) {
                  for (const outHop of outboundHops) {
                    if (
                      shouldDeferHopCompletion(outHop) &&
                      outHop.outboundDetails
                    ) {
                      outHop.status = 'pending';
                    }
                  }
                }
              }
              return null;
            };

            // Mark only root Push Chain (Route 1) hops as confirmed. Route 1
            // hops after a Route 3 leg execute in the child inbound Push tx and
            // must wait for that child UTX to reach terminal success.
            for (const hop of hopInfos) {
              if (
                hop.route === 'CEA_TO_PUSH' &&
                isNativeSeedOnlyHop(hops[hop.hopIndex])
              ) {
                emitHopStart(hop.hopIndex);
                hop.status = 'confirmed';
                hop.txHash = response.hash;
                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: getPushChainForNetwork(ctx.pushNetwork),
                  status: 'confirmed',
                  txHash: response.hash,
                  elapsed: Date.now() - startTime,
                });
                emitHopComplete(hop.hopIndex);
              }
            }

            for (const hop of hopInfos) {
              if (
                hop.route === 'UOA_TO_PUSH' &&
                !isAfterCeaToPush(hop.hopIndex)
              ) {
                hop.status = 'confirmed';
                hop.txHash = response.hash;
                cascadeProgressHook?.({
                  hopIndex: hop.hopIndex,
                  route: hop.route,
                  chain: getPushChainForNetwork(ctx.pushNetwork),
                  status: 'confirmed',
                  txHash: response.hash,
                  elapsed: Date.now() - startTime,
                });
                emitHopComplete(hop.hopIndex);
              }
            }

            // 2. Track direct outbound hops (Route 2: UOA_TO_CEA) that belong
            // to the root Push UTX.
            const rootOutboundHops = hopInfos.filter(
              (h) =>
                (h.route === 'UOA_TO_CEA' && !isAfterCeaToPush(h.hopIndex)) ||
                (h.hopIndex === ceaToPushIndex &&
                  h.route === 'CEA_TO_PUSH' &&
                  CHAIN_INFO[h.executionChain]?.vm === VM.EVM)
            );
            const rootOutboundFailure = await trackOutboundHops(
              rootOutboundHops,
              response.hash,
              undefined,
              rootOutboundIndexByHop,
              { deferCeaToPushCompletion: true }
            );
            if (rootOutboundFailure) return rootOutboundFailure;

            let childInbound: InboundPushTxDetails | undefined;
            if (ceaToPushIndex >= 0) {
              const inboundHop = hopInfos[ceaToPushIndex];
              const hopHooks = pickWaitHooks(inboundHop.route);
              const remainingTimeout = timeout - (Date.now() - startTime);
              if (remainingTimeout <= 0) {
                inboundHop.status = 'failed';
                emitHopEvent(
                  hopHooks.timeout(
                    inboundHop.executionChain,
                    Date.now() - startTime,
                    response.hash
                  )
                );
                emitCascadeTimeout(inboundHop.hopIndex, undefined, response.hash);
                return buildCompletionResult(false, inboundHop.hopIndex);
              }

              const hasTrackedSourceOutbound =
                Boolean(inboundHop.outboundDetails) &&
                CHAIN_INFO[inboundHop.executionChain]?.vm === VM.EVM;

              if (!hasTrackedSourceOutbound) {
                emitHopStart(inboundHop.hopIndex);
                emitHopEvent(
                  hopHooks.awaiting(inboundHop.executionChain, response.hash)
                );
              }
              cascadeProgressHook?.({
                hopIndex: inboundHop.hopIndex,
                route: inboundHop.route,
                chain: inboundHop.executionChain,
                status: 'polling',
                txHash: inboundHop.txHash,
                elapsed: Date.now() - startTime,
              });

              let outboundLastStatus: string | undefined;
              let sourceOutboundDetails: OutboundTxDetails;
              try {
                if (hasTrackedSourceOutbound) {
                  sourceOutboundDetails =
                    inboundHop.outboundDetails as OutboundTxDetails;
                } else {
                  sourceOutboundDetails = await callbacks.waitForOutboundTxFn(
                    response.hash,
                    {
                      initialWaitMs: Math.min(60000, remainingTimeout),
                      pollingIntervalMs,
                      timeout: remainingTimeout,
                      _expectedDestinationChain: inboundHop.executionChain,
                      _outboundIndex:
                        rootOutboundIndexByHop.get(inboundHop.hopIndex) ?? 0,
                      progressHook: (event) => {
                        cascadeProgressHook?.({
                          hopIndex: inboundHop.hopIndex,
                          route: inboundHop.route,
                          chain: inboundHop.executionChain,
                          status: event.status as
                            | 'waiting'
                            | 'polling'
                            | 'found'
                            | 'confirmed'
                            | 'failed'
                            | 'timeout',
                          elapsed: Date.now() - startTime,
                        });
                        if (
                          event.status === 'polling' &&
                          outboundLastStatus !== 'polling'
                        ) {
                          outboundLastStatus = 'polling';
                          emitHopEvent(
                            hopHooks.polling(
                              inboundHop.executionChain,
                              event.elapsed,
                              response.hash
                            )
                          );
                        }
                      },
                    }
                  );
                }
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const isTimeout = errMsg.startsWith(
                  'Timeout waiting for outbound transaction'
                );
                const failedExternalTxHash = (
                  err as { externalTxHash?: string }
                )?.externalTxHash;
                const failedDisplayTxHash =
                  toExternalTxHashDisplay(
                    inboundHop.executionChain,
                    failedExternalTxHash
                  ) ?? failedExternalTxHash;
                emitHopEvent(
                  isTimeout
                    ? hopHooks.timeout(
                        inboundHop.executionChain,
                        remainingTimeout,
                        response.hash
                      )
                    : hopHooks.failed(inboundHop.executionChain, errMsg, {
                        pushTxHash: response.hash,
                        txHash: failedDisplayTxHash,
                      })
                );
                if (isTimeout)
                  emitCascadeTimeout(
                    inboundHop.hopIndex,
                    failedDisplayTxHash,
                    response.hash
                  );
                else
                  emitCascadeFailed(
                    inboundHop.hopIndex,
                    errMsg,
                    failedDisplayTxHash,
                    response.hash
                  );
                inboundHop.status = 'failed';
                if (failedDisplayTxHash)
                  inboundHop.txHash = failedDisplayTxHash;
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  txHash: failedDisplayTxHash,
                  elapsed: Date.now() - startTime,
                });
                return buildCompletionResult(false, inboundHop.hopIndex);
              }

              const displayExternalTxHash =
                toExternalTxHashDisplay(
                  sourceOutboundDetails.destinationChain,
                  sourceOutboundDetails.externalTxHash
                ) ?? sourceOutboundDetails.externalTxHash;
              inboundHop.outboundDetails = {
                ...sourceOutboundDetails,
                externalTxHash: displayExternalTxHash,
              };
              inboundHop.txHash = displayExternalTxHash;
              emitHopEvent(hopHooks.success(inboundHop.outboundDetails));
              emitHopEvent(
                PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_01](
                  inboundHop.executionChain,
                  response.hash
                )
              );

              let inboundLastStatus: string | undefined;
              const inboundRemainingTimeout =
                timeout - (Date.now() - startTime);
              try {
                childInbound = await (
                  callbacks.waitForInboundPushTxFn ??
                  ((externalTxHash, sourceChain, opts) =>
                    waitForInboundPushTx(
                      ctx,
                      externalTxHash,
                      sourceChain,
                      opts
                    ))
                )(
                  sourceOutboundDetails.externalTxHash,
                  inboundHop.executionChain,
                  {
                    initialWaitMs: Math.min(60000, inboundRemainingTimeout),
                    pollingIntervalMs,
                    timeout: inboundRemainingTimeout,
                    progressHook: (event) => {
                      if (
                        event.status === 'polling' &&
                        inboundLastStatus !== 'polling'
                      ) {
                        inboundLastStatus = 'polling';
                        emitHopEvent(
                          PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_310_02](
                            inboundHop.executionChain,
                            event.elapsedMs,
                            response.hash
                          )
                        );
                      }
                    },
                  }
                );
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const isTimeout = err instanceof InboundTimeoutError;
                emitHopEvent(
                  isTimeout
                    ? PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_03](
                        inboundHop.executionChain,
                        inboundRemainingTimeout,
                        'inbound',
                        response.hash
                      )
                    : PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
                        errMsg,
                        'inbound',
                        inboundHop.executionChain,
                        undefined,
                        response.hash
                      )
                );
                if (isTimeout)
                  emitCascadeTimeout(inboundHop.hopIndex, undefined, response.hash);
                else
                  emitCascadeFailed(
                    inboundHop.hopIndex,
                    errMsg,
                    undefined,
                    response.hash
                  );
                inboundHop.status = 'failed';
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  elapsed: Date.now() - startTime,
                });
                return buildCompletionResult(false, inboundHop.hopIndex);
              }

              if (childInbound.status !== 'confirmed') {
                const failMsg =
                  childInbound.errorMessage ??
                  'inbound execution failed on Push Chain';
                inboundHop.status = 'failed';
                inboundHop.txHash =
                  childInbound.pushTxHash || displayExternalTxHash;
                emitHopEvent(
                  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_02](
                    failMsg,
                    'inbound',
                    inboundHop.executionChain,
                    undefined,
                    response.hash,
                    childInbound.pushTxHash || undefined
                  )
                );
                emitCascadeFailed(
                  inboundHop.hopIndex,
                  failMsg,
                  childInbound.pushTxHash || undefined,
                  response.hash
                );
                cascadeProgressHook?.({
                  hopIndex: inboundHop.hopIndex,
                  route: inboundHop.route,
                  chain: inboundHop.executionChain,
                  status: 'failed',
                  txHash: inboundHop.txHash,
                  elapsed: Date.now() - startTime,
                });
                return buildCompletionResult(false, inboundHop.hopIndex);
              }

              inboundHop.status = 'confirmed';
              inboundHop.txHash =
                childInbound.pushTxHash || displayExternalTxHash;
              if (isMulti) {
                emitRouteIntermediateComplete(inboundHop, inboundHop.txHash);
              } else {
                emitHopEvent(
                  PROGRESS_HOOKS[PROGRESS_HOOK.SEND_TX_399_01](
                    inboundHop.executionChain,
                    childInbound.pushTxHash
                  )
                );
              }
              emitHopComplete(inboundHop.hopIndex);
              cascadeProgressHook?.({
                hopIndex: inboundHop.hopIndex,
                route: inboundHop.route,
                chain: inboundHop.executionChain,
                status: 'confirmed',
                txHash: inboundHop.txHash,
                elapsed: Date.now() - startTime,
              });
            }

            if (childInbound) {
              for (const hop of hopInfos) {
                if (
                  hop.route === 'UOA_TO_PUSH' &&
                  isAfterCeaToPush(hop.hopIndex)
                ) {
                  emitHopStart(hop.hopIndex);
                  hop.status = 'confirmed';
                  hop.txHash = childInbound.pushTxHash;
                  cascadeProgressHook?.({
                    hopIndex: hop.hopIndex,
                    route: hop.route,
                    chain: getPushChainForNetwork(ctx.pushNetwork),
                    status: 'confirmed',
                    txHash: childInbound.pushTxHash,
                    elapsed: Date.now() - startTime,
                  });
                  emitRouteIntermediateComplete(hop, childInbound.pushTxHash);
                  emitHopComplete(hop.hopIndex);
                }
              }

              const childOutboundHops = hopInfos.filter(
                (h) => h.route === 'UOA_TO_CEA' && isAfterCeaToPush(h.hopIndex)
              );
              const childOutboundFailure = await trackOutboundHops(
                childOutboundHops,
                childInbound.pushTxHash || response.hash,
                childInbound.childUtxId
              );
              if (childOutboundFailure) return childOutboundFailure;
            }

            emitCascadeSuccess();
            return buildCompletionResult(true);
          } catch (err) {
            const failedIdx = hopInfos.findIndex(
              (h) => h.status !== 'confirmed'
            );
            const errMsg = err instanceof Error ? err.message : String(err);
            const failedAt = failedIdx >= 0 ? failedIdx : 0;
            const failedTxHash = hopInfos[failedAt]?.txHash;
            const isTimeout = errMsg.startsWith('Timeout');
            if (isTimeout) {
              emitCascadeTimeout(failedAt, failedTxHash, response.hash);
            } else {
              emitCascadeFailed(failedAt, errMsg, failedTxHash, response.hash);
            }
            return buildCompletionResult(false, failedAt);
          }
        },
        wait: async (opts?: CascadeTrackOptions) =>
          cascadeResponse.waitForAll(opts),
      };

      return cascadeResponse;
    },
  };
}
