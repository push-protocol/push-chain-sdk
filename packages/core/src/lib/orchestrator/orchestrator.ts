import { TransactionReceipt } from 'viem';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  ConversionQuote,
  MoveableToken,
  PayableToken,
} from '../constants/tokens';
import type { AccountStatus, UniversalTxResponse } from './orchestrator.types';
import { PROGRESS_HOOK, ProgressEvent } from '../progress-hook/progress-hook.types';
import { PushClient } from '../push-client/push-client';
import { normalizePublicErrorMessage } from '../formatters';
import type { UniversalAccount, UniversalSigner } from '../universal/universal.types';
import {
  ExecuteParams,
  UniversalExecuteParams,
  PreparedUniversalTx,
  CascadedTxResponse,
  CascadeHopInfo,
  CascadeExecutionOptions,
  TransactionExecutionOptions,
  RescueFundsParams,
} from './orchestrator.types';
import { detectRoute, isChainTarget, TransactionRoute } from './route-detector';
import { hasExecutablePayloadData } from './data-utils';
import {
  type OrchestratorContext,
  printLog as _printLog, fireProgressHook as _fireProgressHook,
  transformToUniversalTxReceipt as _transformToUniversalTxReceipt,
  computeUEAOffchain as _computeUEAOffchain, computeUEA as _computeUEA,
  waitForOutboundTx as _waitForOutboundTx, waitForAllOutboundTxsV2 as _waitForAllOutboundTxsV2,
  waitForInboundPushTx as _waitForInboundPushTx,
  OUTBOUND_INITIAL_WAIT_MS, OUTBOUND_POLL_INTERVAL_MS, OUTBOUND_MAX_TIMEOUT_MS,
  INBOUND_INITIAL_WAIT_MS, INBOUND_MAX_TIMEOUT_MS,
  quoteExactOutput as _quoteExactOutput,
  getAccountStatus as _getAccountStatus, upgradeAccount as _upgradeAccount, migrateCEA as _migrateCEA,
  trackTransaction as _trackTransaction, transformToUniversalTxResponse as _transformToUniversalTxResponse,
  type ResponseBuilderCallbacks,
  prepareTransaction as _prepareTransaction,
  createCascadedBuilder as _createCascadedBuilder,
  type CascadeCallbacks,
  rescueFunds as _rescueFunds,
  executeFundsOnly as _executeFundsOnly,
  executeFundsWithPayload as _executeFundsWithPayload,
  executeStandardPayload as _executeStandardPayload,
  executeMultiChain as _executeMultiChain,
  queryOutboundGasFee as _queryOutboundGasFee,
  extractUniversalSubTxIdFromTx as _extractUniversalSubTxIdFromTx,
  extractAllUniversalSubTxIds as _extractAllUniversalSubTxIds,
} from './internals';
import { gateFunds } from './internals/pc20/gate';

type ProgressHook = (progress: ProgressEvent) => void;
type WrappedProgressHook = ProgressHook & {
  __pushPerCallHook?: ProgressHook;
};

export class Orchestrator {
  // These fields are accessed via `this.ctx` (OrchestratorContext cast) by internal modules
  private _pushClient: PushClient | null = null;
  private _pushClientOptions: { rpcUrls: string[]; network: PUSH_NETWORK } | null = null;
  /* @internal */ get pushClient(): PushClient {
    if (!this._pushClient) {
      this._pushClient = new PushClient(this._pushClientOptions!);
    }
    return this._pushClient;
  }
  /* @internal */ accountStatusCache: AccountStatus | null = null;
  /* @internal */ accountStatusReadyPromise?: Promise<void>;
  /**
   * @internal Mirrors `OrchestratorContext.currentRoute` — set at the top of
   * execute()/trackTransaction() so emission sites pick the right ID range.
   */
  /* @internal */ currentRoute?: TransactionRoute;

  private get ctx(): OrchestratorContext { return this as unknown as OrchestratorContext; }
  private _getResponseCallbacks(): ResponseBuilderCallbacks {
    return {
      trackTransaction: this.trackTransaction.bind(this),
      waitForOutboundTx: (hash: string, opts?: any) => _waitForOutboundTx(this.ctx, hash, opts),
      transformToUniversalTxReceipt: (receipt: TransactionReceipt, resp: UniversalTxResponse) => _transformToUniversalTxReceipt(receipt, resp),
      printLog: (msg: string) => _printLog(this.ctx, msg),
      outboundConstants: { initialWaitMs: OUTBOUND_INITIAL_WAIT_MS, pollingIntervalMs: OUTBOUND_POLL_INTERVAL_MS, maxTimeoutMs: OUTBOUND_MAX_TIMEOUT_MS },
      inboundConstants: { initialWaitMs: INBOUND_INITIAL_WAIT_MS, pollingIntervalMs: OUTBOUND_POLL_INTERVAL_MS, maxTimeoutMs: INBOUND_MAX_TIMEOUT_MS },
    };
  }

  private _getCascadeCallbacks(): CascadeCallbacks {
    return {
      executeFn: this.execute.bind(this),
      waitForOutboundTxFn: (hash: string, opts?: any) => _waitForOutboundTx(this.ctx, hash, opts),
      waitForInboundPushTxFn: (hash: string, sourceChain: string, opts?: any) => _waitForInboundPushTx(this.ctx, hash, sourceChain, opts),
      waitForAllOutboundTxsFn: (hash: string, hops: CascadeHopInfo[], opts: any) => _waitForAllOutboundTxsV2(this.ctx, hash, hops, opts),
    };
  }

  constructor(
    private readonly universalSigner: UniversalSigner,
    private pushNetwork: PUSH_NETWORK,
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {},
    private readonly printTraces = false,
    private progressHook?: (progress: ProgressEvent) => void
  ) {
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

    const pushChainRPCs: string[] =
      this.rpcUrls[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    this._pushClientOptions = {
      rpcUrls: pushChainRPCs,
      network: pushNetwork,
    };
  }

  /**
   * Read-only accessors for current Orchestrator configuration
   */
  public getNetwork(): PUSH_NETWORK {
    return this.pushNetwork;
  }

  public getRpcUrls(): Partial<Record<CHAIN, string[]>> {
    return this.rpcUrls;
  }

  public getPrintTraces(): boolean {
    return this.printTraces;
  }

  public getProgressHook(): ((progress: ProgressEvent) => void) | undefined {
    return this.progressHook;
  }

  // =========================================================================
  // Account Status & UEA Upgrade
  // =========================================================================

  /**
   * Fetches account status including UEA deployment state and version info.
   * Results are cached — pass forceRefresh to bypass cache.
   */
  async getAccountStatus(
    options?: { forceRefresh?: boolean }
  ): Promise<AccountStatus> {
    return _getAccountStatus(this.ctx, options);
  }

  /**
   * Upgrades the UEA to the latest implementation version.
   * Sends MsgMigrateUEA Cosmos message with EIP-712 signed MigrationPayload.
   * The UEA contract delegates to the UEAMigration contract to update implementation.
   */
  async upgradeAccount(
    options?: { progressHook?: (progress: ProgressEvent) => void }
  ): Promise<void> {
    return _upgradeAccount(this.ctx, options);
  }



  /**
   * Migrate the CEA contract on an external chain to the latest version.
   * Sends a MIGRATION_SELECTOR payload via Route 2 to trigger CEA upgrade.
   *
   * @param chain - The external chain where the CEA should be migrated
   * @returns Transaction response
   */
  async migrateCEA(chain: CHAIN): Promise<UniversalTxResponse> {
    return _migrateCEA(this.ctx, chain, this.execute.bind(this));
  }

  /**
   * Rescue stuck funds on a source chain.
   * When a CEA-to-Push inbound transaction fails, tokens get locked in the
   * Vault on the source chain. This triggers a manual revert via TSS to
   * release those funds back to the user.
   *
   * @param params - RescueFundsParams with universalTxId and prc20 token
   * @returns Transaction response
   */
  async rescueFunds(params: RescueFundsParams): Promise<UniversalTxResponse> {
    return _rescueFunds(this.ctx, params, this.execute.bind(this));
  }

  /**
   * Executes a transaction with automatic route detection.
   * Routes 2-4 (multi-chain) delegate to prepareTransaction().send().
   * Route 1 (Push Chain) dispatches to extracted sub-flow modules.
   */
  async execute(
    params: ExecuteParams | UniversalExecuteParams,
    options?: TransactionExecutionOptions
  ): Promise<UniversalTxResponse> {
    const inlineProgressHook = params.progressHook;
    if (options || inlineProgressHook) {
      params = {
        ...params,
        options: {
          ...params.options,
          ...(inlineProgressHook ? { progressHook: inlineProgressHook } : {}),
          ...options,
        },
      } as ExecuteParams | UniversalExecuteParams;
    }

    const perCallHook = params.options?.progressHook;
    const originalExecuteHook = this.progressHook;
    const currentHook = this.progressHook as WrappedProgressHook | undefined;
    const shouldWrapPerCallHook =
      !!perCallHook &&
      perCallHook !== currentHook &&
      currentHook?.__pushPerCallHook !== perCallHook;
    const attachPerCallHookForWait = (
      response: UniversalTxResponse
    ): UniversalTxResponse => {
      if (perCallHook && response._setProgressHookNoReplay) {
        response._setProgressHookNoReplay(perCallHook);
      }
      return response;
    };

    if (shouldWrapPerCallHook) {
      const baseHook = this.progressHook;
      const wrappedHook = ((event: ProgressEvent) => {
        if (baseHook && baseHook !== perCallHook) {
          baseHook(event);
        }
        perCallHook(event);
      }) as WrappedProgressHook;
      wrappedHook.__pushPerCallHook = perCallHook;
      this.progressHook = wrappedHook;
    }

    // Snapshot the caller's active route — `executeMultiChain` recurses into
    // this same method for R2/R3's inner Push-side execution, and without
    // snapshot/restore the recursive `detectRoute(params)` would clobber the
    // outer R2/R3 route with UOA_TO_PUSH (the inner `to` is a string, no
    // `from`), defeating R1-suppression in fireProgressHook.
    const previousRoute = this.currentRoute;
    const isRecursiveInnerCall = previousRoute !== undefined;

    let detectedRoute: TransactionRoute;
    try {
      detectedRoute = detectRoute(params as UniversalExecuteParams);
    } catch {
      detectedRoute = TransactionRoute.UOA_TO_PUSH;
    }

    // Don't downgrade an outer R2/R3/R4 route when the recursive inner call
    // resolves to R1 — keep the outer perspective so emission stays consistent.
    const shouldPreserveOuter =
      isRecursiveInnerCall &&
      previousRoute !== TransactionRoute.UOA_TO_PUSH &&
      detectedRoute === TransactionRoute.UOA_TO_PUSH;
    this.currentRoute = shouldPreserveOuter ? previousRoute : detectedRoute;

    // Reset the terminal-emitted flag at the start of each execute call so
    // the outer catch below can tell whether a route handler already fired
    // a terminal-ish error hook (104-04 / 204-04 / 304-04 / 199-02) and
    // should suppress the second terminal (199-02 / 299-02 / 399-02).
    this.ctx._routeTerminalEmitted = false;

    try {
      // Lazy UEA upgrade check
      try {
        if (!this.accountStatusCache || !this.accountStatusCache.uea.loaded) {
          await (this.accountStatusReadyPromise ?? this.getAccountStatus());
        }
        // If background resolved but cache still empty (timeout/error), fetch fresh
        if (!this.accountStatusCache || !this.accountStatusCache.uea.loaded) {
          await this.getAccountStatus();
        }
        if (
          this.accountStatusCache?.uea.deployed &&
          this.accountStatusCache?.uea.requiresUpgrade
        ) {
          await this.upgradeAccount({ progressHook: this.progressHook });
        }
      } catch (err) {
        _printLog(this.ctx, `Lazy UEA upgrade check failed: ${err instanceof Error ? err.message : String(err)}. Proceeding with transaction.`);
      }

      // Check if this is a multi-chain request (has ChainTarget or from.chain)
      const isMultiChain =
        isChainTarget(params.to) || ('from' in params && params.from?.chain);

      if (isMultiChain) {
        try {
          // PC20 gate for the multi-chain routes. Resolves and validates before
          // the route handlers quote gas or approve anything — a chain/address
          // mismatch must cost the caller nothing.
          const gatedParams = (await gateFunds(
            this.ctx,
            params as ExecuteParams
          )) as unknown as UniversalExecuteParams;
          return attachPerCallHookForWait(
            await _executeMultiChain(
              this.ctx,
              gatedParams,
              this.execute.bind(this)
            )
          );
        } catch (err) {
          // R2/R3/R4 outer catch — fires the route-correct terminal failure
          // hook (299-02 / 399-02) when an inner route handler throws BEFORE
          // its own try/catch around executeFn (e.g. pre-flight balance
          // check throws). Without this, the hook stream ends mid-flight and
          // consumers have no terminal close-out marker.
          if (!isRecursiveInnerCall && !this.ctx._routeTerminalEmitted) {
            const errMessage = normalizePublicErrorMessage(err);
            // Lift any structured `decodedError` off the typed error so the
            // formatter's optional payload field gets populated.
            const decodedError =
              err instanceof Error && (err as unknown as { decodedError?: unknown }).decodedError
                ? ((err as unknown as { decodedError: unknown }).decodedError as
                    | { name?: string; hint?: string; selector?: string; decoded?: string }
                    | undefined)
                : undefined;
            if (this.currentRoute === TransactionRoute.CEA_TO_PUSH) {
              _fireProgressHook(
                this.ctx,
                PROGRESS_HOOK.SEND_TX_399_02,
                errMessage,
                'push',
                undefined,
                decodedError
              );
            } else if (this.currentRoute === TransactionRoute.UOA_TO_CEA) {
              // 299-02 needs the target chain — pull it off ChainTarget.
              const targetChain =
                isChainTarget(params.to) && params.to ? params.to.chain : 'unknown';
              _fireProgressHook(
                this.ctx,
                PROGRESS_HOOK.SEND_TX_299_02,
                targetChain,
                errMessage,
                decodedError
              );
            } else {
              _fireProgressHook(
                this.ctx,
                PROGRESS_HOOK.SEND_TX_199_02,
                errMessage,
                decodedError
              );
            }
          }
          throw err;
        }
      }

      // Standard Push Chain execution (Route 1)
      const execute = params as ExecuteParams;
      const hasData = hasExecutablePayloadData(execute.data);
      const eventBuffer: ProgressEvent[] = [];
      const originalHook = this.progressHook;
      this.progressHook = (event: ProgressEvent) => {
        eventBuffer.push(event);
        if (originalHook) originalHook(event);
      };

      try {
        const rcb = () => this._getResponseCallbacks();
        if (execute.funds) {
          // Single PC20 gate. Downstream builders only ever see the legacy
          // PRC20/native shape; the PC20 branch is added here in Phase 2.
          const legacy = await gateFunds(this.ctx, execute);
          // PC20 imports never take the raw funds-only path, on EITHER VM.
          // The gateway prepends the PC20 selector to the (empty) payload and
          // classifies the RESULT as FUNDS_AND_PAYLOAD, and the chain's
          // inbound decode hard-fails on that selector-only payload with no
          // revert — the wrapper is already burned (same "0x" vs "" guard as
          // the R3 brick). The payload path always carries a real forward
          // payload (UEA multicall transfer to `to`), which classifies and
          // decodes legitimately — the same always-forward mitigation R3
          // ships on both VMs.
          //
          // This was previously gated on VM.SVM, which left EVM wrapper burns
          // on the unsafe path: observed on Donut as a burned wrapper whose
          // canonical token was never unlocked. The brick is at ballot
          // finalization — NormalizeForTxType (x/uexecutor/types/inbound.go)
          // strips the selector, gets '0x', which passes its `!= ""` empty
          // check, and DecodeRawPayload('0x') then fails — so no handler runs
          // at all: no deploy, no credit, and no INBOUND_REVERT. With a real
          // forward payload the decode succeeds and the funds_and_payload
          // handler deploys the UEA and credits normally.
          const pc20Import = legacy._pc20?.direction === 'import';
          return attachPerCallHookForWait(
            !hasData && !pc20Import
              ? await _executeFundsOnly(this.ctx, legacy, eventBuffer, rcb)
              : await _executeFundsWithPayload(this.ctx, legacy, eventBuffer, rcb)
          );
        }
        return attachPerCallHookForWait(
          await _executeStandardPayload(this.ctx, execute, eventBuffer, rcb)
        );
      } catch (err) {
        const errMessage = normalizePublicErrorMessage(err);
        // Only the outermost frame emits the terminal error hook, and it picks
        // the route-correct ID. Recursive inner frames just re-throw so the
        // outer catch drives emission — avoids double-firing 199/299/399 events.
        // Additionally, if an inner route handler already fired a terminal-ish
        // error (104-04/204-04/304-04/199-02 via execute-standard), the flag is
        // set on ctx and we skip emitting a second terminal here.
        if (!isRecursiveInnerCall && !this.ctx._routeTerminalEmitted) {
          // For R3, the failure surfaced during execute-phase (pre-wait) is a
          // Push-chain-side failure — tag phase='push' so 399-02 renders the
          // correct "Push Chain Tx Failed" title instead of the inbound copy.
          if (this.currentRoute === TransactionRoute.CEA_TO_PUSH) {
            _fireProgressHook(
              this.ctx,
              PROGRESS_HOOK.SEND_TX_399_02,
              errMessage,
              'push'
            );
          } else {
            const terminalId =
              this.currentRoute === TransactionRoute.UOA_TO_CEA
                ? PROGRESS_HOOK.SEND_TX_299_02
                : PROGRESS_HOOK.SEND_TX_199_02;
            _fireProgressHook(this.ctx, terminalId, errMessage);
          }
        }
        throw err;
      } finally {
        // Restore original progressHook
        this.progressHook = originalHook;
      }
    } finally {
      if (shouldWrapPerCallHook) {
        this.progressHook = originalExecuteHook;
      }
      // Restore the caller's route so a recursive inner R1 execute doesn't
      // leak its UOA_TO_PUSH route back to the outer R2/R3 frame.
      this.currentRoute = previousRoute;
    }
  }

  /**
   * Prepare a universal transaction without executing it.
   * Returns a PreparedUniversalTx that can be chained with thenOn() or sent with send().
   *
   * @param params - Universal execution parameters
   * @param options - Optional transaction behavior switches.
   * @returns PreparedUniversalTx with chaining capabilities
   */
  async prepareTransaction(
    params: UniversalExecuteParams,
    options?: TransactionExecutionOptions
  ): Promise<PreparedUniversalTx> {
    if (options) {
      params = {
        ...params,
        options: {
          ...params.options,
          ...options,
        },
      };
    }
    return _prepareTransaction(this.ctx, params, this._getCascadeCallbacks());
  }


  /**
   * Creates a cascaded transaction builder for nested multi-chain execution.
   * The cascade composes all hops bottom-to-top into a single Push Chain tx.
   *
   * @param preparedTxs - Array of prepared transactions
   * @param options - Optional per-call options. `progressHook` is additive with
   *   the init-time hook from `PushChain.initialize` and receives every
   *   `ProgressEvent` emitted during this cascade (pre-flight, broadcast, and
   *   tracking). Dedups by reference if it matches the init-time hook.
   * @returns Object with send() method
   */
  createCascadedBuilder(
    preparedTxs: PreparedUniversalTx[],
    options?: CascadeExecutionOptions
  ): { send: () => Promise<CascadedTxResponse> } {
    const perCallHook = options?.progressHook;
    const cascadeOptions =
      options?.enforceGasCheck === true
        ? { enforceGasCheck: true }
        : undefined;
    if (!perCallHook) {
      return _createCascadedBuilder(
        this.ctx,
        preparedTxs,
        this._getCascadeCallbacks(),
        undefined,
        cascadeOptions
      );
    }

    // Wrap ctx.progressHook for the synchronous send() phase — captures every
    // fireProgressHook(ctx, ...) call during pre-flight, composeCascade, and
    // the Push Chain broadcast. Restored when send() resolves/rejects so the
    // wrapper doesn't leak across calls.
    //
    // For the asynchronous tracking phase (waitForAll), we pass perCallHook as
    // the cascade builder's `defaultEventHook` — waitForAll falls back to it
    // when callers don't pass their own `eventHook`, and the existing
    // `dispatchCascadeProgressEvent` path delivers events to BOTH that hook
    // and ctx.progressHook (the init-time hook, restored by then) with
    // reference-dedup.
    const innerBuilder = _createCascadedBuilder(
      this.ctx,
      preparedTxs,
      this._getCascadeCallbacks(),
      perCallHook,
      cascadeOptions
    );

    return {
      send: async () => {
        const originalHook = this.progressHook;
        const wrapped = (event: ProgressEvent) => {
          if (originalHook && originalHook !== perCallHook) {
            originalHook(event);
          }
          perCallHook(event);
        };
        this.progressHook = wrapped;
        try {
          return await innerBuilder.send();
        } finally {
          this.progressHook = originalHook;
        }
      },
    };
  }

  /**
   * Queries gas fee for an outbound transaction from the UniversalCore contract.
   */
  async queryOutboundGasFee(
    prc20Token: `0x${string}`,
    gasLimit: bigint,
    destinationChain?: CHAIN
  ): Promise<{ gasToken: `0x${string}`; gasFee: bigint; protocolFee: bigint; nativeValueForGas: bigint; gasPrice: bigint; gasLimitUsed: bigint }> {
    return _queryOutboundGasFee(this.ctx, prc20Token, gasLimit, destinationChain);
  }

/**
   * Extracts the first universal sub-tx ID from a Push Chain transaction's Cosmos events.
   */
  async extractUniversalSubTxIdFromTx(
    pushChainTxHash: string
  ): Promise<string | null> {
    return _extractUniversalSubTxIdFromTx(this.ctx, pushChainTxHash);
  }

  /**
   * Extracts all universal sub-tx IDs from a cascaded Push Chain transaction.
   */
  async extractAllUniversalSubTxIds(
    pushChainTxHash: string
  ): Promise<string[]> {
    return _extractAllUniversalSubTxIds(this.ctx, pushChainTxHash);
  }

  /**
   * Tracks a transaction by hash on Push Chain and returns UniversalTxResponse.
   * Reconstructs and replays SEND-TX-* progress events for completed transactions.
   *
   * @param txHash - Transaction hash to track. A Push Chain root hash by
   *   default; when `options.chain` is a non-Push chain, an origin/source-leg
   *   hash (a source EVM tx hash or a Solana signature) that is resolved to the
   *   universal transaction via the universal-tx detector.
   * @param options - Tracking options (chain, progressHook, waitForCompletion, advanced config)
   * @returns Promise resolving to UniversalTxResponse with wait() and progressHook() methods
   * @throws If `options.chain` is provided but is not a supported chain (not present in CHAIN_INFO)
   * @throws If a source-leg hash cannot be resolved to a universal transaction on Push Chain
   */
  async trackTransaction(
    txHash: string,
    options?: import('./orchestrator.types').TrackTransactionOptions
  ): Promise<UniversalTxResponse> {
    return _trackTransaction(this.ctx, txHash, options, this._getResponseCallbacks());
  }


  /**
   * Computes UEA for given UniversalAccount
   * @dev - This fn calls a view fn of Factory Contract
   * @dev - Don't use this fn in production - only used for testing
   * @returns UEA Address with Deployment Status
   */
  async computeUEA(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    return _computeUEA(this.ctx);
  }

  computeUEAOffchain(): `0x${string}` {
    return _computeUEAOffchain(this.ctx);
  }

  // TODO: Fix this fn - It needs to get UOA for a given UEA
  getUOA(): UniversalAccount {
    return {
      chain: this.universalSigner.account.chain,
      address: this.universalSigner.account.address,
    };
  }

  /**
   * Quotes exact-output on Uniswap V3 for EVM origin chains using QuoterV2.
   * Returns the minimum required input (amountIn) to receive the target amountOut.
   */
  public async _quoteExactOutput(
    amountOut: bigint,
    {
      from,
      to,
    }: {
      from: PayableToken | undefined;
      to: MoveableToken | undefined;
    }
  ): Promise<ConversionQuote> {
    return _quoteExactOutput(this.ctx, amountOut, { from, to });
  }

}
