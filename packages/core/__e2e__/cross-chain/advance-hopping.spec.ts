/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * E2E Tests for Advance Hopping (Cascaded Transactions)
 *
 * Tests Route 1, Route 2, and Route 3 via the new prepareTransaction + executeTransactions API.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK, VM } from '../../src/lib/constants/enums';
import {
  CHAIN_INFO,
  PUSH_VIEM_CHAINS,
  SYNTHETIC_PUSH_ERC20,
} from '../../src/lib/constants/chain';
import {
  createPublicClient,
  createWalletClient,
  http,
  Hex,
  parseEther,
  formatEther,
  formatUnits,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  CascadeExecutionOptions,
  PreparedUniversalTx,
} from '../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import { CEA_EVM } from '../../src/lib/constants/abi/cea.evm';
import { UEA_MULTICALL_SELECTOR } from '../../src/lib/constants/selectors';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  queryOutboundGasFees,
  waitForOutboundRelay,
} from '@e2e/shared/outbound-helpers';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { toHexData } from '@e2e/shared/svm-outbound-helpers';
import { PublicKey } from '@solana/web3.js';

// BSC Testnet USDT address
const BSC_USDT_ADDRESS = '0xE935d9c9C24D02E61186c640cc01d713C876d40F' as const;

// Push Chain payable counter (for Route 3 inbound tests)
const COUNTER_ADDRESS_PAYABLE = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf' as `0x${string}`;
const COUNTER_ABI_PAYABLE = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'countPC', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
] as const;

// BSC Testnet payable counter (accepts native BNB via increment)
const BSC_COUNTER_PAYABLE = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;
const BSC_COUNTER_ABI = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

// Solana target (32-byte hex address)
const SOLANA_TARGET = '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

// Solana test_counter program on devnet (8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx)
const SOL_TEST_PROGRAM = '0x7673075a980bfd5d6b1dffe99c31f63e8938519cc1c2af009dda5e568a94460d' as `0x${string}`;
const SOL_COUNTER_PDA = '0x4f12fe6816ae7e33ebf7db0b154ec3b09e3bf1a7690481e8e9477d5a278ad3af' as `0x${string}`;
const SOL_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
const SVM_GATEWAY_PROGRAM = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

// StakingExample contract (Push Chain Donut)
const STAKING_PROXY = '0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29' as `0x${string}`;
const PBNB_TOKEN =
  SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pBNB;
const PSOL_TOKEN =
  SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pSOL;
const PUSDT_BNB_TOKEN =
  SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].USDT_BSC;
const UNIVERSAL_GATEWAY_BSC = '0x44aFFC61983F4348DdddB886349eb992C061EaC0' as `0x${string}`;
const CEA_FACTORY_BSC = '0x3f1B16e0B072d472951C4563d29d3da6a3EE3Ce8' as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

// BSC nonpayable counter (for StakingExample outbound tests)
const COUNTER_A_BSC = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8' as `0x${string}`;
const COUNTER_ABI_BSC = [
  { type: 'function', name: 'count', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const;

const CEA_FACTORY_ABI = [
  { type: 'function', name: 'getCEAForPushAccount', inputs: [{ name: '_pushAccount', type: 'address' }], outputs: [{ name: '', type: 'address' }, { name: '', type: 'bool' }], stateMutability: 'view' },
] as const;

const STAKING_EXAMPLE_ABI = [
  { inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'recipient', type: 'bytes' }, { name: 'gasLimit', type: 'uint256' }, { name: 'payload', type: 'bytes' }, { name: 'revertRecipient', type: 'address' }], name: 'triggerOutbound', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }, { name: 'token', type: 'address' }], name: 'getStake', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

const EVM_TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;
const SVM_TX_HASH_REGEX = /^(0x[a-fA-F0-9]{128}|[1-9A-HJ-NP-Za-km-z]{86,90})$/;
const REQUIRED_UEA_PBNB_BALANCE = parseEther('0.005');
const REQUIRED_UEA_PSOL_BALANCE = BigInt(100_000_000);
const STAKING_OUTBOUND_GAS_LIMIT = BigInt(1_000_000);
const OUTBOUND_MSG_VALUE_FLOOR = parseEther('50');
// The round-trip inbound call is committed only after its Push Chain gas fee is
// deducted. These are caps; zero values cause the inbound execution to roll back.
const INBOUND_EXECUTION_GAS_LIMIT = BigInt(500_000);
const INBOUND_MAX_FEE_PER_GAS = BigInt(10_000_000_000);
const LIVE_CASCADE_WAIT_TIMEOUT_MS = 2_400_000;
const LIVE_CASCADE_TEST_TIMEOUT_MS = 3_600_000;

function expectExternalTxHashForChain(
  txHash: string | undefined,
  chain: CHAIN
): asserts txHash is string {
  expect(txHash).toBeDefined();
  expect(txHash).toMatch(
    CHAIN_INFO[chain].vm === VM.SVM ? SVM_TX_HASH_REGEX : EVM_TX_HASH_REGEX
  );
}

describe('Advance Hopping: Cascade API E2E', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let pushPublicClient: ReturnType<typeof createPublicClient>;
  let bscPublicClient: ReturnType<typeof createPublicClient>;
  let ceaPdaHex: `0x${string}`;
  let stakingCeaAddress: `0x${string}`;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  // Module-scoped events collector; cleared in beforeEach so each test asserts
  // over its own progress sequence. Used by multihop progress-hook assertions.
  const collectedProgressEvents: ProgressEvent[] = [];

  beforeEach(() => {
    collectedProgressEvents.length = 0;
  });

  const executeCascade = (
    txs: PreparedUniversalTx[],
    options?: Omit<CascadeExecutionOptions, 'enforceGasCheck'>
  ) =>
    pushClient.universal.executeTransactions(txs, {
      ...options,
      enforceGasCheck: true,
    });

  async function readPushTokenBalance(
    token: `0x${string}`,
    holder: `0x${string}`
  ): Promise<bigint> {
    return (await pushPublicClient.readContract({
      address: token,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [holder],
    })) as bigint;
  }

  async function transferPushTokenFromFunder(
    token: `0x${string}`,
    to: `0x${string}`,
    amount: bigint
  ): Promise<void> {
    const fundingPrivateKey =
      (process.env['PUSH_PRIVATE_KEY'] as Hex | undefined) || privateKey;
    if (!fundingPrivateKey) {
      throw new Error(
        'Cannot fund Push token balance: PUSH_PRIVATE_KEY or EVM_PRIVATE_KEY is required'
      );
    }

    const account = privateKeyToAccount(fundingPrivateKey);
    const walletClient = createWalletClient({
      account,
      chain: PUSH_VIEM_CHAINS[CHAIN.PUSH_TESTNET_DONUT],
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const hash = await walletClient.sendTransaction({
      to: token,
      data: encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'transfer',
        args: [to, amount],
      }),
      value: BigInt(0),
    });
    const receipt = await pushPublicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error(`Push token funding transaction reverted: ${hash}`);
    }
  }

  async function ensurePushTokenBalance(opts: {
    label: string;
    token: `0x${string}`;
    holder: `0x${string}`;
    required: bigint;
    decimals: number;
    allowUeaFallback?: boolean;
  }): Promise<void> {
    const { label, token, holder, required, decimals, allowUeaFallback } = opts;
    const current = await readPushTokenBalance(token, holder);
    console.log(
      `[BalanceGuard] ${label}: ${formatUnits(current, decimals)} / required ${formatUnits(required, decimals)}`
    );
    if (current >= required) return;

    const shortfall = required - current;
    const fundingPrivateKey =
      (process.env['PUSH_PRIVATE_KEY'] as Hex | undefined) || privateKey;
    const funder = fundingPrivateKey
      ? privateKeyToAccount(fundingPrivateKey)
      : undefined;
    const funderBalance = funder
      ? await readPushTokenBalance(token, funder.address as `0x${string}`)
      : BigInt(0);

    if (funderBalance >= shortfall) {
      console.log(
        `[BalanceGuard] Funding ${label} from Push master ${funder!.address}: ${formatUnits(shortfall, decimals)}`
      );
      await transferPushTokenFromFunder(token, holder, shortfall);
    } else if (
      allowUeaFallback &&
      holder.toLowerCase() !== ueaAddress.toLowerCase()
    ) {
      const ueaBalance = await readPushTokenBalance(token, ueaAddress);
      if (ueaBalance < shortfall) {
        throw new Error(
          `[BalanceGuard] ${label} underfunded. Holder shortfall ${formatUnits(shortfall, decimals)}, master has ${formatUnits(funderBalance, decimals)}, UEA has ${formatUnits(ueaBalance, decimals)}.`
        );
      }

      console.log(
        `[BalanceGuard] Funding ${label} from UEA: ${formatUnits(shortfall, decimals)}`
      );
      const tx = await pushClient.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [holder, shortfall],
        }),
      });
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error(`UEA token funding transaction failed: ${tx.hash}`);
      }
    } else {
      throw new Error(
        `[BalanceGuard] ${label} underfunded. Holder shortfall ${formatUnits(shortfall, decimals)}, master has ${formatUnits(funderBalance, decimals)}.`
      );
    }

    const updated = await readPushTokenBalance(token, holder);
    if (updated < required) {
      throw new Error(
        `[BalanceGuard] ${label} still underfunded after top-up: ${formatUnits(updated, decimals)} < ${formatUnits(required, decimals)}`
      );
    }
  }

  async function computeOutboundMsgValue(
    nativeValueForGas: bigint
  ): Promise<bigint> {
    const value =
      nativeValueForGas > OUTBOUND_MSG_VALUE_FLOOR
        ? nativeValueForGas
        : OUTBOUND_MSG_VALUE_FLOOR;
    const ueaBalance = await pushPublicClient.getBalance({
      address: ueaAddress,
    });
    console.log(
      `[MsgValue] Using ${formatEther(value)} PC for StakingExample outbound gas (UEA balance ${formatEther(ueaBalance)} PC)`
    );
    if (ueaBalance < value) {
      throw new Error(
        `[MsgValue] UEA native PC balance too low for StakingExample outbound: ${formatEther(ueaBalance)} < ${formatEther(value)}`
      );
    }
    return value;
  }

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val: any) => {
        console.log(`[${val.id}] ${val.title}`);
        collectedProgressEvents.push(val as ProgressEvent);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

    bscPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
    });

    // Derive Solana CEA PDA for CPI tests
    const senderBytes = Buffer.from(ueaAddress.slice(2), 'hex');
    const [ceaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('push_identity'), senderBytes],
      SVM_GATEWAY_PROGRAM
    );
    ceaPdaHex = ('0x' + Buffer.from(ceaPda.toBytes()).toString('hex')) as `0x${string}`;
    console.log(`CEA PDA: ${ceaPda.toBase58()} (${ceaPdaHex})`);

    // Resolve StakingExample CEA on BSC
    const [ceaAddr] = await bscPublicClient.readContract({
      address: CEA_FACTORY_BSC, abi: CEA_FACTORY_ABI, functionName: 'getCEAForPushAccount',
      args: [STAKING_PROXY],
    }) as [`0x${string}`, boolean];
    stakingCeaAddress = ceaAddr;
    console.log(`StakingExample CEA on BSC: ${stakingCeaAddress}`);

    await ensurePushTokenBalance({
      label: 'Advance Hopping UEA pBNB burn balance',
      token: PBNB_TOKEN,
      holder: ueaAddress,
      required: REQUIRED_UEA_PBNB_BALANCE,
      decimals: 18,
    });
    await ensurePushTokenBalance({
      label: 'Advance Hopping UEA pSOL burn balance',
      token: PSOL_TOKEN,
      holder: ueaAddress,
      required: REQUIRED_UEA_PSOL_BALANCE,
      decimals: 9,
    });
  }, 120_000);

  // ============================================================================
  // Core Scenarios
  // ============================================================================
  describe('Core Scenarios', () => {

    // ==========================================================================
    // 1. Single Hop — Funds (Route 1)
    //
    // On-chain execution flow:
    //   Push Chain tx:
    //     └─ Value transfer (0.001 PC) to target address on Push Chain
    // ==========================================================================
    describe('1. Single Hop — Funds (Route 1)', () => {
      it('should send a prepared Route 1 transaction', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const prepared = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        expect(prepared.route).toBe('UOA_TO_PUSH');

        const response = await executeCascade([prepared]);
        console.log(`[TEST] Route 1 TX Hash: ${response.initialTxHash}`);

        expect(response.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      }, 180000);
    });

    // ==========================================================================
    // 2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1
    // ==========================================================================
    // ==========================================================================
    // 2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: ERC20 approve call (payload only)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    └─ Value transfer (0.001 PC) to target
    // ==========================================================================
    describe('2. 3-Leg Cascade — Route 2 (Payload) + Route 3 + Route 1', () => {
      it('should send multi-hop: Payload to BNB + Inbound from BNB + Push transfer (MH-P-1)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 3-leg Payload — Route 2 + Route 3 + Route 1 ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [targetAddress, BigInt(1000000)],
        });

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Payload to BNB (ERC20 approve call)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_USDT_ADDRESS as `0x${string}`, chain: CHAIN.BNB_TESTNET },
          data: approvePayload,
        });

        // Hop 2: Route 3 — Inbound from BNB to Push Chain (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const result = await executeCascade([tx1, tx2, tx3]);

        console.log(`[TEST] Multi-hop Payload TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);
        expect(result.hops).toHaveLength(3);

        const cascadeEventStream: string[] = [];
        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
          eventHook: (event) => {
            cascadeEventStream.push(event.id);
            console.log(`[TEST:event] ${event.id} | ${event.title}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          expect(hop.outboundDetails).toBeDefined();
          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Multichain marker assertions — 3-hop cascade with R3 inbound
        expect(cascadeEventStream).toContain('SEND-TX-001');
        expect(cascadeEventStream.filter(id => id === 'SEND-TX-002-01').length).toBeGreaterThanOrEqual(2);
        expect(cascadeEventStream).toContain('SEND-TX-002-99-99');
        expect(cascadeEventStream).toContain('SEND-TX-999-01');
        // 001 must come first
        expect(cascadeEventStream.indexOf('SEND-TX-001')).toBe(0);
        // 999-01 must come last
        expect(cascadeEventStream[cascadeEventStream.length - 1]).toBe('SEND-TX-999-01');
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 3. 3-Leg Cascade — Route 2 (Funds) + Route 3 + Route 1
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value transfer (0.0001 BNB)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    └─ Value transfer (0.001 PC) to target
    // ==========================================================================
    describe('3. 3-Leg Cascade — Route 2 (Funds) + Route 3 + Route 1', () => {
      it('should send multi-hop: Outbound to BNB + Inbound from BNB + Push Chain transfer (MH-F-1)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 3-leg Cascade — Route 2 + Route 3 + Route 1 ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        // Read Push Chain counter BEFORE
        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE,
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE,
          functionName: 'increment',
        });

        // Hop 1: Route 2 — Value transfer outbound to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BNB to Push Chain (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        // Chain all 3 hops and send
        const result = await executeCascade([tx1, tx2, tx3]);

        console.log(`[TEST] 3-leg Cascade TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);
        expect(result.hops).toHaveLength(3);
        expect(typeof result.waitForAll).toBe('function');

        // Wait for all hops to complete
        const cascadeEventStream: string[] = [];
        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
          eventHook: (event) => {
            cascadeEventStream.push(event.id);
            console.log(`[TEST:event] ${event.id} | ${event.title}`);
          },
        });

        expect(completion.success).toBe(true);
        expect(completion.hops).toHaveLength(3);

        // Verify outbound tx on external chain
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          expect(hop.outboundDetails).toBeDefined();
          expectExternalTxHashForChain(
            hop.outboundDetails?.externalTxHash,
            hop.outboundDetails!.destinationChain
          );

          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify Push Chain counter incremented (Route 3 inbound)
        const maxInboundWait = 180000;
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < maxInboundWait) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE,
            abi: COUNTER_ABI_PAYABLE,
            functionName: 'countPC',
          }) as bigint;
          const elapsed = Math.round((Date.now() - pollStart) / 1000);
          console.log(`Polling counter: ${counterAfter} (elapsed: ${elapsed}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Multichain marker assertions — 3-hop with funds bridge
        expect(cascadeEventStream).toContain('SEND-TX-001');
        expect(cascadeEventStream).toContain('SEND-TX-002-01');
        expect(cascadeEventStream).toContain('SEND-TX-002-99-99');
        expect(cascadeEventStream).toContain('SEND-TX-999-01');
        expect(cascadeEventStream.indexOf('SEND-TX-001')).toBe(0);
        expect(cascadeEventStream[cascadeEventStream.length - 1]).toBe('SEND-TX-999-01');
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 4. 4-Leg Cascade — Route 2 (BNB Payload) + Route 3 + Route 1 + Route 2 (Solana)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: ERC20 approve call (payload only)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ Value transfer (0.001 PC) to target
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('4. 4-Leg Cascade — Route 2 (BNB Payload) + Route 3 + Route 1 + Route 2 (Solana)', () => {
      it('should send multi-hop: Payload to BNB + Inbound + Push + Solana (MH-P-2)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 4-leg Cascade — BNB + Inbound + Push + Solana ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const solanaTarget =
          '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'approve', args: [targetAddress, BigInt(1000000)],
        });
        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Payload to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_USDT_ADDRESS as `0x${string}`, chain: CHAIN.BNB_TESTNET },
          data: approvePayload,
        });

        // Hop 2: Route 3 — Inbound from BNB (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress, value: parseEther('0.001'),
        });

        // Hop 4: Route 2 — Value transfer to Solana Devnet
        const tx4 = await pushClient.universal.prepareTransaction({
          to: { address: solanaTarget, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await executeCascade([tx1, tx2, tx3, tx4]);

        console.log(`[TEST] 4-leg TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);
        expect(result.hops).toHaveLength(4);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        expect(outboundHops.length).toBe(2);
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 5. 4-Leg Cascade — Route 2 (BNB Funds) + Route 3 + Route 1 + Route 2 (Solana)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value transfer (0.0001 BNB)
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ Value transfer (0.001 PC) to target
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('5. 4-Leg Cascade — Route 2 (BNB Funds) + Route 3 + Route 1 + Route 2 (Solana)', () => {
      it('should send multi-hop: Funds to BNB + Inbound + Push + Solana (MH-F-2)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: 4-leg Funds — BNB + Inbound + Push + Solana ===');

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const solanaTarget =
          '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Value transfer to BNB
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: targetAddress, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BNB (increment counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Hop 3: Route 1 — Value transfer on Push Chain
        const tx3 = await pushClient.universal.prepareTransaction({
          to: targetAddress, value: parseEther('0.001'),
        });

        // Hop 4: Route 2 — Value transfer to Solana Devnet
        const tx4 = await pushClient.universal.prepareTransaction({
          to: { address: solanaTarget, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await executeCascade([tx1, tx2, tx3, tx4]);

        console.log(`[TEST] 4-leg Funds TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);
        expect(result.hops).toHaveLength(4);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        expect(outboundHops.length).toBe(2);
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          // Direct outbounds have outboundDetails; child outbounds (nested inside
          // Route 3 inbound) are auto-confirmed without external tx tracking.
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 6. Same-Chain Merging + Route 3 Inbound
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall — merged same-chain outbounds):
    //     ├─ Outbound → BSC: merged multicall [transfer to addr1, transfer to addr2]
    //     └─ Outbound → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload:
    //                    └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('6. Same-Chain Merging + Route 3 Inbound', () => {
      it('should send merged same-chain Route 2 hops then Route 3 inbound', async () => {
        if (skipE2E) return;

        const addr1 = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const addr2 = '0x0987654321098765432109876543210987654321' as `0x${string}`;

        const counterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${counterBefore}`);

        const incrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: addr1, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
        });

        const tx2 = await pushClient.universal.prepareTransaction({
          to: { address: addr2, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
        });

        // Hop 3: Route 3 — Inbound from BNB (increment counter)
        const tx3 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: incrementPayload,
        });

        // Send the merged same-chain hops + Route 3 inbound
        const result = await executeCascade([tx1, tx2, tx3]);

        console.log(`[TEST] Merged same-chain hops TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBeGreaterThanOrEqual(1);
        expect(result.hops.length).toBeGreaterThanOrEqual(1);
        expect(typeof result.waitForAll).toBe('function');

        // Wait for all hops to complete
        const cascadeEventStream: string[] = [];
        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
          eventHook: (event) => {
            cascadeEventStream.push(event.id);
            console.log(`[TEST:event] ${event.id} | ${event.title}`);
          },
        });

        expect(completion.success).toBe(true);

        // Verify outbound tx on external chain
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          console.log(`  External TX Hash: ${hop.outboundDetails?.externalTxHash}`);
          console.log(`  External Chain: ${hop.outboundDetails?.destinationChain}`);
          console.log(`  External Explorer: ${hop.outboundDetails?.explorerUrl}`);

          expect(hop.outboundDetails).toBeDefined();
          expectExternalTxHashForChain(
            hop.outboundDetails?.externalTxHash,
            hop.outboundDetails!.destinationChain
          );

          await verifyExternalTransaction(hop.outboundDetails!.externalTxHash, hop.outboundDetails!.destinationChain);
        }

        // Verify inbound: counter incremented
        const pollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Multichain marker assertions — same-chain merging keeps cascade markers
        expect(cascadeEventStream).toContain('SEND-TX-001');
        expect(cascadeEventStream).toContain('SEND-TX-002-01');
        expect(cascadeEventStream).toContain('SEND-TX-999-01');
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 7. Multi-Chain: BSC Payload + Inbound + Solana Bridge
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value (0.0001 BNB) + counter.increment() on BSC
    //     └─ Outbound 2 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (multicall):
    //                    ├─ counter.increment() on Push Chain
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (0.01 SOL)
    // ==========================================================================
    describe('7. Multi-Chain — R2(BSC payload) + R3(inbound) + R2(Solana)', () => {
      it('should bridge to BSC with counter increment, inbound to Push, then bridge to Solana', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Multi-Chain — BSC payload + Inbound + Solana ===');

        // Read BSC counter BEFORE
        const bscCounterBefore = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA BEFORE: ${bscCounterBefore}`);

        // Read Push Chain counter BEFORE
        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const bscIncrementPayload = encodeFunctionData({
          abi: BSC_COUNTER_ABI, functionName: 'increment',
        });
        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — BSC outbound (value + counter increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_COUNTER_PAYABLE, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          data: bscIncrementPayload,
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 3 — Inbound from BSC (increment Push Chain counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        // Hop 3: Route 2 — Solana outbound (value transfer)
        const tx3 = await pushClient.universal.prepareTransaction({
          to: { address: SOLANA_TARGET, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        const result = await executeCascade([tx1, tx2, tx3]);

        console.log(`[TEST] Multi-Chain TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(3);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify BSC outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify BSC counter incremented
        await new Promise((r) => setTimeout(r, 5000));
        const bscCounterAfter = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA AFTER: ${bscCounterAfter}`);
        expect(bscCounterAfter).toBeGreaterThan(bscCounterBefore);

        // Verify Push Chain counter incremented (Route 3 inbound)
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 8. Full Round-Trip: BSC + Solana CPI + BSC Inbound + Solana Inbound
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value (0.0001 BNB) + counter.increment() on BSC
    //     ├─ Outbound 2 → Solana: CPI receive_sol on test_counter program
    //     └─ Outbound 3 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC CEA creates inbound back to Push Chain
    //               └─ Push Chain executePayload (merged multicall):
    //                    ├─ counter.increment() on Push Chain (from both R3 hops)
    //                    ├─ pSOL.approve(UGPC)
    //                    └─ UGPC.sendOutbound → Solana (Solana R3 nested as child)
    // ==========================================================================
    describe('8. Full Round-Trip — R2(BSC payload) + R2(Solana CPI) + R3(BSC→Push) + R3(Sol→Push)', () => {
      it('should cascade across BSC and Solana with CPI + dual inbounds', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Full Round-Trip — BSC payload + Solana CPI + dual inbounds ===');

        // Read counters BEFORE
        const bscCounterBefore = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA BEFORE: ${bscCounterBefore}`);

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const bscIncrementPayload = encodeFunctionData({
          abi: BSC_COUNTER_ABI, functionName: 'increment',
        });
        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Solana CPI: receive_sol on test_counter
        const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
        const amountBuf = new Uint8Array(8);
        new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
        const ixData = new Uint8Array([...discriminator, ...amountBuf]);

        // Hop 1: Route 2 — BSC outbound (value + counter increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_COUNTER_PAYABLE, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          data: bscIncrementPayload,
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 2 — Solana outbound (CPI: receive_sol on test_counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(5_000_000),
          data: toHexData(ixData),
        });

        // Hop 3: Route 3 — Inbound from BSC (increment Push Chain counter #1)
        const tx3 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        // Hop 4: Route 3 — Inbound from Solana (increment Push Chain counter #2)
        const tx4 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await executeCascade([tx1, tx2, tx3, tx4]);

        console.log(`[TEST] Full Round-Trip TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(4);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify BSC outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify BSC counter incremented
        await new Promise((r) => setTimeout(r, 5000));
        const bscCounterAfter = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA AFTER: ${bscCounterAfter}`);
        expect(bscCounterAfter).toBeGreaterThan(bscCounterBefore);

        // Verify Push Chain counter incremented from BSC inbound
        // Both R3 hops' payloads (BSC + Solana) get merged into a single inbound
        // multicall by the cascade composition, so counter increments once (+1).
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 9. Solana-Originated Inbound — R2(Solana) + R3(Solana→Push)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     └─ Outbound → Solana: value transfer (0.01 SOL)
    //          └─ Solana delivery confirmed
    //               └─ Route 3 inbound from Solana → Push Chain
    //                    └─ Push Chain executePayload:
    //                         └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('9. Solana-Originated Inbound — R2(Solana) + R3(Solana→Push)', () => {
      it('should outbound to Solana then inbound from Solana to increment Push counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Solana-Originated Inbound ===');

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        // Hop 1: Route 2 — Solana outbound (value transfer)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: SOLANA_TARGET, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000),
        });

        // Hop 2: Route 3 — Inbound from Solana (increment Push Chain counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await executeCascade([tx1, tx2]);

        console.log(`[TEST] Solana Inbound TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(2);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify Solana outbound
        const outboundHops = completion.hops.filter(h => h.route === 'UOA_TO_CEA');
        for (const hop of outboundHops) {
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // Verify Push Chain counter incremented (Route 3 inbound from Solana)
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter}`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 10. StakingExample: STAKE Round-Trip (Smart Contract)
    //
    // On-chain execution flow:
    //   StakingExample.triggerOutbound(pUSDT, amount, payload)
    //     → BSC CEA multicall: [counter.increment, approve, sendUniversalTxToUEA(STAKE)]
    //     → Inbound: StakingExample.executeUniversalTx(action=STAKE)
    //     → stake balance increases
    // ==========================================================================
    describe('10. StakingExample: STAKE Round-Trip', () => {
      it('should trigger outbound with counter increment + STAKE inbound via smart contract', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: StakingExample STAKE Round-Trip ===');

        const bridgeAmount = BigInt(10000);
        const sendBackAmount = BigInt(5000);

        await ensurePushTokenBalance({
          label: 'StakingExample pUSDT bridge balance',
          token: PUSDT_BNB_TOKEN,
          holder: STAKING_PROXY,
          required: bridgeAmount,
          decimals: 6,
          allowUeaFallback: true,
        });

        // Read BSC counter BEFORE
        const counterBefore = await bscPublicClient.readContract({
          address: COUNTER_A_BSC, abi: COUNTER_ABI_BSC, functionName: 'count',
        }) as bigint;
        console.log(`BSC CounterA BEFORE: ${counterBefore}`);

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
          args: [ueaAddress, PUSDT_BNB_TOKEN],
        }) as bigint;
        console.log(`USDT Stake BEFORE: ${stakeBefore}`);

        // Build STAKE round-trip payload: counter.increment + approve + sendUniversalTxToUEA(STAKE)
        const incrementData = encodeFunctionData({ abi: COUNTER_ABI_BSC, functionName: 'increment' });

        const stakePayloadData = encodeAbiParameters(
          [{ name: 'action', type: 'uint8' }, { name: 'user', type: 'address' }, { name: 'executionPayload', type: 'bytes' }],
          [0, ueaAddress, '0x'] // action=0 (STAKE)
        );
        const universalPayload = encodeAbiParameters(
          [{ type: 'tuple', components: [
            { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
            { name: 'gasLimit', type: 'uint256' }, { name: 'maxFeePerGas', type: 'uint256' },
            { name: 'maxPriorityFeePerGas', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }, { name: 'vType', type: 'uint8' },
          ]}],
          [{
            to: ZERO_ADDRESS,
            value: BigInt(0),
            data: stakePayloadData,
            gasLimit: INBOUND_EXECUTION_GAS_LIMIT,
            maxFeePerGas: INBOUND_MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: BigInt(0),
            nonce: BigInt(0),
            deadline: BigInt(0),
            vType: 1,
          }]
        );
        // USDT requires allowance reset to 0 before setting a new non-zero value
        const approveZeroCalldata = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'approve', args: [UNIVERSAL_GATEWAY_BSC, BigInt(0)],
        });
        const approveCalldata = encodeFunctionData({
          abi: ERC20_EVM, functionName: 'approve', args: [UNIVERSAL_GATEWAY_BSC, sendBackAmount],
        });
        const sendBackCalldata = encodeFunctionData({
          abi: CEA_EVM, functionName: 'sendUniversalTxToUEA',
          args: [BSC_USDT_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
        });

        const ceaCalls = [
          { to: COUNTER_A_BSC, value: BigInt(0), data: incrementData },
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approveZeroCalldata },
          { to: BSC_USDT_ADDRESS as `0x${string}`, value: BigInt(0), data: approveCalldata },
          { to: stakingCeaAddress, value: BigInt(0), data: sendBackCalldata },
        ];
        const encoded = encodeAbiParameters(
          [{ type: 'tuple[]', components: [
            { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' },
          ]}],
          [ceaCalls]
        );
        const outboundPayload = `${UEA_MULTICALL_SELECTOR}${encoded.slice(2)}` as `0x${string}`;

        const fees = await queryOutboundGasFees(
          pushPublicClient,
          PUSDT_BNB_TOKEN,
          STAKING_OUTBOUND_GAS_LIMIT
        );
        const msgValue = await computeOutboundMsgValue(fees.nativeValueForGas);

        // Send triggerOutbound
        const triggerData = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI, functionName: 'triggerOutbound',
          args: [
            PUSDT_BNB_TOKEN,
            bridgeAmount,
            '0x' as `0x${string}`,
            STAKING_OUTBOUND_GAS_LIMIT,
            outboundPayload,
            ueaAddress,
          ],
        });
        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: triggerData,
          value: msgValue,
        });
        console.log(`triggerOutbound TX: ${tx.hash}`);
        const receipt = await tx.wait();
        expect(receipt.status).toBe(1);

        console.log('Polling for StakingExample outbound relay...');
        const outbound = await waitForOutboundRelay(
          tx.hash,
          PUSH_NETWORK.TESTNET_DONUT,
          { timeoutMs: LIVE_CASCADE_WAIT_TIMEOUT_MS }
        );
        console.log(`External TX Hash: ${outbound.externalTxHash}`);
        console.log(`External Chain: ${outbound.externalChain}`);
        console.log(`External Explorer: ${outbound.explorerUrl}`);
        expect(outbound.externalChain).toBe(CHAIN.BNB_TESTNET);
        await verifyExternalTransaction(
          outbound.externalTxHash,
          outbound.externalChain
        );

        // Verify BSC counter incremented (poll — relay takes variable time)
        console.log('Waiting for BSC counter increment...');
        const counterPollStart = Date.now();
        let counterAfter = counterBefore;
        while (Date.now() - counterPollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          counterAfter = await bscPublicClient.readContract({
            address: COUNTER_A_BSC, abi: COUNTER_ABI_BSC, functionName: 'count',
          }) as bigint;
          console.log(`Polling BSC counter: ${counterAfter} (elapsed: ${Math.round((Date.now() - counterPollStart) / 1000)}s)`);
          if (counterAfter > counterBefore) break;
        }
        console.log(`BSC CounterA AFTER: ${counterAfter}`);
        expect(counterAfter).toBeGreaterThan(counterBefore);

        // Verify Push Chain stake increased (inbound STAKE)
        console.log('Waiting for inbound STAKE...');
        const pollStart = Date.now();
        let stakeAfter = stakeBefore;
        while (Date.now() - pollStart < 300000) {
          stakeAfter = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, PUSDT_BNB_TOKEN],
          }) as bigint;
          console.log(`Polling stake: ${stakeAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (stakeAfter > stakeBefore) break;
          await new Promise((r) => setTimeout(r, 10000));
        }
        console.log(`Stake AFTER: ${stakeAfter}`);
        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 11. Solana CPI + Inbound — R2(Solana CPI) + R3(Solana→Push)
    //
    // On-chain execution flow:
    //   Push Chain tx:
    //     └─ Outbound → Solana: CPI receive_sol on test_counter program
    //          └─ Route 3 inbound from Solana → Push Chain
    //               └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('11. Solana CPI + Inbound — R2(Solana CPI) + R3(Solana→Push)', () => {
      it('should cascade CPI outbound to Solana then inbound to Push counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Solana CPI + Inbound ===');

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
        const amountBuf = new Uint8Array(8);
        new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
        const ixData = new Uint8Array([...discriminator, ...amountBuf]);

        // Hop 1: Route 2 — Solana CPI (receive_sol on test_counter)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(5_000_000),
          data: toHexData(ixData),
        });

        // Hop 2: Route 3 — Inbound from Solana (increment Push counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await executeCascade([tx1, tx2]);

        console.log(`[TEST] TX Hash: ${result.initialTxHash}`);
        expect(result.hopCount).toBe(2);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        for (const hop of completion.hops.filter(h => h.route === 'UOA_TO_CEA')) {
          if (hop.outboundDetails) {
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 12. Solana Value+CPI + Inbound — R2(Solana 0.01 SOL + CPI) + R3(Solana→Push)
    //
    // On-chain execution flow:
    //   Push Chain tx:
    //     └─ Outbound → Solana: value(0.01 SOL) + CPI receive_sol on test_counter
    //          └─ Route 3 inbound from Solana → Push Chain
    //               └─ counter.increment() on Push Chain
    // ==========================================================================
    describe('12. Solana Value+CPI + Inbound — R2(Solana FUNDS+CPI) + R3(Solana→Push)', () => {
      it('should cascade FUNDS+CPI outbound to Solana then inbound to Push counter', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Solana Value+CPI + Inbound ===');

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
        const amountBuf = new Uint8Array(8);
        new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
        const ixData = new Uint8Array([...discriminator, ...amountBuf]);

        // Hop 1: Route 2 — Solana FUNDS+CPI (0.01 SOL + receive_sol)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(10_000_000), // 0.01 SOL — larger value exercises FUNDS+CPI path
          data: toHexData(ixData),
        });

        // Hop 2: Route 3 — Inbound from Solana (increment Push counter)
        const tx2 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await executeCascade([tx1, tx2]);

        console.log(`[TEST] TX Hash: ${result.initialTxHash}`);
        expect(result.hopCount).toBe(2);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        for (const hop of completion.hops.filter(h => h.route === 'UOA_TO_CEA')) {
          if (hop.outboundDetails) {
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // 13. BSC + Solana CPI + Dual Inbound — R2(BSC) + R2(Sol CPI) + R3(BSC→Push) + R3(Sol→Push)
    //
    // On-chain execution flow:
    //   Push Chain tx (single multicall):
    //     ├─ Outbound 1 → BSC: value(0.0001 BNB) + counter.increment on BSC
    //     ├─ Outbound 2 → Solana: CPI receive_sol on test_counter
    //     └─ Outbound 3 → BSC: Route 3 CEA payload (sendUniversalTxToUEA)
    //          └─ BSC inbound → Push Chain executePayload (merged multicall):
    //               ├─ counter.increment() (from R3 BSC)
    //               └─ counter.increment() (from R3 Solana, merged)
    //               (both R3 payloads execute in single inbound, counter > before)
    // ==========================================================================
    describe('13. BSC + Solana CPI + Dual Inbound — explicit merge verification', () => {
      it('should cascade dual outbounds (BSC+Solana CPI) then merged inbound', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: BSC + Solana CPI + Dual Inbound ===');

        const bscCounterBefore = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC Counter BEFORE: ${bscCounterBefore}`);

        const pushCounterBefore = await pushPublicClient.readContract({
          address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
        }) as bigint;
        console.log(`Push Chain Counter BEFORE: ${pushCounterBefore}`);

        const bscIncrementPayload = encodeFunctionData({
          abi: BSC_COUNTER_ABI, functionName: 'increment',
        });
        const pushIncrementPayload = encodeFunctionData({
          abi: COUNTER_ABI_PAYABLE, functionName: 'increment',
        });

        const discriminator = new Uint8Array([121, 244, 250, 3, 8, 229, 225, 1]);
        const amountBuf = new Uint8Array(8);
        new DataView(amountBuf.buffer).setBigUint64(0, BigInt(1), true);
        const ixData = new Uint8Array([...discriminator, ...amountBuf]);

        // Hop 1: Route 2 — BSC outbound (value + counter increment)
        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: BSC_COUNTER_PAYABLE, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.0001'),
          data: bscIncrementPayload,
          gasLimit: BigInt(2000000),
        });

        // Hop 2: Route 2 — Solana CPI (receive_sol, direct outbound)
        const tx2 = await pushClient.universal.prepareTransaction({
          to: { address: SOL_TEST_PROGRAM, chain: CHAIN.SOLANA_DEVNET },
          value: BigInt(5_000_000),
          data: toHexData(ixData),
        });

        // Hop 3: Route 3 — Inbound from BSC (increment Push counter)
        const tx3 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.BNB_TESTNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        // Hop 4: Route 3 — Inbound from Solana (merged into hop 3's inbound)
        const tx4 = await pushClient.universal.prepareTransaction({
          from: { chain: CHAIN.SOLANA_DEVNET },
          to: COUNTER_ADDRESS_PAYABLE,
          data: pushIncrementPayload,
        });

        const result = await executeCascade([tx1, tx2, tx3, tx4]);

        console.log(`[TEST] TX Hash: ${result.initialTxHash}`);
        expect(result.hopCount).toBe(4);

        const completion = await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} route: ${event.route} status: ${event.status}`);
          },
        });
        expect(completion.success).toBe(true);

        // Verify direct outbounds (both R2 hops are before R3)
        for (const hop of completion.hops.filter(h => h.route === 'UOA_TO_CEA')) {
          if (hop.outboundDetails) {
            expectExternalTxHashForChain(
              hop.outboundDetails.externalTxHash,
              hop.outboundDetails.destinationChain
            );
            await verifyExternalTransaction(hop.outboundDetails.externalTxHash, hop.outboundDetails.destinationChain);
          }
        }

        // BSC counter incremented
        await new Promise((r) => setTimeout(r, 5000));
        const bscCounterAfter = await bscPublicClient.readContract({
          address: BSC_COUNTER_PAYABLE, abi: BSC_COUNTER_ABI, functionName: 'count',
        }) as bigint;
        console.log(`BSC Counter AFTER: ${bscCounterAfter}`);
        expect(bscCounterAfter).toBeGreaterThan(bscCounterBefore);

        // Push counter: both R3 payloads merge into single inbound
        const pollStart = Date.now();
        let pushCounterAfter = pushCounterBefore;
        while (Date.now() - pollStart < 180000) {
          await new Promise((r) => setTimeout(r, 10000));
          pushCounterAfter = await pushPublicClient.readContract({
            address: COUNTER_ADDRESS_PAYABLE, abi: COUNTER_ABI_PAYABLE, functionName: 'countPC',
          }) as bigint;
          console.log(`Polling Push counter: ${pushCounterAfter} (elapsed: ${Math.round((Date.now() - pollStart) / 1000)}s)`);
          if (pushCounterAfter > pushCounterBefore) break;
        }
        console.log(`Push Chain Counter AFTER: ${pushCounterAfter} (delta: ${pushCounterAfter - pushCounterBefore})`);
        expect(pushCounterAfter).toBeGreaterThan(pushCounterBefore);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });
  });

  // ============================================================================
  // Additional Tests
  // ============================================================================
  describe('Additional Tests', () => {

    // ==========================================================================
    // Transaction Preparation
    // ==========================================================================
    describe('Transaction Preparation', () => {
      it('should prepare a Push Chain transaction with HopDescriptor', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const prepared = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        console.log(`[TEST] Prepared Route: ${prepared.route}`);

        expect(prepared.route).toBe('UOA_TO_PUSH');
        expect(prepared._hop).toBeDefined();
        expect(prepared._hop.route).toBe('UOA_TO_PUSH');
        expect(prepared._hop.ueaAddress).toBe(ueaAddress);
        expect(prepared._hop.pushMulticalls).toBeDefined();
        expect(prepared._hop.pushMulticalls!.length).toBeGreaterThan(0);
        // PreparedUniversalTx no longer has thenOn/send; use executeTransactions([...]) instead
        expect(prepared._hop).toBeDefined();
        expect(prepared.route).toBeDefined();
      });

      it('should prepare an outbound transaction with HopDescriptor', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const prepared = await pushClient.universal.prepareTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        });

        console.log(`[TEST] Prepared Route: ${prepared.route}`);
        console.log(`[TEST] CEA Address: ${prepared._hop.ceaAddress}`);
        console.log(`[TEST] PRC20 Token: ${prepared._hop.prc20Token}`);
        console.log(`[TEST] Gas Token: ${prepared._hop.gasToken}`);
        console.log(`[TEST] Gas Fee: ${prepared._hop.gasFee}`);

        expect(prepared.route).toBe('UOA_TO_CEA');
        expect(prepared._hop).toBeDefined();
        expect(prepared._hop.route).toBe('UOA_TO_CEA');
        expect(prepared._hop.targetChain).toBe(CHAIN.BNB_TESTNET);
        expect(prepared._hop.ceaAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(prepared._hop.prc20Token).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(prepared._hop.ceaMulticalls).toBeDefined();
        expect(prepared._hop.ceaMulticalls!.length).toBeGreaterThan(0);
      }, 60000);

      it('should prepare two Route 2 txs to same chain (for merging test)', async () => {
        if (skipE2E) return;

        const addr1 = '0x1234567890123456789012345678901234567890' as `0x${string}`;
        const addr2 = '0x0987654321098765432109876543210987654321' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: addr1,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        });

        const tx2 = await pushClient.universal.prepareTransaction({
          to: {
            address: addr2,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        });

        // Both should be Route 2 targeting BNB Testnet
        expect(tx1.route).toBe('UOA_TO_CEA');
        expect(tx2.route).toBe('UOA_TO_CEA');
        expect(tx1._hop.targetChain).toBe(CHAIN.BNB_TESTNET);
        expect(tx2._hop.targetChain).toBe(CHAIN.BNB_TESTNET);

        // Do not call executeTransactions here: it broadcasts immediately.
        // Execution behavior is covered by the cascade execution tests below.
        expect(tx1._hop.ceaMulticalls).toBeDefined();
        expect(tx2._hop.ceaMulticalls).toBeDefined();
        expect(tx1._hop.ceaMulticalls!.length).toBeGreaterThan(0);
        expect(tx2._hop.ceaMulticalls!.length).toBeGreaterThan(0);
      }, 60000);
    });

    // ==========================================================================
    // Builder API
    // ==========================================================================
    describe('Array API', () => {
      it('should accept an array with a single prepared tx and return a promise', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const resultPromise = executeCascade([tx1]);
        expect(resultPromise).toBeInstanceOf(Promise);

        const result = await resultPromise;
        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(1);
        expect(typeof result.waitForAll).toBe('function');
      }, 180000);

      it('should accept an array with two prepared transactions and return a promise', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const tx2 = await pushClient.universal.prepareTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.0001'),
        });

        const resultPromise = executeCascade([tx1, tx2]);
        expect(resultPromise).toBeInstanceOf(Promise);

        const result = await resultPromise;
        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(2);
        expect(typeof result.waitForAll).toBe('function');
      }, 180000);
    });

    // ==========================================================================
    // Cascade Execution
    // ==========================================================================
    describe('Cascade Execution', () => {
      it('should send a single-hop cascade (Route 1)', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const result = await executeCascade([tx1]);

        console.log(`[TEST] Cascade initial TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(1);
        expect(result.hops).toHaveLength(1);
        expect(result.hops[0].route).toBe('UOA_TO_PUSH');
        expect(result.hops[0].status).toBe('confirmed');
        expect(typeof result.waitForAll).toBe('function');

        // Negative assertion — single-hop cascades MUST NOT emit multichain markers
        const cascadeEventStream: string[] = [];
        await result.waitForAll({
          eventHook: (event) => cascadeEventStream.push(event.id),
        });
        expect(cascadeEventStream).not.toContain('SEND-TX-001');
        expect(cascadeEventStream).not.toContain('SEND-TX-002-01');
        expect(cascadeEventStream).not.toContain('SEND-TX-002-99-99');
        expect(cascadeEventStream).not.toContain('SEND-TX-999-01');
      }, 180000);

      it('should send a single-hop cascade (Route 2)', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: {
            address: targetAddress,
            chain: CHAIN.BNB_TESTNET,
          },
          value: parseEther('0.00015'),
          gasLimit: BigInt(2000000),
        });

        const result = await executeCascade([tx1]);

        console.log(`[TEST] Cascade Route 2 TX Hash: ${result.initialTxHash}`);
        console.log(`[TEST] Hop count: ${result.hopCount}`);

        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(1);
        expect(result.hops).toHaveLength(1);
        expect(result.hops[0].route).toBe('UOA_TO_CEA');
        expect(result.hops[0].status).toBe('confirmed');

        // Negative assertion — single-hop cascades MUST NOT emit multichain markers
        const cascadeEventStream: string[] = [];
        await result.waitForAll({
          eventHook: (event) => cascadeEventStream.push(event.id),
        });
        expect(cascadeEventStream).not.toContain('SEND-TX-001');
        expect(cascadeEventStream).not.toContain('SEND-TX-002-01');
        expect(cascadeEventStream).not.toContain('SEND-TX-002-99-99');
        expect(cascadeEventStream).not.toContain('SEND-TX-999-01');
      }, 180000);

      // ==========================================================================
      // Multihop progress-hook sequence assertion
      //
      // Cascade semantics are different from single-tx: executeTransactions
      // builds ONE Push-chain multicall that fans out to multiple external
      // hops. It bypasses the per-route executeUoaToCea/executeCeaToPush
      // helpers, so R2/R3 pre-broadcast IDs (201-207, 301-307) do NOT fire
      // per-hop in cascades. Instead, the orchestrator emits the R1 sequence
      // for the meta Push-chain dispatch, and per-hop lifecycle events are
      // surfaced via result.waitForAll({ progressHook }).
      //
      // This test validates that:
      //   1. R1 SEND-TX-101..199 fire for the meta Push-chain multicall,
      //      with multihop terminal success mapped to 199-99 and final
      //      cascade success mapped to 999-01.
      //   2. Every emitted event carries a non-null response (doc requirement)
      //   3. waitForAll's hop-level progressHook receives per-hop events
      //      with known hop indices and a terminal status
      // Cheap: one 0.00015 BNB value transfer + one 0.001 PC Push transfer.
      // ==========================================================================
      it('multihop cascade emits R1 SEND-TX sequence + per-hop lifecycle events', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: { address: targetAddress, chain: CHAIN.BNB_TESTNET },
          value: parseEther('0.00015'),
          gasLimit: BigInt(2000000),
        });
        const tx2 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const result = await executeCascade([tx1, tx2]);
        expect(result.initialTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(result.hopCount).toBe(2);

        const hopEvents: Array<{ hopIndex: number; status: string; route?: string }> = [];
        await result.waitForAll({
          timeout: LIVE_CASCADE_WAIT_TIMEOUT_MS,
          progressHook: (event: any) => {
            hopEvents.push({
              hopIndex: event.hopIndex,
              status: event.status,
              route: event.route,
            });
          },
        });

        const ids = collectedProgressEvents.map((e) => e.id);
        console.log(
          `Multihop cascade SEND-TX sequence (${ids.length} events):`,
          ids.join(', ')
        );
        console.log(
          `Multihop hop-lifecycle events (${hopEvents.length}):`,
          hopEvents
            .map((h) => `hop${h.hopIndex}:${h.status}`)
            .join(', ')
        );

        // R1 meta-tx sequence fires for the Push-chain multicall
        expect(ids).toContain('SEND-TX-101');
        expect(ids).toContain('SEND-TX-107');
        expect(ids).toContain('SEND-TX-199-99');
        expect(ids).toContain('SEND-TX-999-01');
        expect(ids).not.toContain('SEND-TX-199-01');
        expect(ids.indexOf('SEND-TX-101')).toBeLessThan(
          ids.indexOf('SEND-TX-199-99')
        );

        // Per-hop lifecycle events fired via waitForAll
        const hopIndices = new Set(hopEvents.map((h) => h.hopIndex));
        expect(hopIndices.has(0)).toBe(true);
        expect(hopIndices.has(1)).toBe(true);
        // Any hop reached a terminal status (found/confirmed/failed/timeout)
        const terminalStatuses = new Set([
          'found',
          'confirmed',
          'failed',
          'timeout',
        ]);
        expect(
          hopEvents.some((h) => terminalStatuses.has(h.status))
        ).toBe(true);

        // Doc requirement: every orchestrator SEND-TX event has non-null response
        const nullResponseEvents = collectedProgressEvents.filter(
          (e) => e.response === null
        );
        if (nullResponseEvents.length) {
          console.log(
            'Multihop events with null response:',
            nullResponseEvents.map((e) => e.id)
          );
        }
        expect(nullResponseEvents.length).toBe(0);
      }, LIVE_CASCADE_TEST_TIMEOUT_MS);
    });

    // ==========================================================================
    // Execution Tracking
    // ==========================================================================
    describe('Execution Tracking', () => {
      it('should track Route 1 cascade with waitForAll', async () => {
        if (skipE2E) return;

        const targetAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`;

        const tx1 = await pushClient.universal.prepareTransaction({
          to: targetAddress,
          value: parseEther('0.001'),
        });

        const result = await executeCascade([tx1]);

        const completion = await result.waitForAll({
          timeout: 60000,
          progressHook: (event) => {
            console.log(`[TEST:waitForAll] hop ${event.hopIndex} status: ${event.status}`);
          },
        });

        expect(completion.success).toBe(true);
        expect(completion.hops).toHaveLength(1);
        expect(completion.hops[0].status).toBe('confirmed');
      }, 180000);
    });
  });
});
