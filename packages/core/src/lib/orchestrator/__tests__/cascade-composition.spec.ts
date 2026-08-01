/**
 * Unit tests for cascade composition logic:
 * - classifyIntoSegments
 *
 * Tests import the pure function directly from cascade.ts
 * (no Orchestrator instance needed).
 */
import { decodeAbiParameters, decodeFunctionData } from 'viem';
import { CHAIN } from '../../constants/enums';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { CEA_EVM } from '../../constants/abi/cea.evm';
import { ERC20_EVM } from '../../constants/abi/erc20.evm';
import { UEA_MULTICALL_SELECTOR } from '../../constants/selectors';
import { classifyIntoSegments, composeCascadeDetailed } from '../internals/cascade';
import { MULTICALL_TUPLE_TYPE } from '../payload-builders';
import type { OrchestratorContext } from '../internals/context';
import type {
  CascadeSegment,
  HopDescriptor,
  MultiCall,
  UniversalOutboundTxRequest,
  UniversalExecuteParams,
} from '../orchestrator.types';

// ============================================================================
// Test data helpers
// ============================================================================

const ALICE = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12' as `0x${string}`;
const BOB = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const UEA = '0x2222222222222222222222222222222222222222' as `0x${string}`;
const CEA_BNB = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const CEA_ETH = '0x4444444444444444444444444444444444444444' as `0x${string}`;

function hexToBytes(hex: `0x${string}`): Uint8Array {
  return new Uint8Array(Buffer.from(hex.slice(2), 'hex'));
}

function extractSvmPc20Payload(svmPayload: `0x${string}`): {
  accountCount: number;
  amount: bigint;
  payload: `0x${string}`;
} {
  const bytes = hexToBytes(svmPayload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const accountCount = view.getUint32(0, false);
  const ixDataOffset = 4 + accountCount * 33 + 4;
  const amountOffset = ixDataOffset + 8 + 20 + 32;
  const amount = view.getBigUint64(amountOffset, true);
  const payloadLenOffset = amountOffset + 8;
  const payloadLen = view.getUint32(payloadLenOffset, true);
  const payloadOffset = payloadLenOffset + 4;

  return {
    accountCount,
    amount,
    payload: `0x${Buffer.from(
      bytes.slice(payloadOffset, payloadOffset + payloadLen)
    ).toString('hex')}`,
  };
}

function extractSvmUniversalPayloadData(
  payload: `0x${string}`
): `0x${string}` {
  const bytes = hexToBytes(payload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataLenOffset = 20 + 8;
  const dataLen = view.getUint32(dataLenOffset, true);
  const dataOffset = dataLenOffset + 4;
  return `0x${Buffer.from(bytes.slice(dataOffset, dataOffset + dataLen)).toString(
    'hex'
  )}`;
}

function makeBaseHop(overrides: Partial<HopDescriptor> = {}): HopDescriptor {
  return {
    params: { to: ALICE, value: BigInt(100) } as UniversalExecuteParams,
    route: 'UOA_TO_PUSH',
    gasLimit: BigInt(200000),
    maxPCForGas: BigInt(0),
    ueaAddress: UEA,
    revertRecipient: UEA,
    ...overrides,
  };
}

function makeRoute1Hop(
  pushMulticalls: MultiCall[] = [{ to: ALICE, value: BigInt(100), data: '0x' }]
): HopDescriptor {
  return makeBaseHop({
    route: 'UOA_TO_PUSH',
    pushMulticalls,
  });
}

function makeRoute2Hop(
  targetChain: CHAIN,
  ceaMulticalls: MultiCall[] = [{ to: BOB, value: BigInt(50), data: '0xdeadbeef' }],
  opts: Partial<HopDescriptor> = {}
): HopDescriptor {
  return makeBaseHop({
    route: 'UOA_TO_CEA',
    targetChain,
    ceaAddress: targetChain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_ETH,
    ceaMulticalls,
    prc20Token: TOKEN_A,
    burnAmount: BigInt(1000),
    gasToken: TOKEN_A,
    gasFee: BigInt(200),
    gasPrice: BigInt(50_000_000),
    ...opts,
  });
}

function makeRoute3Hop(
  sourceChain: CHAIN,
  opts: Partial<HopDescriptor> = {}
): HopDescriptor {
  return makeBaseHop({
    route: 'CEA_TO_PUSH',
    sourceChain,
    ceaAddress: sourceChain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_ETH,
    prc20Token: TOKEN_A,
    burnAmount: BigInt(1),
    gasToken: TOKEN_A,
    gasFee: BigInt(200),
    gasPrice: BigInt(50_000_000),
    ...opts,
  });
}

// ============================================================================
// classifyIntoSegments
// ============================================================================
describe('classifyIntoSegments', () => {
  it('should return empty array for empty hops', () => {
    const result = classifyIntoSegments([]);
    expect(result).toEqual([]);
  });

  it('should create single PUSH_EXECUTION segment for one Route 1 hop', () => {
    const hop = makeRoute1Hop();
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[0].hops).toHaveLength(1);
    expect(result[0].mergedPushMulticalls).toEqual(hop.pushMulticalls);
  });

  it('should merge consecutive Route 1 hops into single PUSH_EXECUTION segment', () => {
    const hop1 = makeRoute1Hop([{ to: ALICE, value: BigInt(100), data: '0x' }]);
    const hop2 = makeRoute1Hop([{ to: BOB, value: BigInt(200), data: '0x' }]);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[0].hops).toHaveLength(2);
    expect(result[0].mergedPushMulticalls).toHaveLength(2);
  });

  it('should create single OUTBOUND_TO_CEA segment for one Route 2 hop', () => {
    const hop = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].targetChain).toBe(CHAIN.BNB_TESTNET);
    expect(result[0].prc20Token).toBe(TOKEN_A);
    expect(result[0].totalBurnAmount).toBe(BigInt(1000));
  });

  it('should merge consecutive Route 2 hops to same chain', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, [
      { to: ALICE, value: BigInt(50), data: '0xaa' },
    ]);
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, [
      { to: BOB, value: BigInt(75), data: '0xbb' },
    ]);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].hops).toHaveLength(2);
    // CEA multicalls merged
    expect(result[0].mergedCeaMulticalls).toHaveLength(2);
    // Burn amounts summed
    expect(result[0].totalBurnAmount).toBe(BigInt(2000)); // 1000 + 1000
    // Gas fees accumulated
    expect(result[0].gasFee).toBe(BigInt(400)); // 200 + 200
  });

  it('should NOT merge Route 2 hops targeting different chains', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const hop2 = makeRoute2Hop(CHAIN.ETHEREUM_SEPOLIA);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('OUTBOUND_TO_CEA');
    expect(result[0].targetChain).toBe(CHAIN.BNB_TESTNET);
    expect(result[1].type).toBe('OUTBOUND_TO_CEA');
    expect(result[1].targetChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  });

  it('should create INBOUND_FROM_CEA segment for Route 3 hop', () => {
    const hop = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('INBOUND_FROM_CEA');
    expect(result[0].sourceChain).toBe(CHAIN.BNB_TESTNET);
  });

  it('should merge consecutive Route 3 hops from the same source chain into one INBOUND_FROM_CEA segment', () => {
    // Same-source R3 hops collapse into ONE CEA→UEA round-trip whose inbound
    // multicall runs every hop's target op (cascade.ts classifyIntoSegments).
    const hop1 = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const hop2 = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('INBOUND_FROM_CEA');
    expect(result[0].hops).toHaveLength(2);
    // Burn amounts summed across merged hops
    expect(result[0].totalBurnAmount).toBe(BigInt(2));
    // Gas fees accumulated
    expect(result[0].gasFee).toBe(BigInt(400));
  });

  it('should NOT merge Route 3 hops from different source chains', () => {
    const hop1 = makeRoute3Hop(CHAIN.BNB_TESTNET);
    const hop2 = makeRoute3Hop(CHAIN.ETHEREUM_SEPOLIA);
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('INBOUND_FROM_CEA');
    expect(result[0].sourceChain).toBe(CHAIN.BNB_TESTNET);
    expect(result[1].type).toBe('INBOUND_FROM_CEA');
    expect(result[1].sourceChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
  });

  it('should handle mixed routes: Route 1 -> Route 2 -> Route 3', () => {
    const hop1 = makeRoute1Hop();
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET);
    const hop3 = makeRoute3Hop(CHAIN.ETHEREUM_SEPOLIA);
    const result = classifyIntoSegments([hop1, hop2, hop3]);

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('PUSH_EXECUTION');
    expect(result[1].type).toBe('OUTBOUND_TO_CEA');
    expect(result[2].type).toBe('INBOUND_FROM_CEA');
  });

  it('should keep gasLimit as max across merged hops', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasLimit: BigInt(100000),
    });
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasLimit: BigInt(300000),
    });
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].gasLimit).toBe(BigInt(300000));
  });

  it('should sum non-zero maxPCForGas caps across merged outbound hops', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      maxPCForGas: BigInt(1000),
    });
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      maxPCForGas: BigInt(2000),
    });
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].maxPCForGas).toBe(BigInt(3000));
  });

  it('should keep merged outbound cap uncapped when any hop is uncapped', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      maxPCForGas: BigInt(1000),
    });
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      maxPCForGas: BigInt(0),
    });
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].maxPCForGas).toBe(BigInt(0));
  });

  it('should retain quoted gasPrice on outbound segments', () => {
    const hop = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasPrice: BigInt(12345),
    });
    const result = classifyIntoSegments([hop]);

    expect(result).toHaveLength(1);
    expect(result[0].gasPrice).toBe(BigInt(12345));
  });

  it('should keep the highest gasPrice across merged outbound hops', () => {
    const hop1 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasPrice: BigInt(100),
    });
    const hop2 = makeRoute2Hop(CHAIN.BNB_TESTNET, undefined, {
      gasPrice: BigInt(250),
    });
    const result = classifyIntoSegments([hop1, hop2]);

    expect(result).toHaveLength(1);
    expect(result[0].gasPrice).toBe(BigInt(250));
  });
});

describe('composeCascadeDetailed', () => {
  it('keeps the quoted gasPrice on immediate outbound requests', async () => {
    const gasPrice = BigInt(50_000_000);
    const hop = makeRoute2Hop(CHAIN.BNB_TESTNET, [], {
      burnAmount: BigInt(0),
      gasLimit: BigInt(2_000_000),
      gasPrice,
    });
    const segment: CascadeSegment = {
      type: 'OUTBOUND_TO_CEA',
      hops: [hop],
      targetChain: CHAIN.BNB_TESTNET,
      mergedCeaMulticalls: [],
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(100),
      gasPrice,
      gasLimit: BigInt(2_000_000),
      maxPCForGas: BigInt(0),
    };
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract: jest.fn() },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt('100000000000000000000')
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );

    expect(outboundCall).toBeDefined();
    const decoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: outboundCall!.data,
    });
    const [request] = decoded.args as [UniversalOutboundTxRequest];

    expect(request.gasLimit).toBe(BigInt(2_000_000));
    expect(request.gasPrice).toBe(gasPrice);
  });

  it('uses live gas price resolution for Route 3 source-chain outbounds', async () => {
    const bnbGasPrice = BigInt(50_000_000);
    const ethGasPrice = BigInt(75_000_000);
    const bnbHop = makeRoute3Hop(CHAIN.BNB_TESTNET, {
      burnAmount: BigInt(0),
      gasPrice: bnbGasPrice,
    });
    const delayedEthHop = makeRoute3Hop(CHAIN.ETHEREUM_SEPOLIA, {
      burnAmount: BigInt(0),
      gasPrice: ethGasPrice,
    });
    const segments: CascadeSegment[] = [
      {
        type: 'INBOUND_FROM_CEA',
        hops: [bnbHop],
        sourceChain: CHAIN.BNB_TESTNET,
        totalBurnAmount: BigInt(0),
        prc20Token: TOKEN_A,
        gasToken: TOKEN_A,
        gasFee: BigInt(100),
        gasPrice: bnbGasPrice,
        gasLimit: BigInt(750_000),
        maxPCForGas: BigInt(0),
      },
      {
        type: 'INBOUND_FROM_CEA',
        hops: [delayedEthHop],
        sourceChain: CHAIN.ETHEREUM_SEPOLIA,
        totalBurnAmount: BigInt(0),
        prc20Token: TOKEN_A,
        gasToken: TOKEN_A,
        gasFee: BigInt(100),
        gasPrice: ethGasPrice,
        gasLimit: BigInt(750_000),
        maxPCForGas: BigInt(0),
      },
    ];
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract: jest.fn() },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls } = await composeCascadeDetailed(
      ctx,
      segments,
      UEA,
      BigInt('100000000000000000000')
    );
    const topOutboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );
    expect(topOutboundCall).toBeDefined();

    const topDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: topOutboundCall!.data,
    });
    const [topRequest] = topDecoded.args as [UniversalOutboundTxRequest];
    expect(topRequest.gasPrice).toBe(BigInt(0));

    const [ceaCalls] = decodeAbiParameters(
      [MULTICALL_TUPLE_TYPE],
      `0x${topRequest.payload.slice(10)}` as `0x${string}`
    ) as [MultiCall[]];
    const sendToUeaCall = ceaCalls.find((call) =>
      call.data.startsWith('0xe7c1e3fc')
    );
    expect(sendToUeaCall).toBeDefined();

    const sendToUeaDecoded = decodeFunctionData({
      abi: CEA_EVM,
      data: sendToUeaCall!.data,
    });
    const intermediatePayload = sendToUeaDecoded.args[2] as `0x${string}`;
    const [universalPayload] = decodeAbiParameters(
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
      intermediatePayload
    ) as unknown as readonly [{ data: `0x${string}` }];
    const [nestedPushCalls] = decodeAbiParameters(
      [MULTICALL_TUPLE_TYPE],
      `0x${universalPayload.data.slice(10)}` as `0x${string}`
    ) as [MultiCall[]];
    const delayedOutboundCall = nestedPushCalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );
    expect(delayedOutboundCall).toBeDefined();

    const delayedDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: delayedOutboundCall!.data,
    });
    const [delayedRequest] = delayedDecoded.args as [UniversalOutboundTxRequest];
    expect(delayedRequest.gasPrice).toBe(BigInt(0));
  });

  it('uses pool-quoted native value for SVM Route 3 inbound cascade outbounds', async () => {
    const wei = BigInt('1000000000000000000');
    const exactWpcNeeded = BigInt(25) * wei;
    const quotedWithBuffer = (exactWpcNeeded * BigInt(22)) / BigInt(10);
    const hop = makeRoute3Hop(CHAIN.SOLANA_DEVNET, {
      sourceChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      burnAmount: BigInt(0),
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(1_000_000),
      params: {
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ALICE,
        value: BigInt(1_000_000),
      } as UniversalExecuteParams,
    });
    const segment: CascadeSegment = {
      type: 'INBOUND_FROM_CEA',
      hops: [hop],
      sourceChain: CHAIN.SOLANA_DEVNET,
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(1_000_000),
      maxPCForGas: BigInt(0),
    };
    const readContract = jest.fn(async ({ functionName }) => {
      switch (functionName) {
        case 'universalCore':
          return '0x5555555555555555555555555555555555555555';
        case 'WPC':
          return '0x1000000000000000000000000000000000000000';
        case 'uniswapV3Factory':
          return '0x2000000000000000000000000000000000000000';
        case 'defaultFeeTier':
          return 3000;
        case 'quoteExactOutputSingle':
          return [exactWpcNeeded, BigInt(0), 0, BigInt(0)];
        default:
          throw new Error(`unexpected readContract: ${String(functionName)}`);
      }
    });
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls, requiredNativeValue } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt(30) * wei
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );

    expect(outboundCall).toBeDefined();
    expect(outboundCall!.value).toBe(quotedWithBuffer);
    expect(requiredNativeValue).toBe(quotedWithBuffer + BigInt(1_000_000));
  });

  it('uses pool-quoted native value for EVM cascade outbounds instead of flat balance split', async () => {
    const wei = BigInt('1000000000000000000');
    // Deliberately above the old 200 PC hard ceiling. The composer must keep
    // the live quote; truncating this to 200 PC produces Uniswap `STF`.
    const exactWpcNeeded = BigInt(500) * wei;
    const quotedWithBuffer = (exactWpcNeeded * BigInt(22)) / BigInt(10);
    const hop = makeRoute2Hop(CHAIN.ETHEREUM_SEPOLIA, [], {
      burnAmount: BigInt(0),
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(500_000),
    });
    const segment: CascadeSegment = {
      type: 'OUTBOUND_TO_CEA',
      hops: [hop],
      targetChain: CHAIN.ETHEREUM_SEPOLIA,
      mergedCeaMulticalls: [],
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(500_000),
      maxPCForGas: BigInt(0),
    };
    const readContract = jest.fn(async ({ functionName }) => {
      switch (functionName) {
        case 'universalCore':
          return '0x5555555555555555555555555555555555555555';
        case 'WPC':
          return '0x1000000000000000000000000000000000000000';
        case 'uniswapV3Factory':
          return '0x2000000000000000000000000000000000000000';
        case 'defaultFeeTier':
          return 3000;
        case 'quoteExactOutputSingle':
          return [exactWpcNeeded, BigInt(0), 0, BigInt(0)];
        default:
          throw new Error(`unexpected readContract: ${String(functionName)}`);
      }
    });
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls, requiredNativeValue } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt(30) * wei
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );

    expect(outboundCall).toBeDefined();
    expect(outboundCall!.value).toBe(quotedWithBuffer);
    expect(requiredNativeValue).toBe(quotedWithBuffer);
  });

  it('uses the live EVM pool quote for Route 3 wrapper gas instead of the flat split', async () => {
    const wei = BigInt('1000000000000000000');
    const exactWpcNeeded = BigInt(500) * wei;
    const quotedWithBuffer = (exactWpcNeeded * BigInt(22)) / BigInt(10);
    const hop = makeRoute3Hop(CHAIN.BNB_TESTNET, {
      burnAmount: BigInt(0),
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(750_000),
      params: {
        from: { chain: CHAIN.BNB_TESTNET },
        to: ALICE,
        data: '0x',
      } as UniversalExecuteParams,
    });
    const segment: CascadeSegment = {
      type: 'INBOUND_FROM_CEA',
      hops: [hop],
      sourceChain: CHAIN.BNB_TESTNET,
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(1_000_000),
      gasPrice: BigInt(1),
      gasLimit: BigInt(750_000),
      maxPCForGas: BigInt(0),
    };
    const readContract = jest.fn(async ({ functionName }) => {
      switch (functionName) {
        case 'universalCore':
          return '0x5555555555555555555555555555555555555555';
        case 'WPC':
          return '0x1000000000000000000000000000000000000000';
        case 'uniswapV3Factory':
          return '0x2000000000000000000000000000000000000000';
        case 'defaultFeeTier':
          return 3000;
        case 'quoteExactOutputSingle':
          return [exactWpcNeeded, BigInt(0), 0, BigInt(0)];
        default:
          throw new Error(`unexpected readContract: ${String(functionName)}`);
      }
    });
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls, requiredNativeValue } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt(30) * wei
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );

    expect(outboundCall).toBeDefined();
    expect(outboundCall!.value).toBe(quotedWithBuffer);
    expect(requiredNativeValue).toBe(quotedWithBuffer);
  });

  it('always forwards a funds-only EVM PC20 import inside the inbound payload', async () => {
    const wrapper = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`;
    const pushPc20 = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
    const amount = BigInt(1_000_000);
    const params = {
      from: { chain: CHAIN.BNB_TESTNET },
      to: BOB,
      funds: {
        amount,
        token: {
          symbol: 'RAIN',
          decimals: 18,
          address: wrapper,
          mechanism: 'pc20-burn' as const,
        },
      },
      _pc20: {
        direction: 'import' as const,
        originChain: CHAIN.BNB_TESTNET,
        originAddress: wrapper,
        pushAddress: pushPc20,
        name: 'Rain',
        symbol: 'RAIN',
        decimals: 18,
        chainNamespace: 'eip155:97',
      },
    } as unknown as UniversalExecuteParams;
    const hop = makeRoute3Hop(CHAIN.BNB_TESTNET, {
      params,
      burnAmount: BigInt(0),
      gasFee: BigInt(0),
      gasPrice: BigInt(0),
    });
    const segment: CascadeSegment = {
      type: 'INBOUND_FROM_CEA',
      hops: [hop],
      sourceChain: CHAIN.BNB_TESTNET,
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(0),
      gasPrice: BigInt(0),
      gasLimit: BigInt(750_000),
      maxPCForGas: BigInt(0),
    };
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract: jest.fn() },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt('100000000000000000000')
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );
    expect(outboundCall).toBeDefined();

    const outboundDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: outboundCall!.data,
    });
    const [outboundRequest] = outboundDecoded.args as [
      UniversalOutboundTxRequest,
    ];
    const [ceaCalls] = decodeAbiParameters(
      [MULTICALL_TUPLE_TYPE],
      `0x${outboundRequest.payload.slice(10)}` as `0x${string}`
    ) as [MultiCall[]];
    const sendToUeaCall = ceaCalls.find((call) =>
      call.data.startsWith('0xe7c1e3fc')
    );
    expect(sendToUeaCall).toBeDefined();

    const sendToUeaDecoded = decodeFunctionData({
      abi: CEA_EVM,
      data: sendToUeaCall!.data,
    });
    expect((sendToUeaDecoded.args[0] as string).toLowerCase()).toBe(wrapper);
    expect(sendToUeaDecoded.args[1]).toBe(amount);
    const intermediatePayload = sendToUeaDecoded.args[2] as `0x${string}`;
    expect(intermediatePayload).not.toBe('0x');

    const [universalPayload] = decodeAbiParameters(
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
      intermediatePayload
    ) as unknown as readonly [{ data: `0x${string}` }];
    const [nestedPushCalls] = decodeAbiParameters(
      [MULTICALL_TUPLE_TYPE],
      `0x${universalPayload.data.slice(10)}` as `0x${string}`
    ) as [MultiCall[]];
    const forwardCall = nestedPushCalls.find(
      (call) => call.to.toLowerCase() === pushPc20.toLowerCase()
    );
    expect(forwardCall).toBeDefined();

    const forwardDecoded = decodeFunctionData({
      abi: ERC20_EVM,
      data: forwardCall!.data,
    });
    expect(forwardDecoded.functionName).toBe('transfer');
    expect(forwardDecoded.args).toEqual([BOB, amount]);
  });

  it('always forwards a funds-only SVM PC20 import with the dedicated burn instruction', async () => {
    const wrapperMint = 'So11111111111111111111111111111111111111112';
    const pushPc20 = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
    const amount = BigInt(8_000);
    const params = {
      from: { chain: CHAIN.SOLANA_DEVNET },
      to: BOB,
      funds: {
        amount,
        token: {
          symbol: 'RAIN',
          decimals: 6,
          address: wrapperMint,
          mechanism: 'pc20-burn' as const,
        },
      },
      _pc20: {
        direction: 'import' as const,
        originChain: CHAIN.SOLANA_DEVNET,
        originAddress: wrapperMint,
        pushAddress: pushPc20,
        name: 'Rain',
        symbol: 'RAIN',
        decimals: 6,
        chainNamespace: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      },
    } as unknown as UniversalExecuteParams;
    const hop = makeRoute3Hop(CHAIN.SOLANA_DEVNET, {
      sourceChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      params,
      burnAmount: BigInt(0),
      gasFee: BigInt(0),
      gasPrice: BigInt(0),
    });
    const segment: CascadeSegment = {
      type: 'INBOUND_FROM_CEA',
      hops: [hop],
      sourceChain: CHAIN.SOLANA_DEVNET,
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(0),
      gasPrice: BigInt(0),
      gasLimit: BigInt(1_000_000),
      maxPCForGas: BigInt(0),
    };
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      pushClient: { readContract: jest.fn() },
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    const { multicalls } = await composeCascadeDetailed(
      ctx,
      [segment],
      UEA,
      BigInt('100000000000000000000')
    );
    const outboundCall = multicalls.find((call) =>
      call.data.startsWith('0x77b86bec')
    );
    expect(outboundCall).toBeDefined();

    const outboundDecoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: outboundCall!.data,
    });
    const [outboundRequest] = outboundDecoded.args as [
      UniversalOutboundTxRequest,
    ];
    const pc20Send = extractSvmPc20Payload(outboundRequest.payload);

    expect(outboundRequest.amount).toBe(BigInt(0));
    expect(pc20Send.accountCount).toBe(4);
    expect(pc20Send.amount).toBe(amount);
    expect(pc20Send.payload).not.toBe('0x');
    expect(
      extractSvmUniversalPayloadData(pc20Send.payload).startsWith(
        UEA_MULTICALL_SELECTOR
      )
    ).toBe(true);
  });

  it('rejects oversized SVM Route 3 cascade payloads before broadcast', async () => {
    const oversizedData = `0x${'11'.repeat(950)}` as `0x${string}`;
    const hop = makeRoute3Hop(CHAIN.SOLANA_DEVNET, {
      sourceChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      params: {
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: ALICE,
        data: oversizedData,
      } as UniversalExecuteParams,
    });
    const segment: CascadeSegment = {
      type: 'INBOUND_FROM_CEA',
      hops: [hop],
      sourceChain: CHAIN.SOLANA_DEVNET,
      totalBurnAmount: BigInt(0),
      prc20Token: TOKEN_A,
      gasToken: TOKEN_A,
      gasFee: BigInt(0),
      gasPrice: BigInt(0),
      gasLimit: BigInt(1052),
      maxPCForGas: BigInt(0),
    };
    const ctx = {
      printTraces: false,
      progressHook: () => undefined,
      pushNetwork: 'TESTNET_DONUT',
      universalSigner: {
        account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: ALICE },
      },
    } as unknown as OrchestratorContext;

    await expect(
      composeCascadeDetailed(ctx, [segment], UEA, BigInt(100) * BigInt(1e18))
    ).rejects.toThrow(
      /SVM outbound payload for Route 3 SVM cascade .* exceeding relay-safe limit/
    );
  });
});
