/**
 * Unit tests for tx-transformer.ts and gas-calculator.ts internals
 */
import { CHAIN } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { UniversalTxStatus } from '../../generated/uexecutor/v1/types';
import type { UniversalTxV2 } from '../../generated/uexecutor/v2/types';
import type { Inbound, PCTx } from '../../generated/uexecutor/v1/types';
import { TransactionRoute } from '../route-detector';
import type { UniversalTxReceipt, UniversalTxResponse } from '../orchestrator.types';
import {
  transformToUniversalTxReceipt,
  reconstructProgressEvents,
  detectRouteFromUniversalTxData,
} from '../internals/tx-transformer';
import {
  ensureErc20Allowance,
  calculateGasAmountFromAmountOutMinETH,
  calculateNativeAmountForDeposit,
} from '../internals/gas-calculator';
import type { OrchestratorContext } from '../internals/context';
import type { ConversionQuote, PayableToken, MoveableToken } from '../../constants/tokens';

// ============================================================================
// Helpers: Minimal mock factories
// ============================================================================

function makeViemReceipt(overrides: Record<string, any> = {}) {
  return {
    transactionHash: '0xabc123' as `0x${string}`,
    blockNumber: BigInt(100),
    blockHash: '0xblockhash',
    transactionIndex: 0,
    contractAddress: null as string | null,
    gasUsed: BigInt(21000),
    cumulativeGasUsed: BigInt(21000),
    logs: [],
    logsBloom: '0x00',
    status: 'success' as 'success' | 'reverted',
    ...overrides,
  };
}

function makeUniversalTxResponse(overrides: Record<string, any> = {}): UniversalTxResponse {
  return {
    hash: '0xabc123',
    origin: 'eip155:11155111:0xSenderAddr',
    blockNumber: BigInt(100),
    blockHash: '0xblockhash',
    transactionIndex: 0,
    chainId: '42101',
    from: '0xFromAddress',
    to: '0xToAddress',
    nonce: 1,
    data: '0x',
    value: BigInt(0),
    gasLimit: BigInt(21000),
    gasPrice: BigInt(1000),
    accessList: [],
    wait: jest.fn(),
    progressHook: jest.fn(),
    type: '99',
    typeVerbose: 'universal',
    signature: { r: '0x', s: '0x', v: 27 } as any,
    ...overrides,
  } as UniversalTxResponse;
}

function makeInbound(overrides: Partial<Inbound> = {}): Inbound {
  return {
    sourceChain: 'eip155:11155111',
    txHash: '0xinboundTxHash',
    sender: '0xSender',
    recipient: '0xRecipient',
    amount: '1000000000000000000',
    assetAddr: '0xAsset',
    logIndex: '0',
    txType: 1,
    verificationData: '0x',
    isCea: false,
    rawPayload: '',
    isPc20: false,
    ...overrides,
  };
}

function makePcTx(overrides: Partial<PCTx> = {}): PCTx {
  return {
    txHash: '0xpcTxHash',
    sender: '0xSender',
    gasUsed: 21000,
    blockHeight: 100,
    status: 'SUCCESS',
    errorMsg: '',
    ...overrides,
  };
}

function makeUniversalTxV2(overrides: Partial<UniversalTxV2> = {}): UniversalTxV2 {
  return {
    id: 'utx-1',
    pcTx: [],
    outboundTx: [],
    universalStatus: UniversalTxStatus.PC_EXECUTED_SUCCESS,
    ...overrides,
  };
}

function makeMockOrchestratorContext(overrides: Record<string, any> = {}): OrchestratorContext {
  return {
    pushClient: {
      readContract: jest.fn(),
      pushToUSDC: jest.fn().mockReturnValue(BigInt(200000000)), // $2 in 8-dec
    } as any,
    universalSigner: {
      account: {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xOwnerAddress',
      },
    } as any,
    pushNetwork: 'TESTNET_DONUT' as any,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
    ...overrides,
  };
}

// ============================================================================
// tx-transformer.ts
// ============================================================================

describe('tx-transformer', () => {
  // --------------------------------------------------------------------------
  // transformToUniversalTxReceipt
  // --------------------------------------------------------------------------
  describe('transformToUniversalTxReceipt', () => {
    it('should map viem TransactionReceipt fields to UniversalTxReceipt', () => {
      const receipt = makeViemReceipt();
      const txResponse = makeUniversalTxResponse();

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.hash).toBe('0xabc123');
      expect(result.blockNumber).toBe(BigInt(100));
      expect(result.blockHash).toBe('0xblockhash');
      expect(result.transactionIndex).toBe(0);
      expect(result.from).toBe('0xFromAddress');
      expect(result.to).toBe('0xToAddress');
      expect(result.contractAddress).toBeNull();
      expect(result.gasPrice).toBe(BigInt(1000));
      expect(result.gasUsed).toBe(BigInt(21000));
      expect(result.cumulativeGasUsed).toBe(BigInt(21000));
      expect(result.logs).toEqual([]);
      expect(result.logsBloom).toBe('0x00');
      expect(result.status).toBe(1);
    });

    it('should set status=0 for reverted receipt', () => {
      const receipt = makeViemReceipt({ status: 'reverted' });
      const txResponse = makeUniversalTxResponse();

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.status).toBe(0);
    });

    it('should use contractAddress from receipt when present', () => {
      const receipt = makeViemReceipt({ contractAddress: '0xNewContract' });
      const txResponse = makeUniversalTxResponse();

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.contractAddress).toBe('0xNewContract');
    });

    it('should fallback to BigInt(0) when gasPrice is undefined', () => {
      const receipt = makeViemReceipt();
      const txResponse = makeUniversalTxResponse({ gasPrice: undefined });

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.gasPrice).toBe(BigInt(0));
    });

    it('should use raw from originalTxResponse when present', () => {
      const raw = { from: '0xRawFrom', to: '0xRawTo' };
      const receipt = makeViemReceipt();
      const txResponse = makeUniversalTxResponse({ raw });

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.raw).toEqual(raw);
    });

    it('should construct fallback raw when originalTxResponse.raw is undefined', () => {
      const receipt = makeViemReceipt();
      const txResponse = makeUniversalTxResponse({ raw: undefined });

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.raw).toEqual({
        from: '0xFromAddress',
        to: '0xToAddress',
      });
    });

    it('should pass through logs from receipt', () => {
      const logs = [{ address: '0xLog', topics: ['0xtopic1'], data: '0xdata' }];
      const receipt = makeViemReceipt({ logs });
      const txResponse = makeUniversalTxResponse();

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.logs).toEqual(logs);
    });

    it('should default logsBloom to 0x when receipt has no logsBloom', () => {
      const receipt = makeViemReceipt({ logsBloom: undefined });
      const txResponse = makeUniversalTxResponse();

      const result = transformToUniversalTxReceipt(receipt as any, txResponse);

      expect(result.logsBloom).toBe('0x');
    });
  });

  // --------------------------------------------------------------------------
  // reconstructProgressEvents
  // --------------------------------------------------------------------------
  describe('reconstructProgressEvents', () => {
    it('should always include SEND_TX_101, SEND_TX_102_01, SEND_TX_103_03_04', () => {
      const txResponse = makeUniversalTxResponse();

      const events = reconstructProgressEvents(txResponse);

      const ids = events.map((e) => e.id);
      expect(ids).toContain('SEND-TX-101');
      expect(ids).toContain('SEND-TX-102-01');
      expect(ids).toContain('SEND-TX-103-03-04');
    });

    it('should always end with a final event (success or error)', () => {
      const txResponse = makeUniversalTxResponse();

      const events = reconstructProgressEvents(txResponse);

      const lastEvent = events[events.length - 1];
      expect(['SEND-TX-199-01', 'SEND-TX-199-02']).toContain(lastEvent.id);
    });

    it('should include UEA resolution events for non-Push origins', () => {
      // origin = eip155:11155111:0x... => Ethereum Sepolia, not Push
      const txResponse = makeUniversalTxResponse({
        origin: 'eip155:11155111:0xSenderAddr',
      });

      const events = reconstructProgressEvents(txResponse);
      const ids = events.map((e) => e.id);

      expect(ids).toContain('SEND-TX-103-01');
      expect(ids).toContain('SEND-TX-103-02');
    });

    it('should NOT include UEA resolution events for Push Chain origins', () => {
      const pushChainId = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId;
      const txResponse = makeUniversalTxResponse({
        origin: `eip155:${pushChainId}:0xSenderAddr`,
      });

      const events = reconstructProgressEvents(txResponse);
      const ids = events.map((e) => e.id);

      expect(ids).not.toContain('SEND-TX-103-01');
      expect(ids).not.toContain('SEND-TX-103-02');
    });

    // R1 reconstruction emits only the safe backbone (101, 102-01/02,
    // 103-01/02 for external origins, 107, 199-01/02). Sub-path hooks
    // (104-xx signature, 105-xx fee-lock, 106-xx funds-bridge) are
    // intentionally omitted because R1 has no UniversalTx registration
    // on Push Chain, so we can't tell the three live sub-paths apart
    // from universalTxData alone. Callers who want the full live sequence
    // register progressHook at initialize() time or via tx.progressHook(cb)
    // on the original response.
    it('should NOT include sub-path-specific events in R1 reconstruction', () => {
      const txResponse = makeUniversalTxResponse({
        origin: 'eip155:11155111:0xSenderAddr',
      });
      const universalTxData = makeUniversalTxV2({
        inboundTx: makeInbound({ amount: '5000000000000000000' }),
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const ids = events.map((e) => e.id);

      // Signature-path hooks
      expect(ids).not.toContain('SEND-TX-104-01');
      expect(ids).not.toContain('SEND-TX-104-02');
      expect(ids).not.toContain('SEND-TX-104-03');
      // Fee-lock hooks
      expect(ids).not.toContain('SEND-TX-105-01');
      expect(ids).not.toContain('SEND-TX-105-02');
      // Funds-bridge hooks
      expect(ids).not.toContain('SEND-TX-106-01');
      expect(ids).not.toContain('SEND-TX-106-02');
      expect(ids).not.toContain('SEND-TX-106-03');
      expect(ids).not.toContain('SEND-TX-106-04');
      expect(ids).not.toContain('SEND-TX-106-05');
      expect(ids).not.toContain('SEND-TX-106-06');
    });

    it('should include broadcasting event (SEND_TX_107)', () => {
      const txResponse = makeUniversalTxResponse();

      const events = reconstructProgressEvents(txResponse);
      const ids = events.map((e) => e.id);

      expect(ids).toContain('SEND-TX-107');
    });

    it('should emit error event for OUTBOUND_FAILED status', () => {
      const txResponse = makeUniversalTxResponse();
      const universalTxData = makeUniversalTxV2({
        universalStatus: UniversalTxStatus.OUTBOUND_FAILED,
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-199-02');
      expect(lastEvent.level).toBe('ERROR');
      expect(lastEvent.message).toContain('Outbound transaction failed');
    });

    it('should emit error event when pcTx status is FAILED', () => {
      const txResponse = makeUniversalTxResponse();
      const universalTxData = makeUniversalTxV2({
        pcTx: [makePcTx({ status: 'FAILED', errorMsg: 'out of gas' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-199-02');
      expect(lastEvent.level).toBe('ERROR');
      expect(lastEvent.message).toContain('out of gas');
    });

    it('should emit success event for successful transactions', () => {
      const txResponse = makeUniversalTxResponse();
      const universalTxData = makeUniversalTxV2({
        pcTx: [makePcTx({ status: 'SUCCESS' })],
        universalStatus: UniversalTxStatus.PC_EXECUTED_SUCCESS,
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-199-01');
      expect(lastEvent.level).toBe('SUCCESS');
    });

    it('should parse origin with only namespace (no address part)', () => {
      const txResponse = makeUniversalTxResponse({
        origin: 'eip155:11155111',
      });

      // Should not throw; falls back to from as the origin address
      const events = reconstructProgressEvents(txResponse);
      const firstEvent = events[0];

      expect(firstEvent.id).toBe('SEND-TX-101');
      // The message should contain the from address as fallback
      expect(firstEvent.message).toContain('0xFromAddress');
    });

    it('should handle FAILED pcTx with empty errorMsg', () => {
      const txResponse = makeUniversalTxResponse();
      const universalTxData = makeUniversalTxV2({
        pcTx: [makePcTx({ status: 'FAILED', errorMsg: '' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-199-02');
      expect(lastEvent.message).toContain('Unknown error');
    });

    it('should emit success when universalTxData is undefined', () => {
      const txResponse = makeUniversalTxResponse();

      const events = reconstructProgressEvents(txResponse, undefined);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-199-01');
    });

    // ------------------------------------------------------------------
    // R2/R3 narrowing — only pcTx.FAILED emits the reconstructed terminal;
    // universalStatus=OUTBOUND_FAILED with a successful pcTx must leave the
    // intermediate marker so wait() emits 299-02/399-02 with phase='outbound'
    // (and source-chain context) instead of double-firing the terminal.
    // ------------------------------------------------------------------

    it('R2 reconstruction: pcTx.FAILED emits 299-02 terminal', () => {
      const txResponse = makeUniversalTxResponse({
        route: TransactionRoute.UOA_TO_CEA,
      });
      const universalTxData = makeUniversalTxV2({
        pcTx: [makePcTx({ status: 'FAILED', errorMsg: 'revert reason' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-299-02');
      expect(lastEvent.level).toBe('ERROR');
    });

    it('R2 reconstruction: universalStatus=OUTBOUND_FAILED without pcFailed does not emit terminal failure', () => {
      const txResponse = makeUniversalTxResponse({
        route: TransactionRoute.UOA_TO_CEA,
      });
      const universalTxData = makeUniversalTxV2({
        universalStatus: UniversalTxStatus.OUTBOUND_FAILED,
        pcTx: [makePcTx({ status: 'SUCCESS' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const ids = events.map((e) => e.id);

      expect(ids).not.toContain('SEND-TX-299-02');
    });

    it('R3 reconstruction: pcTx.FAILED emits 399-02 terminal with phase=push', () => {
      const txResponse = makeUniversalTxResponse({
        route: TransactionRoute.CEA_TO_PUSH,
      });
      const universalTxData = makeUniversalTxV2({
        pcTx: [makePcTx({ status: 'FAILED', errorMsg: 'revert reason' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const lastEvent = events[events.length - 1];

      expect(lastEvent.id).toBe('SEND-TX-399-02');
      expect(lastEvent.level).toBe('ERROR');
      expect(lastEvent.title).toBe('Push Chain Tx Failed');
    });

    it('R3 reconstruction: universalStatus=OUTBOUND_FAILED without pcFailed does not emit terminal failure', () => {
      const txResponse = makeUniversalTxResponse({
        route: TransactionRoute.CEA_TO_PUSH,
      });
      const universalTxData = makeUniversalTxV2({
        universalStatus: UniversalTxStatus.OUTBOUND_FAILED,
        pcTx: [makePcTx({ status: 'SUCCESS' })],
      });

      const events = reconstructProgressEvents(txResponse, universalTxData);
      const ids = events.map((e) => e.id);

      expect(ids).not.toContain('SEND-TX-399-02');
    });
  });

  // --------------------------------------------------------------------------
  // detectRouteFromUniversalTxData
  // --------------------------------------------------------------------------
  describe('detectRouteFromUniversalTxData', () => {
    it('should return undefined for undefined input', () => {
      expect(detectRouteFromUniversalTxData(undefined)).toBeUndefined();
    });

    it('should return UOA_TO_PUSH when no outbound and no inbound', () => {
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: undefined,
        universalStatus: UniversalTxStatus.PC_EXECUTED_SUCCESS,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.UOA_TO_PUSH);
    });

    it('should return UOA_TO_CEA when outbound present but no inbound', () => {
      const data = makeUniversalTxV2({
        outboundTx: [
          {
            destinationChain: 'eip155:11155111',
            recipient: '0xRecip',
            amount: '1000',
            externalAssetAddr: '0xAsset',
            prc20AssetAddr: '0xPrc20',
            sender: '0xSender',
            payload: '0x',
            gasLimit: '21000',
            txType: 1,
            id: 'ob-1',
            outboundStatus: 0,
          },
        ] as any,
        inboundTx: undefined,
        universalStatus: UniversalTxStatus.OUTBOUND_PENDING,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should return CEA_TO_CEA when both outbound and inbound present', () => {
      const data = makeUniversalTxV2({
        outboundTx: [
          {
            destinationChain: 'eip155:11155111',
            recipient: '0xRecip',
            amount: '1000',
            externalAssetAddr: '0xAsset',
            prc20AssetAddr: '0xPrc20',
            sender: '0xSender',
            payload: '0x',
            gasLimit: '21000',
            txType: 1,
            id: 'ob-1',
            outboundStatus: 0,
          },
        ] as any,
        inboundTx: makeInbound(),
        universalStatus: UniversalTxStatus.OUTBOUND_SUCCESS,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.CEA_TO_CEA);
    });

    it('should return CEA_TO_PUSH when inbound present but no outbound', () => {
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: makeInbound(),
        universalStatus: UniversalTxStatus.INBOUND_SUCCESS,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.CEA_TO_PUSH);
    });

    it('should detect outbound route from status alone (OUTBOUND_PENDING, empty outboundTx)', () => {
      // Status indicates outbound even if outboundTx array is empty (e.g., not yet populated)
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: undefined,
        universalStatus: UniversalTxStatus.OUTBOUND_PENDING,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should detect outbound route from OUTBOUND_SUCCESS status', () => {
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: undefined,
        universalStatus: UniversalTxStatus.OUTBOUND_SUCCESS,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should detect outbound route from OUTBOUND_FAILED status', () => {
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: undefined,
        universalStatus: UniversalTxStatus.OUTBOUND_FAILED,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.UOA_TO_CEA);
    });

    it('should return CEA_TO_CEA when OUTBOUND_PENDING status and inbound present', () => {
      const data = makeUniversalTxV2({
        outboundTx: [],
        inboundTx: makeInbound(),
        universalStatus: UniversalTxStatus.OUTBOUND_PENDING,
      });

      expect(detectRouteFromUniversalTxData(data)).toBe(TransactionRoute.CEA_TO_CEA);
    });
  });
});

// ============================================================================
// gas-calculator.ts
// ============================================================================

// Mock PriceFetch so no real RPC calls are made
jest.mock('../../price-fetch/price-fetch', () => ({
  PriceFetch: jest.fn().mockImplementation(() => ({
    getPrice: jest.fn(),
  })),
}));

describe('gas-calculator', () => {
  // --------------------------------------------------------------------------
  // ensureErc20Allowance
  // --------------------------------------------------------------------------
  describe('ensureErc20Allowance', () => {
    const tokenAddress = '0xTokenAddress' as `0x${string}`;
    const spender = '0xSpenderAddress' as `0x${string}`;

    function makeMockEvmClient(currentAllowance: bigint) {
      return {
        readContract: jest.fn().mockResolvedValue(currentAllowance),
        writeContract: jest.fn().mockResolvedValue('0xApproveTxHash'),
        waitForConfirmations: jest.fn().mockResolvedValue(undefined),
      } as any;
    }

    it('should return immediately if existing allowance >= required', async () => {
      const evmClient = makeMockEvmClient(BigInt(1000));
      const ctx = makeMockOrchestratorContext();

      await ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(500));

      // readContract called once for allowance check, writeContract never called
      expect(evmClient.readContract).toHaveBeenCalledTimes(1);
      expect(evmClient.writeContract).not.toHaveBeenCalled();
    });

    it('should return immediately if existing allowance equals required', async () => {
      const evmClient = makeMockEvmClient(BigInt(1000));
      const ctx = makeMockOrchestratorContext();

      await ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(1000));

      expect(evmClient.writeContract).not.toHaveBeenCalled();
    });

    it('should set new allowance when current is zero', async () => {
      const evmClient = makeMockEvmClient(BigInt(0));
      const ctx = makeMockOrchestratorContext();

      await ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(500));

      // Should call writeContract once (set), not reset first
      // readContract: 1 initial check + 1 verification = 2
      expect(evmClient.writeContract).toHaveBeenCalledTimes(1);
      expect(evmClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'approve',
          args: [spender, BigInt(500)],
        })
      );
    });

    it('should reset then set allowance when current is non-zero but insufficient', async () => {
      // First read: initial check returns 100 (insufficient for 500)
      // Second read (verification after set): returns 500
      const evmClient = {
        readContract: jest.fn()
          .mockResolvedValueOnce(BigInt(100))  // initial allowance check
          .mockResolvedValueOnce(BigInt(500)), // verification after set
        writeContract: jest.fn().mockResolvedValue('0xTxHash'),
        waitForConfirmations: jest.fn().mockResolvedValue(undefined),
      } as any;
      const ctx = makeMockOrchestratorContext();

      await ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(500));

      // First write: reset to 0, second write: set to requiredAmount
      expect(evmClient.writeContract).toHaveBeenCalledTimes(2);
      expect(evmClient.writeContract).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          functionName: 'approve',
          args: [spender, BigInt(0)],
        })
      );
      expect(evmClient.writeContract).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          functionName: 'approve',
          args: [spender, BigInt(500)],
        })
      );
    });

    it('should wait for confirmations after each write', async () => {
      const evmClient = {
        readContract: jest.fn()
          .mockResolvedValueOnce(BigInt(50))
          .mockResolvedValueOnce(BigInt(500)),
        writeContract: jest.fn().mockResolvedValue('0xTxHash'),
        waitForConfirmations: jest.fn().mockResolvedValue(undefined),
      } as any;
      const ctx = makeMockOrchestratorContext();

      await ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(500));

      // Two waits: one after reset, one after set
      expect(evmClient.waitForConfirmations).toHaveBeenCalledTimes(2);
    });

    it('should not throw when verification read fails', async () => {
      const evmClient = {
        readContract: jest.fn()
          .mockResolvedValueOnce(BigInt(0))     // initial check
          .mockRejectedValueOnce(new Error('RPC error')), // verification fails
        writeContract: jest.fn().mockResolvedValue('0xTxHash'),
        waitForConfirmations: jest.fn().mockResolvedValue(undefined),
      } as any;
      const ctx = makeMockOrchestratorContext();

      // Should not throw even though verification readContract fails
      await expect(
        ensureErc20Allowance(ctx, evmClient, tokenAddress, spender, BigInt(500))
      ).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // calculateNativeAmountForDeposit
  // --------------------------------------------------------------------------
  describe('calculateNativeAmountForDeposit', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PriceFetch } = require('../../price-fetch/price-fetch');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should calculate native amount based on deficit and price', async () => {
      // requiredFunds=2e18, ueaBalance=1e18 => deficit=1e18
      // pushToUSDC returns $2 (200000000 in 8-dec) for the 1e18 deficit
      // nativeTokenUsdPrice = $2000 (200000000000 in 8-dec)
      const mockGetPrice = jest.fn().mockResolvedValue(BigInt(200000000000)); // $2000
      PriceFetch.mockImplementation(() => ({ getPrice: mockGetPrice }));

      const ctx = makeMockOrchestratorContext({
        pushClient: {
          pushToUSDC: jest.fn().mockReturnValue(BigInt(200000000)), // $2 in 8-dec
        },
      });

      const result = await calculateNativeAmountForDeposit(
        ctx,
        CHAIN.ETHEREUM_SEPOLIA,
        BigInt('2000000000000000000'),  // 2e18 required
        BigInt('1000000000000000000')   // 1e18 balance
      );

      // depositUsd = $2 (200000000), nativePrice = $2000 (200000000000)
      // nativeAmount = (200000000 * 1e18 + (200000000000 - 1)) / 200000000000 + 1
      // = 200000000 * 1e18 / 200000000000 + 1 = 1e15 + 1 = 1000000000000001
      expect(result).toBeGreaterThan(BigInt(0));
      expect(typeof result).toBe('bigint');
    });

    it('should use $1 minimum deposit when deficit is zero', async () => {
      const mockGetPrice = jest.fn().mockResolvedValue(BigInt(200000000000)); // $2000
      PriceFetch.mockImplementation(() => ({ getPrice: mockGetPrice }));

      const ctx = makeMockOrchestratorContext({
        pushClient: {
          pushToUSDC: jest.fn().mockReturnValue(BigInt(50000000)), // $0.50 < $1
        },
      });

      const result = await calculateNativeAmountForDeposit(
        ctx,
        CHAIN.ETHEREUM_SEPOLIA,
        BigInt(0),  // no required funds
        BigInt(0)   // no balance
      );

      // deficit=0, so pushToUSDC is called with 0 and returns < $1
      // Clamped to oneUsd = $1 (100000000)
      expect(result).toBeGreaterThan(BigInt(0));
    });

    it('should throw if deposit exceeds $1000', async () => {
      const ctx = makeMockOrchestratorContext({
        pushClient: {
          // Returns > $1000 in 8-dec format
          pushToUSDC: jest.fn().mockReturnValue(BigInt(100100000000)), // $1001
        },
      });

      await expect(
        calculateNativeAmountForDeposit(
          ctx,
          CHAIN.ETHEREUM_SEPOLIA,
          BigInt('100000000000000000000'), // huge required
          BigInt(0)
        )
      ).rejects.toThrow('Deposit value exceeds max $1000');
    });

    it('should clamp deposit up to $1 minimum', async () => {
      const mockGetPrice = jest.fn().mockResolvedValue(BigInt(200000000000));
      PriceFetch.mockImplementation(() => ({ getPrice: mockGetPrice }));

      const ctx = makeMockOrchestratorContext({
        pushClient: {
          pushToUSDC: jest.fn().mockReturnValue(BigInt(10000000)), // $0.10
        },
      });

      const result = await calculateNativeAmountForDeposit(
        ctx,
        CHAIN.ETHEREUM_SEPOLIA,
        BigInt('200000000000000000'), // small required
        BigInt('100000000000000000')  // small balance
      );

      // Even though deficit is small, depositUsd is clamped to oneUsd ($1)
      expect(result).toBeGreaterThan(BigInt(0));
    });

    it('should fire progress hooks', async () => {
      const mockGetPrice = jest.fn().mockResolvedValue(BigInt(200000000000));
      PriceFetch.mockImplementation(() => ({ getPrice: mockGetPrice }));

      const progressHook = jest.fn();
      const ctx = makeMockOrchestratorContext({
        pushClient: {
          pushToUSDC: jest.fn().mockReturnValue(BigInt(200000000)),
        },
        progressHook,
      });

      await calculateNativeAmountForDeposit(
        ctx,
        CHAIN.ETHEREUM_SEPOLIA,
        BigInt('2000000000000000000'),
        BigInt('1000000000000000000')
      );

      // Should fire SEND_TX_102_01 and SEND_TX_103_03_04 progress hooks
      expect(progressHook).toHaveBeenCalledTimes(2);
      const hookIds = progressHook.mock.calls.map((call: any) => call[0].id);
      expect(hookIds).toContain('SEND-TX-102-01');
      expect(hookIds).toContain('SEND-TX-103-03-04');
    });
  });

  // --------------------------------------------------------------------------
  // calculateGasAmountFromAmountOutMinETH
  // --------------------------------------------------------------------------
  describe('calculateGasAmountFromAmountOutMinETH', () => {
    it('should return amountOutMinETH directly when gasToken is WETH', async () => {
      const wethAddress = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex!.weth!;
      const ctx = makeMockOrchestratorContext();
      const quoteExactOutputFn = jest.fn();

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress,
        BigInt(1000000),
        quoteExactOutputFn
      );

      expect(result.gasAmount).toBe(BigInt(1000000));
      expect(quoteExactOutputFn).not.toHaveBeenCalled();
    });

    it('should return amountOutMinETH for WETH regardless of case', async () => {
      const wethAddress = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex!.weth!;
      const ctx = makeMockOrchestratorContext();

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress.toUpperCase() as `0x${string}`,
        BigInt(500),
        jest.fn()
      );

      expect(result.gasAmount).toBe(BigInt(500));
    });

    it('should accept string amountOutMinETH', async () => {
      const wethAddress = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex!.weth!;
      const ctx = makeMockOrchestratorContext();

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress,
        '999',
        jest.fn()
      );

      expect(result.gasAmount).toBe(BigInt(999));
    });

    it('should call quoteExactOutputFn and add 1% slippage for non-WETH tokens', async () => {
      const ctx = makeMockOrchestratorContext();
      const mockQuote: ConversionQuote = {
        amountIn: '1000',
        amountOut: '500',
        rate: 2.0,
        timestamp: Date.now(),
      };
      const quoteExactOutputFn = jest.fn().mockResolvedValue(mockQuote);

      // Use real USDT address on Ethereum Sepolia from token registry
      const usdtAddress = '0xC4230aEaFcF6b8B49a7b4e53886420f00ff71876' as `0x${string}`;

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        usdtAddress,
        BigInt(500),
        quoteExactOutputFn
      );

      expect(quoteExactOutputFn).toHaveBeenCalledTimes(1);
      expect(quoteExactOutputFn).toHaveBeenCalledWith(
        BigInt(500),
        expect.objectContaining({ from: expect.anything(), to: expect.anything() })
      );
      // requiredIn=1000, gasAmount = 1000 * 101 / 100 = 1010
      expect(result.gasAmount).toBe(BigInt(1010));
    });

    it('should throw for unsupported chain', async () => {
      const ctx = makeMockOrchestratorContext({
        universalSigner: {
          account: {
            chain: CHAIN.BNB_TESTNET,
            address: '0xOwner',
          },
        },
      });

      await expect(
        calculateGasAmountFromAmountOutMinETH(
          ctx,
          '0xToken' as `0x${string}`,
          BigInt(100),
          jest.fn()
        )
      ).rejects.toThrow('Gas payment in ERC-20 is supported only on');
    });

    it('should throw when WETH is not configured for chain', async () => {
      // Push chain has no dex/weth config
      const ctx = makeMockOrchestratorContext({
        universalSigner: {
          account: {
            chain: CHAIN.ETHEREUM_SEPOLIA,
            address: '0xOwner',
          },
        },
      });

      // Temporarily override CHAIN_INFO to simulate missing WETH
      const originalDex = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex;
      CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex = { ...originalDex, weth: undefined } as any;

      try {
        await expect(
          calculateGasAmountFromAmountOutMinETH(
            ctx,
            '0xToken' as `0x${string}`,
            BigInt(100),
            jest.fn()
          )
        ).rejects.toThrow('WETH address not configured');
      } finally {
        // Restore
        CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex = originalDex;
      }
    });

    it('should throw when from/to tokens are not found in registry', async () => {
      const ctx = makeMockOrchestratorContext();

      await expect(
        calculateGasAmountFromAmountOutMinETH(
          ctx,
          '0xUnknownTokenNotInRegistry' as `0x${string}`,
          BigInt(100),
          jest.fn()
        )
      ).rejects.toThrow('Token not supported for quoting');
    });

    it('should work for Arbitrum Sepolia', async () => {
      const ctx = makeMockOrchestratorContext({
        universalSigner: {
          account: {
            chain: CHAIN.ARBITRUM_SEPOLIA,
            address: '0xOwner',
          },
        },
      });
      const wethAddress = CHAIN_INFO[CHAIN.ARBITRUM_SEPOLIA].dex!.weth!;

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress,
        BigInt(7777),
        jest.fn()
      );

      expect(result.gasAmount).toBe(BigInt(7777));
    });

    it('should work for Base Sepolia', async () => {
      const ctx = makeMockOrchestratorContext({
        universalSigner: {
          account: {
            chain: CHAIN.BASE_SEPOLIA,
            address: '0xOwner',
          },
        },
      });
      const wethAddress = CHAIN_INFO[CHAIN.BASE_SEPOLIA].dex!.weth!;

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress,
        BigInt(42),
        jest.fn()
      );

      expect(result.gasAmount).toBe(BigInt(42));
    });

    it('should handle zero amountOutMinETH', async () => {
      const wethAddress = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].dex!.weth!;
      const ctx = makeMockOrchestratorContext();

      const result = await calculateGasAmountFromAmountOutMinETH(
        ctx,
        wethAddress,
        BigInt(0),
        jest.fn()
      );

      expect(result.gasAmount).toBe(BigInt(0));
    });
  });
});
