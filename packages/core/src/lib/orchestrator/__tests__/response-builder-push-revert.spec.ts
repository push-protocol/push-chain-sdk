import { CHAIN } from '../../constants/enums';
import { TransactionRoute } from '../route-detector';
import { transformToUniversalTxReceipt } from '../internals/tx-transformer';
import { transformToUniversalTxResponse } from '../internals/response-builder';

jest.mock('../../universal/account/account', () => ({
  convertExecutorToOrigin: jest.fn().mockResolvedValue({
    account: null,
    exists: false,
  }),
}));

const PUSH_TX_HASH = `0x${'ab'.repeat(32)}` as `0x${string}`;
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const TARGET = '0x2222222222222222222222222222222222222222' as const;

function makeRevertedReceipt() {
  return {
    transactionHash: PUSH_TX_HASH,
    blockNumber: BigInt(100),
    blockHash: `0x${'cd'.repeat(32)}`,
    transactionIndex: 0,
    contractAddress: null,
    gasUsed: BigInt(80_000),
    cumulativeGasUsed: BigInt(80_000),
    logs: [],
    logsBloom: '0x',
    status: 'reverted' as const,
  };
}

describe('UniversalTxResponse.wait() Push-chain failure gate', () => {
  it('returns the failed Push receipt without polling for a nonexistent outbound', async () => {
    const waitForOutboundTx = jest.fn();
    const printLog = jest.fn();
    const progressHook = jest.fn();
    const tx = {
      hash: PUSH_TX_HASH,
      from: ACCOUNT,
      to: ACCOUNT,
      input: '0x',
      value: BigInt(0),
      nonce: 1,
      gas: BigInt(160_000),
      gasPrice: BigInt(1),
      blockNumber: BigInt(100),
      blockHash: `0x${'cd'.repeat(32)}`,
      transactionIndex: 0,
      type: 'eip1559',
      accessList: [],
      r: '0x1',
      s: '0x2',
      v: BigInt(0),
      wait: jest.fn().mockResolvedValue(makeRevertedReceipt()),
    };
    const ctx = {
      universalSigner: {
        account: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: ACCOUNT,
        },
      },
      progressHook,
    } as any;

    const response = await transformToUniversalTxResponse(ctx, tx as any, [], {
      trackTransaction: jest.fn(),
      waitForOutboundTx,
      transformToUniversalTxReceipt,
      printLog,
      outboundConstants: {
        initialWaitMs: 20_000,
        pollingIntervalMs: 3_000,
        maxTimeoutMs: 300_000,
      },
      inboundConstants: {
        initialWaitMs: 20_000,
        pollingIntervalMs: 3_000,
        maxTimeoutMs: 300_000,
      },
    });
    response.route = TransactionRoute.UOA_TO_CEA;
    response.chain = CHAIN.SOLANA_DEVNET;
    response.to = TARGET;

    const receipt = await response.wait();

    expect(receipt.status).toBe(0);
    expect(receipt.finalTxHash).toBe(PUSH_TX_HASH);
    expect(receipt.externalStatus).toBeUndefined();
    expect(waitForOutboundTx).not.toHaveBeenCalled();
    expect(progressHook).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'SEND-TX-299-02',
        level: 'ERROR',
        message: expect.stringContaining('outbound relay was not started'),
      })
    );
    expect(progressHook).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'SEND-TX-209-01' })
    );
    expect(printLog).toHaveBeenCalledWith(
      expect.stringContaining('Push Chain transaction')
    );
  });
});
