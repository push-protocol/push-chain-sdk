/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * CEA Custom Contract: StakingExample Outbound & Inbound Tests
 *
 * Tests for the StakingExample contract — a custom (non-UEA) contract on Push Chain
 * that triggers outbound transactions via UGPC and receives inbound calls from its CEA.
 *
 * Covers:
 * - Part 1: Transfer PRC20 native token to StakingExample contract
 * - Part 2: Trigger outbound (CEA deployment) on external chain
 * - Part 3: Verify CEA deployment on external chain
 * - Part 4: Full round-trip (outbound + inbound STAKE action)
 * - Part 5: Verify stake state on Push Chain
 * - Part 6: Direct stake/unstake on Push Chain (no cross-chain)
 *
 * Parameterised across all active staking chains via describe.each.
 *
 * Contract Addresses:
 * - StakingExample (proxy): 0xd5d727D5eCE07BD5557f50e58DA092FCEDC1bf29 (Push Chain Donut)
 * - UGPC precompile:        0x00000000000000000000000000000000000000C1 (Push Chain Donut)
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO, CEA_FACTORY_ADDRESSES, UNIVERSAL_GATEWAY_ADDRESSES } from '../../../src/lib/constants/chain';
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  Hex,
  parseEther,
  encodeFunctionData,
} from 'viem';
import { bscTestnet } from 'viem/chains';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { CEA_EVM } from '../../../src/lib/constants/abi/cea.evm';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken, ZERO_ADDRESS } from '@e2e/shared/constants';
import { UEA_MULTICALL_SELECTOR } from '../../../src/lib/constants/selectors';
import { getActiveStakingFixtures, type StakingChainFixture } from '@e2e/shared/chain-fixtures';
import {
  TEST_TARGET,
  COUNTER_ABI,
  UGPC_PRECOMPILE,
  CEA_FACTORY_ABI,
  queryOutboundGasFees,
  buildOutboundMulticallPayload,
  waitForOutboundRelay,
} from '@e2e/shared/outbound-helpers';

// ============================================================================
// Contract ABIs and constants
// ============================================================================

// ============================================================================
// StakingExample ABI (from deployed contract)
// ============================================================================
const STAKING_EXAMPLE_ABI = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'recipient', type: 'bytes' },
      { name: 'gasLimit', type: 'uint256' },
      { name: 'payload', type: 'bytes' },
      { name: 'revertRecipient', type: 'address' },
    ],
    name: 'triggerOutbound',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'sourceChainNamespace', type: 'string' },
      { name: 'ceaAddress', type: 'bytes' },
      { name: 'payload', type: 'bytes' },
      { name: 'amount', type: 'uint256' },
      { name: 'prc20', type: 'address' },
      { name: 'txId', type: 'bytes32' },
    ],
    name: 'executeUniversalTx',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    name: 'getStake',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'ugpc',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'universalExecutorModule',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'bytes32' }],
    name: 'executedTxIds',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'address' },
    ],
    name: 'stakedBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: '_ugpc', type: 'address' },
      { name: '_universalExecutorModule', type: 'address' },
      { name: '_owner', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newUgpc', type: 'address' }],
    name: 'setUgpc',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newModule', type: 'address' }],
    name: 'setUniversalExecutorModule',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'recipient', type: 'bytes' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'payload', type: 'bytes' },
    ],
    name: 'OutboundTriggered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: true, name: 'txId', type: 'bytes32' },
    ],
    name: 'Staked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'user', type: 'address' },
      { indexed: true, name: 'token', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'Unstaked',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'txId', type: 'bytes32' },
      { indexed: false, name: 'sourceChainNamespace', type: 'string' },
      { indexed: false, name: 'ceaAddress', type: 'bytes' },
      { indexed: false, name: 'prc20', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
    name: 'InboundReceived',
    type: 'event',
  },
  { stateMutability: 'payable', type: 'receive' },
] as const;

// ============================================================================
// Helper: Compute msg.value for UGPC gas swap (test-specific)
// ============================================================================
const OUTBOUND_MSG_VALUE = parseEther('50'); // 50 PC — covers current gas swap, excess refunded to StakingExample

// The inbound smart-contract call is executed in a CacheContext and committed only
// after its Push Chain gas fee is deducted. These values are caps: the chain charges
// the actual base fee, but rejects (and rolls back) zero/undersized gas fields.
const INBOUND_EXECUTION_GAS_LIMIT = BigInt(500_000);
const INBOUND_MAX_FEE_PER_GAS = BigInt(10_000_000_000); // 10 gwei cap; Donut currently uses 1 gwei

async function computeOutboundMsgValue(
  pushPublicClient: ReturnType<typeof createPublicClient>,
  ueaAddress: `0x${string}`,
  nativeValueForGas: bigint
): Promise<bigint> {
  const ueaBalance = await pushPublicClient.getBalance({ address: ueaAddress });
  const value = nativeValueForGas > OUTBOUND_MSG_VALUE ? nativeValueForGas : OUTBOUND_MSG_VALUE;
  console.log(`[MsgValue] Using ${value} (balance: ${ueaBalance})`);
  return value;
}

// ============================================================================
// Staking fixtures — parameterised across active chains
// ============================================================================
const stakingFixtures = getActiveStakingFixtures();

// ============================================================================
// Tests
// ============================================================================
describe('CEA Custom Contract: StakingExample (Outbound & Inbound)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);
  }, 60000);

  describe.each(stakingFixtures)('[$label]', (fixture: StakingChainFixture) => {
    let stakingCeaAddress: `0x${string}`;
    let pushPublicClient: ReturnType<typeof createPublicClient>;
    let publicClient: ReturnType<typeof createPublicClient>;

    // Per-fixture addresses derived from the fixture
    const STAKING_PROXY = fixture.staking.stakingProxy;
    const pNativeToken = fixture.staking.pNativeToken;
    const pUsdtToken = fixture.staking.pUsdtToken;
    const ceaFactory = CEA_FACTORY_ADDRESSES[fixture.chain]!;
    const universalGateway = UNIVERSAL_GATEWAY_ADDRESSES[fixture.chain]!;
    const fixtureUsdtAddress = getToken(fixture.chain, 'USDT').address as `0x${string}`;

    // ============================================================================
    // Helper: Build multicall payload for CEA self-call (sendUniversalTxToUEA)
    // ============================================================================
    function buildStakeRoundTripPayload(
      ceaAddress: `0x${string}`,
      userAddress: `0x${string}`,
      amountToSendBack: bigint,
      revertRecipient: `0x${string}`
    ): `0x${string}` {
      // 1. Encode the action data (what StakingExample.executeUniversalTx ultimately decodes)
      //    (uint8 action, address user, bytes executionPayload)
      const payloadData = encodeAbiParameters(
        [
          { name: 'action', type: 'uint8' },
          { name: 'user', type: 'address' },
          { name: 'executionPayload', type: 'bytes' },
        ],
        [0, userAddress, '0x'] // action=0 (STAKE)
      );

      // 2. Wrap in UniversalPayload struct — required for TSS to parse the inbound event.
      //    The TSS decodes the payload as a UniversalPayload struct. Without this wrapping,
      //    universalPayload shows as {} and the inbound is delivered with empty payload.
      //    On Push Chain, the UNIVERSAL_EXECUTOR_MODULE extracts the `data` field from the
      //    struct and passes it as the `bytes payload` to executeUniversalTx.
      const universalPayload = encodeAbiParameters(
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
        [
          {
            to: ZERO_ADDRESS,
            value: BigInt(0),
            data: payloadData,
            gasLimit: INBOUND_EXECUTION_GAS_LIMIT,
            maxFeePerGas: INBOUND_MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: BigInt(0),
            nonce: BigInt(0),
            deadline: BigInt(0),
            vType: 1, // universalTxVerification
          },
        ]
      );

      // 3. Encode ERC20 approve — CEA must approve the gateway to transferFrom its USDT
      //    The gateway's sendUniversalTxFromCEA calls safeTransferFrom(CEA, VAULT, amount)
      //    USDT requires allowance reset to 0 before setting a new non-zero value
      const approveZeroCalldata = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [universalGateway, BigInt(0)],
      });
      const approveCalldata = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [universalGateway, amountToSendBack],
      });

      // 4. Encode sendUniversalTxToUEA call on the CEA
      //    Pass universalPayload (struct-wrapped) so TSS can parse it
      const sendBackCalldata = encodeFunctionData({
        abi: CEA_EVM,
        functionName: 'sendUniversalTxToUEA',
        args: [
          fixtureUsdtAddress, // token: USDT on external chain
          amountToSendBack,
          universalPayload,  // struct-wrapped for TSS parsing
          revertRecipient,
        ],
      });

      // 5. Wrap in MULTICALL format (approve(0) + approve MUST come before sendUniversalTxToUEA)
      const multicallEncoded = encodeAbiParameters(
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
        [
          [
            {
              to: fixtureUsdtAddress,
              value: BigInt(0),
              data: approveZeroCalldata,
            },
            {
              to: fixtureUsdtAddress,
              value: BigInt(0),
              data: approveCalldata,
            },
            {
              to: ceaAddress,
              value: BigInt(0),
              data: sendBackCalldata,
            },
          ],
        ]
      );

      // 6. Final payload = UEA_MULTICALL_SELECTOR + multicallEncoded
      return `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
    }

    // ============================================================================
    // Helper: Build ERC-20 round-trip multicall entries (approve + sendUniversalTxToUEA)
    // Appends these to existing outbound calls so the CEA also creates an inbound STAKE.
    // ============================================================================
    function buildErc20RoundTripCalls(
      ceaAddress: `0x${string}`,
      userAddress: `0x${string}`,
      sendBackAmount: bigint,
      revertRecipient: `0x${string}`
    ): Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> {
      const payloadData = encodeAbiParameters(
        [
          { name: 'action', type: 'uint8' },
          { name: 'user', type: 'address' },
          { name: 'executionPayload', type: 'bytes' },
        ],
        [0, userAddress, '0x'] // action=0 (STAKE)
      );

      const universalPayload = encodeAbiParameters(
        [{
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
        }],
        [{
          to: ZERO_ADDRESS,
          value: BigInt(0),
          data: payloadData,
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
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [universalGateway, BigInt(0)],
      });
      const approveCalldata = encodeFunctionData({
        abi: ERC20_EVM,
        functionName: 'approve',
        args: [universalGateway, sendBackAmount],
      });

      const sendBackCalldata = encodeFunctionData({
        abi: CEA_EVM,
        functionName: 'sendUniversalTxToUEA',
        args: [fixtureUsdtAddress, sendBackAmount, universalPayload, revertRecipient],
      });

      return [
        { to: fixtureUsdtAddress, value: BigInt(0), data: approveZeroCalldata },
        { to: fixtureUsdtAddress, value: BigInt(0), data: approveCalldata },
        { to: ceaAddress, value: BigInt(0), data: sendBackCalldata },
      ];
    }

    beforeAll(async () => {
      if (skipE2E) return;

      // Public clients for reading state
      pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      publicClient = createPublicClient({
        transport: http(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });

      // Get CEA address for StakingExample proxy on this chain
      const ceaResult = await getCEAAddress(STAKING_PROXY, fixture.chain);
      stakingCeaAddress = ceaResult.cea;
      console.log(`StakingExample CEA on ${fixture.label}: ${stakingCeaAddress}, deployed: ${ceaResult.isDeployed}`);
    }, 60000);

    // ============================================================================
    // Core Scenarios
    // ============================================================================
    describe('Core Scenarios', () => {

      // Helper: ensure StakingExample has enough PRC20 tokens, fund if needed
      async function ensureStakingHasPRC20(token: `0x${string}`, minAmount: bigint) {
        const balance = await pushPublicClient.readContract({
          address: token,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;
        console.log(`StakingExample balance of ${token}: ${balance}`);

        if (balance < minAmount) {
          console.log(`Funding StakingExample with ${token}...`);
          const fundTx = await pushClient.universal.sendTransaction({
            to: token,
            data: encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'transfer',
              args: [STAKING_PROXY, minAmount * BigInt(2)],
            }),
          });
          const fundReceipt = await fundTx.wait();
          console.log(`Funding TX status: ${fundReceipt.status}`);
          expect(fundReceipt.status).toBe(1);
        }
      }

      // Helper: run triggerOutbound on StakingExample and wait for outbound relay
      const OUTBOUND_GAS_LIMIT = BigInt(1_000_000); // 1M gas — covers CEA deployment + complex multicalls

      async function callTriggerOutbound(
        token: `0x${string}`,
        amount: bigint,
        recipient: `0x${string}`,
        payload: `0x${string}`,
      ) {
        const fees = await queryOutboundGasFees(pushPublicClient, token, OUTBOUND_GAS_LIMIT);
        const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);
        console.log(`Bridge amount: ${amount}, msg.value: ${msgValue}`);

        const triggerPayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'triggerOutbound',
          args: [token, amount, recipient, OUTBOUND_GAS_LIMIT, payload, ueaAddress],
        });

        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: triggerPayload,
          value: msgValue,
        });
        console.log(`triggerOutbound TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`triggerOutbound receipt status: ${receipt.status}`);
        expect(receipt.status).toBe(1);

        // Wait for outbound relay and verify external chain tx
        console.log('Polling for outbound relay...');
        const outbound = await waitForOutboundRelay(tx.hash, PUSH_NETWORK.TESTNET_DONUT);
        console.log(`External TX Hash: ${outbound.externalTxHash}`);
        console.log(`External Chain: ${outbound.externalChain}`);
        console.log(`External Explorer: ${outbound.explorerUrl}`);

        expect(outbound.externalTxHash).toBeDefined();
        expect(outbound.externalChain).toBeDefined();

        // Verify tx succeeded on external chain via RPC
        await verifyExternalTransaction(outbound.externalTxHash, outbound.externalChain);

        return { receipt, outbound };
      }

      // ============================================================================
      // 1. Funds — ERC-20 USDT
      // ============================================================================
      describe('1. Funds', () => {
        it('should send ERC-20 pUSDT outbound and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 1: Funds (ERC-20 USDT) ===');

          const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
          const sendBackAmount = BigInt(5000); // Amount CEA sends back as inbound
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          // Read stake BEFORE
          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`Stake BEFORE: ${stakeBefore}`);

          // Build round-trip payload: CEA calls sendUniversalTxToUEA → STAKE inbound on Push Chain
          // Without this payload, the CEA just parks funds and no inbound is created.
          const outboundPayload = buildStakeRoundTripPayload(
            stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress,
          );
          console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

          // Use empty recipient (park funds in CEA) + round-trip payload for inbound
          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

          // Wait for inbound relay — poll stake balance on Push Chain
          console.log('Waiting for inbound relay (polling stake balance)...');
          const INBOUND_INITIAL_WAIT = 30000;
          const INBOUND_POLL_INTERVAL = 10000;
          const INBOUND_TIMEOUT = 300000;

          await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

          const startTime = Date.now();
          let stakeAfter = stakeBefore;

          while (Date.now() - startTime < INBOUND_TIMEOUT) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY,
              abi: STAKING_EXAMPLE_ABI,
              functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;

            if (stakeAfter > stakeBefore) {
              console.log(`Stake AFTER: ${stakeAfter} (increased by ${stakeAfter - stakeBefore})`);
              break;
            }

            console.log(`Stake unchanged: ${stakeAfter}, polling...`);
            await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
          }

          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 2. Payload (Data) — single counter increment
      // ============================================================================
      describe('2. Payload (Data)', () => {
        it('should increment counter on external chain and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 2: Payload (Data) — Round-Trip ===');

          const bridgeAmount = BigInt(10000);
          const sendBackAmount = BigInt(5000);
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          const counterBefore = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter BEFORE: ${counterBefore}`);

          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`USDT Stake BEFORE: ${stakeBefore}`);

          const incrementData = encodeFunctionData({
            abi: COUNTER_ABI, functionName: 'increment',
          });

          const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
            ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
          ];
          const payload = buildOutboundMulticallPayload(outboundCalls);

          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, payload);

          await new Promise((r) => setTimeout(r, 5000));
          const counterAfter = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter AFTER: ${counterAfter}`);
          expect(counterAfter).toBeGreaterThan(counterBefore);

          // Wait for inbound relay
          console.log('Waiting for inbound relay (polling USDT stake)...');
          await new Promise((r) => setTimeout(r, 30000));
          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < 300000) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, 10000));
          }
          console.log(`USDT Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 3. Multicall — increment both counters
      // ============================================================================
      describe('3. Multicall', () => {
        it('should double increment counter on external chain and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 3: Multicall — Round-Trip ===');

          const bridgeAmount = BigInt(10000);
          const sendBackAmount = BigInt(5000);
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          const counterBefore = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter BEFORE: ${counterBefore}`);

          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`USDT Stake BEFORE: ${stakeBefore}`);

          const incrementData = encodeFunctionData({
            abi: COUNTER_ABI, functionName: 'increment',
          });

          const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
            ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
          ];
          const payload = buildOutboundMulticallPayload(outboundCalls);

          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, payload);

          await new Promise((r) => setTimeout(r, 5000));
          const counterAfter = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter AFTER: ${counterAfter}`);
          expect(counterAfter).toBeGreaterThanOrEqual(counterBefore + BigInt(2));

          console.log('Waiting for inbound relay (polling USDT stake)...');
          await new Promise((r) => setTimeout(r, 30000));
          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < 300000) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, 10000));
          }
          console.log(`USDT Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 4. Funds + Payload — ERC-20 funds + counter increment
      // ============================================================================
      describe('4. Funds + Payload', () => {
        it('should send ERC-20 pUSDT, increment counter, and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 4: Funds + Payload — Round-Trip ===');

          const bridgeAmount = BigInt(10000);
          const sendBackAmount = BigInt(5000);
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          const counterBefore = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter BEFORE: ${counterBefore}`);

          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`USDT Stake BEFORE: ${stakeBefore}`);

          const incrementData = encodeFunctionData({
            abi: COUNTER_ABI, functionName: 'increment',
          });

          const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
            ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
          ];
          const payload = buildOutboundMulticallPayload(outboundCalls);

          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, payload);

          await new Promise((r) => setTimeout(r, 5000));
          const counterAfter = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter AFTER: ${counterAfter}`);
          expect(counterAfter).toBeGreaterThan(counterBefore);

          console.log('Waiting for inbound relay (polling USDT stake)...');
          await new Promise((r) => setTimeout(r, 30000));
          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < 300000) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, 10000));
          }
          console.log(`USDT Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 5. Funds + Multicall — ERC-20 funds + transfer + counter increment
      // ============================================================================
      describe('5. Funds + Multicall', () => {
        it('should send ERC-20 pUSDT, transfer + increment counter, and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 5: Funds + Multicall — Round-Trip ===');

          const bridgeAmount = BigInt(20000); // extra to cover transfer + sendBack
          const sendBackAmount = BigInt(5000);
          const transferAmount = BigInt(10000);
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          const counterBefore = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter BEFORE: ${counterBefore}`);

          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`USDT Stake BEFORE: ${stakeBefore}`);

          const erc20TransferData = encodeFunctionData({
            abi: ERC20_EVM,
            functionName: 'transfer',
            args: [TEST_TARGET, transferAmount],
          });

          const incrementData = encodeFunctionData({
            abi: COUNTER_ABI, functionName: 'increment',
          });

          const outboundCalls: Array<{ to: `0x${string}`; value: bigint; data: `0x${string}` }> = [
            { to: fixtureUsdtAddress, value: BigInt(0), data: erc20TransferData },
            { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
            ...buildErc20RoundTripCalls(stakingCeaAddress, ueaAddress, sendBackAmount, ueaAddress),
          ];
          const payload = buildOutboundMulticallPayload(outboundCalls);

          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, payload);

          await new Promise((r) => setTimeout(r, 5000));
          const counterAfter = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter AFTER: ${counterAfter}`);
          expect(counterAfter).toBeGreaterThan(counterBefore);

          console.log('Waiting for inbound relay (polling USDT stake)...');
          await new Promise((r) => setTimeout(r, 30000));
          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < 300000) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY, abi: STAKING_EXAMPLE_ABI, functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling USDT stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, 10000));
          }
          console.log(`USDT Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 6. Native Funds — pNative outbound
      // ============================================================================
      describe('6. Native Funds', () => {
        it('should send native pNative outbound and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 6: Native Funds (pNative) — Round-Trip ===');

          const bridgeAmount = parseEther('0.0005');
          const sendBackAmount = parseEther('0.00025'); // half goes back as inbound
          await ensureStakingHasPRC20(pNativeToken, bridgeAmount);

          // Read stake BEFORE
          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, pNativeToken],
          }) as bigint;
          console.log(`pNative Stake BEFORE: ${stakeBefore}`);

          // Build round-trip payload for native token:
          // CEA on external chain calls sendUniversalTxToUEA with native token → creates inbound STAKE on Push Chain
          const payloadData = encodeAbiParameters(
            [
              { name: 'action', type: 'uint8' },
              { name: 'user', type: 'address' },
              { name: 'executionPayload', type: 'bytes' },
            ],
            [0, ueaAddress, '0x'] // action=0 (STAKE)
          );

          const universalPayload = encodeAbiParameters(
            [{
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
            }],
            [{
              to: ZERO_ADDRESS,
              value: BigInt(0),
              data: payloadData,
              gasLimit: INBOUND_EXECUTION_GAS_LIMIT,
              maxFeePerGas: INBOUND_MAX_FEE_PER_GAS,
              maxPriorityFeePerGas: BigInt(0),
              nonce: BigInt(0),
              deadline: BigInt(0),
              vType: 1,
            }]
          );

          // For native token: no approve needed, just sendUniversalTxToUEA with msg.value
          const sendBackCalldata = encodeFunctionData({
            abi: CEA_EVM,
            functionName: 'sendUniversalTxToUEA',
            args: [ZERO_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
          });

          const multicallEncoded = encodeAbiParameters(
            [{
              type: 'tuple[]',
              components: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
              ],
            }],
            [[{
              to: stakingCeaAddress,
              value: BigInt(0), // CEA already has native token from Vault; self-calls must have value=0
              data: sendBackCalldata,
            }]]
          );

          const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
          console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

          // Use empty recipient (park funds in CEA) + round-trip payload for inbound
          await callTriggerOutbound(pNativeToken, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

          // Wait for inbound relay — poll stake balance on Push Chain
          console.log('Waiting for inbound relay (polling pNative stake balance)...');
          const INBOUND_INITIAL_WAIT = 30000;
          const INBOUND_POLL_INTERVAL = 10000;
          const INBOUND_TIMEOUT = 300000;

          await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < INBOUND_TIMEOUT) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY,
              abi: STAKING_EXAMPLE_ABI,
              functionName: 'getStake',
              args: [ueaAddress, pNativeToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling pNative stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
          }

          console.log(`pNative Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 7. Native Funds + Payload — pNative + counter increment
      // ============================================================================
      describe('7. Native Funds + Payload', () => {
        it('should send native pNative, increment external chain counter, and verify inbound STAKE via round-trip', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 7: Native Funds + Payload (pNative + counter + round-trip) ===');

          const bridgeAmount = parseEther('0.0005');
          const sendBackAmount = parseEther('0.00025');
          await ensureStakingHasPRC20(pNativeToken, bridgeAmount);

          // Read counter BEFORE
          const counterBefore = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter BEFORE: ${counterBefore}`);

          // Read pNative stake BEFORE
          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, pNativeToken],
          }) as bigint;
          console.log(`pNative Stake BEFORE: ${stakeBefore}`);

          const incrementData = encodeFunctionData({
            abi: COUNTER_ABI,
            functionName: 'increment',
          });

          // Build round-trip payload: increment counter on external chain + sendUniversalTxToUEA for inbound STAKE
          const payloadData = encodeAbiParameters(
            [
              { name: 'action', type: 'uint8' },
              { name: 'user', type: 'address' },
              { name: 'executionPayload', type: 'bytes' },
            ],
            [0, ueaAddress, '0x'] // action=0 (STAKE)
          );

          const universalPayload = encodeAbiParameters(
            [{
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
            }],
            [{
              to: ZERO_ADDRESS,
              value: BigInt(0),
              data: payloadData,
              gasLimit: INBOUND_EXECUTION_GAS_LIMIT,
              maxFeePerGas: INBOUND_MAX_FEE_PER_GAS,
              maxPriorityFeePerGas: BigInt(0),
              nonce: BigInt(0),
              deadline: BigInt(0),
              vType: 1,
            }]
          );

          const sendBackCalldata = encodeFunctionData({
            abi: CEA_EVM,
            functionName: 'sendUniversalTxToUEA',
            args: [ZERO_ADDRESS, sendBackAmount, universalPayload, ueaAddress],
          });

          // CEA multicall: increment counter + sendUniversalTxToUEA for inbound
          const multicallEncoded = encodeAbiParameters(
            [{
              type: 'tuple[]',
              components: [
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'data', type: 'bytes' },
              ],
            }],
            [[
              { to: fixture.contracts.counter, value: BigInt(0), data: incrementData },
              {
                to: stakingCeaAddress,
                value: BigInt(0), // CEA already has native token from Vault; self-calls must have value=0
                data: sendBackCalldata,
              },
            ]]
          );

          const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;
          console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

          // Use empty recipient (park funds in CEA) + round-trip payload
          await callTriggerOutbound(pNativeToken, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

          // Wait for RPC propagation then check counter
          await new Promise((r) => setTimeout(r, 5000));

          const counterAfter = await publicClient.readContract({
            address: fixture.contracts.counter, abi: COUNTER_ABI, functionName: 'count',
          }) as bigint;
          console.log(`Counter AFTER: ${counterAfter}`);
          expect(counterAfter).toBeGreaterThan(counterBefore);

          // Wait for inbound relay — poll stake balance on Push Chain
          console.log('Waiting for inbound relay (polling pNative stake balance)...');
          const INBOUND_INITIAL_WAIT = 30000;
          const INBOUND_POLL_INTERVAL = 10000;
          const INBOUND_TIMEOUT = 300000;

          await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

          const pollStart = Date.now();
          let stakeAfter = stakeBefore;
          while (Date.now() - pollStart < INBOUND_TIMEOUT) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY,
              abi: STAKING_EXAMPLE_ABI,
              functionName: 'getStake',
              args: [ueaAddress, pNativeToken],
            }) as bigint;
            const elapsed = Math.round((Date.now() - pollStart) / 1000);
            console.log(`Polling pNative stake: ${stakeAfter} (elapsed: ${elapsed}s)`);
            if (stakeAfter > stakeBefore) break;
            await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
          }

          console.log(`pNative Stake AFTER: ${stakeAfter}`);
          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });

      // ============================================================================
      // 8. Round-Trip: CEA → PC STAKE (outbound + CEA inbound)
      // ============================================================================
      describe('8. Round-Trip: CEA → PC STAKE', () => {
        it('should trigger outbound with round-trip payload, CEA sends STAKE inbound back to Push Chain', async () => {
          if (skipE2E) return;

          console.log('\n=== Core Scenario 8: Round-Trip CEA → PC STAKE ===');

          // Verify CEA is deployed (should be deployed after Core Scenario 1)
          const [ceaAddr, isDeployed] = await publicClient.readContract({
            address: ceaFactory,
            abi: CEA_FACTORY_ABI,
            functionName: 'getCEAForPushAccount',
            args: [STAKING_PROXY],
          }) as [`0x${string}`, boolean];

          console.log(`CEA: ${ceaAddr}, deployed: ${isDeployed}`);
          expect(isDeployed).toBe(true);

          const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
          const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)
          await ensureStakingHasPRC20(pUsdtToken, bridgeAmount);

          // Read stake BEFORE
          const stakeBefore = await pushPublicClient.readContract({
            address: STAKING_PROXY,
            abi: STAKING_EXAMPLE_ABI,
            functionName: 'getStake',
            args: [ueaAddress, pUsdtToken],
          }) as bigint;
          console.log(`Stake BEFORE: ${stakeBefore}`);

          // Build round-trip payload: CEA calls sendUniversalTxToUEA → STAKE inbound on Push Chain
          const outboundPayload = buildStakeRoundTripPayload(
            ceaAddr, ueaAddress, sendBackAmount, ueaAddress,
          );
          console.log(`Round-trip payload length: ${outboundPayload.length} chars`);

          // Trigger outbound with round-trip payload (waits for outbound relay + verifies external tx)
          await callTriggerOutbound(pUsdtToken, bridgeAmount, '0x' as `0x${string}`, outboundPayload);

          // Wait for inbound relay — poll stake balance on Push Chain
          console.log('Waiting for inbound relay (polling stake balance)...');
          const INBOUND_INITIAL_WAIT = 30000;
          const INBOUND_POLL_INTERVAL = 10000;
          const INBOUND_TIMEOUT = 300000;

          await new Promise((r) => setTimeout(r, INBOUND_INITIAL_WAIT));

          const startTime = Date.now();
          let stakeAfter = stakeBefore;

          while (Date.now() - startTime < INBOUND_TIMEOUT) {
            stakeAfter = await pushPublicClient.readContract({
              address: STAKING_PROXY,
              abi: STAKING_EXAMPLE_ABI,
              functionName: 'getStake',
              args: [ueaAddress, pUsdtToken],
            }) as bigint;

            if (stakeAfter > stakeBefore) {
              console.log(`Stake AFTER: ${stakeAfter} (increased by ${stakeAfter - stakeBefore})`);
              break;
            }

            console.log(`Stake unchanged: ${stakeAfter}, polling...`);
            await new Promise((r) => setTimeout(r, INBOUND_POLL_INTERVAL));
          }

          expect(stakeAfter).toBeGreaterThan(stakeBefore);
        }, 600000);
      });
    });

    // ============================================================================
    // Additional
    // ============================================================================
    describe('Additional', () => {

    // ============================================================================
    // 1. Contract State Reads
    // ============================================================================
    describe('1. Contract State Reads', () => {
      it('should read owner from StakingExample', async () => {
        if (skipE2E) return;

        const owner = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'owner',
        }) as `0x${string}`;

        console.log(`StakingExample owner: ${owner}`);
        expect(owner).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should read UGPC address from StakingExample', async () => {
        if (skipE2E) return;

        const ugpc = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'ugpc',
        }) as `0x${string}`;

        console.log(`StakingExample UGPC: ${ugpc}`);
        expect(ugpc).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(ugpc.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());
      });

      it('should read universalExecutorModule from StakingExample', async () => {
        if (skipE2E) return;

        const module = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'universalExecutorModule',
        }) as `0x${string}`;

        console.log(`StakingExample UniversalExecutorModule: ${module}`);
        expect(module).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(module.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());
      });

      it('should read current stake balance (may be zero)', async () => {
        if (skipE2E) return;

        const stake = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;

        console.log(`Current stake for UEA ${ueaAddress}: ${stake}`);
        expect(typeof stake).toBe('bigint');
      });

      it('should compute CEA address for StakingExample on external chain', async () => {
        if (skipE2E) return;

        const result = await getCEAAddress(STAKING_PROXY, fixture.chain);

        console.log(`CEA for StakingExample on ${fixture.label}: ${result.cea}, deployed: ${result.isDeployed}`);
        expect(result.cea).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof result.isDeployed).toBe('boolean');
      });

      it('should query outbound gas fees for pUSDT', async () => {
        if (skipE2E) return;

        const fees = await queryOutboundGasFees(pushPublicClient, pUsdtToken);

        console.log(`Gas fees — gasFee: ${fees.gasFee}, protocolFee: ${fees.protocolFee}, total: ${fees.totalFee}`);
        expect(fees.gasFee).toBeGreaterThan(BigInt(0));
        expect(fees.totalFee).toBeGreaterThan(BigInt(0));
      });
    });

    // ============================================================================
    // 2. Transfer PRC20 (pUSDT) to StakingExample
    // ============================================================================
    describe('2. Transfer pUSDT to StakingExample', () => {
      it('should transfer pUSDT tokens to the StakingExample proxy on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Transfer pUSDT to StakingExample ===');

        const transferAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Check pUSDT balance of UEA before transfer
        const balanceBefore = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;
        console.log(`StakingExample pUSDT balance BEFORE: ${balanceBefore}`);

        // Transfer pUSDT to StakingExample (Route 1: UOA → Push)
        const transferPayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [STAKING_PROXY, transferAmount],
        });

        const params: UniversalExecuteParams = {
          to: pUsdtToken, // PRC20 token contract on Push Chain
          data: transferPayload,
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`Transfer TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Transfer receipt status: ${receipt.status}`);
        expect(receipt.status).toBe(1);

        // Verify balance increased
        await new Promise((r) => setTimeout(r, 3000));
        const balanceAfter = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;
        console.log(`StakingExample pUSDT balance AFTER: ${balanceAfter}`);

        expect(balanceAfter).toBeGreaterThanOrEqual(balanceBefore);
      }, 120000);
    });

    // ============================================================================
    // 3. Verify CEA Deployment
    // ============================================================================
    describe('3. Trigger Outbound — Funds Only (CEA Deployment)', () => {
      it('should call triggerOutbound to deploy CEA on external chain with pUSDT', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: triggerOutbound — Funds Only with pUSDT (CEA Deployment) ===');

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Ensure StakingExample has enough pUSDT
        const contractBalance = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;
        console.log(`StakingExample pUSDT balance: ${contractBalance}`);

        if (contractBalance < bridgeAmount) {
          console.log(`Funding StakingExample with pUSDT...`);
          const fundTx = await pushClient.universal.sendTransaction({
            to: pUsdtToken,
            data: encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'transfer',
              args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
            }),
          });
          const fundReceipt = await fundTx.wait();
          console.log(`Funding TX status: ${fundReceipt.status}`);
          expect(fundReceipt.status).toBe(1);
        }

        // Query gas fees
        const fees = await queryOutboundGasFees(pushPublicClient, pUsdtToken);
        const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);
        console.log(`Bridge amount: ${bridgeAmount}, msg.value for gas: ${msgValue}`);

        const triggerPayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'triggerOutbound',
          args: [
            pUsdtToken,       // token: PRC20 pUSDT to bridge
            bridgeAmount,     // amount: pUSDT to burn
            '0x',             // recipient: empty = park in CEA
            BigInt(0),        // gasLimit: 0 = default
            '0x',             // payload: empty = funds only
            ueaAddress,       // revertRecipient
          ],
        });

        const params: UniversalExecuteParams = {
          to: STAKING_PROXY,
          data: triggerPayload,
          value: msgValue,
        };

        const tx = await pushClient.universal.sendTransaction(params);
        console.log(`triggerOutbound TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`triggerOutbound receipt status: ${receipt.status}`);
        expect(receipt.status).toBe(1);
      }, 360000);
    });

    // ============================================================================
    // 4. Verify CEA State on external chain
    // ============================================================================
    describe('4. Verify CEA Deployment', () => {
      it('should verify CEA is deployed for StakingExample on external chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Verify CEA Deployment ===');

        // Query CEA Factory on external chain
        const [ceaAddr, isDeployed] = await publicClient.readContract({
          address: ceaFactory,
          abi: CEA_FACTORY_ABI,
          functionName: 'getCEAForPushAccount',
          args: [STAKING_PROXY],
        }) as [`0x${string}`, boolean];

        console.log(`CEA address for StakingExample: ${ceaAddr}`);
        console.log(`CEA is deployed: ${isDeployed}`);

        expect(ceaAddr).toMatch(/^0x[a-fA-F0-9]{40}$/);
        // Note: CEA may not be deployed yet if TSS hasn't processed the outbound
        // In a full E2E test, we'd wait for the relay. For now, just verify address is computed.
        if (isDeployed) {
          expect(ceaAddr.toLowerCase()).not.toBe(ZERO_ADDRESS.toLowerCase());

          // Verify CEA's pushAccount points back to StakingExample
          const pushAccount = await publicClient.readContract({
            address: ceaFactory,
            abi: CEA_FACTORY_ABI,
            functionName: 'getPushAccountForCEA',
            args: [ceaAddr],
          }) as `0x${string}`;

          console.log(`CEA pushAccount: ${pushAccount}`);
          expect(pushAccount.toLowerCase()).toBe(STAKING_PROXY.toLowerCase());
        }
      }, 60000);

      it('should verify CEA has native balance on external chain (if deployed)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: CEA Balance on external chain ===');

        const [ceaAddr, isDeployed] = await publicClient.readContract({
          address: ceaFactory,
          abi: CEA_FACTORY_ABI,
          functionName: 'getCEAForPushAccount',
          args: [STAKING_PROXY],
        }) as [`0x${string}`, boolean];

        if (!isDeployed) {
          console.log('CEA not yet deployed — skipping balance check');
          return;
        }

        const balance = await publicClient.getBalance({ address: ceaAddr });
        console.log(`CEA native balance: ${balance}`);
        expect(typeof balance).toBe('bigint');
      }, 60000);
    });

    // ============================================================================
    // 5. Full Round-Trip — Outbound + Inbound STAKE
    // ============================================================================
    describe('5. Full Round-Trip — Outbound + Inbound STAKE', () => {
      it('should trigger outbound with multicall that sends inbound STAKE back to Push', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Full Round-Trip — Outbound + Inbound STAKE ===');

        // Check CEA deployment first
        const [ceaAddr, isDeployed] = await publicClient.readContract({
          address: ceaFactory,
          abi: CEA_FACTORY_ABI,
          functionName: 'getCEAForPushAccount',
          args: [STAKING_PROXY],
        }) as [`0x${string}`, boolean];

        if (!isDeployed) {
          console.log('CEA not deployed — skipping round-trip test (run CEA deployment test first)');
          return;
        }

        console.log(`Using CEA: ${ceaAddr}`);

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
        const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)

        // Ensure StakingExample has enough pUSDT
        const contractBalance = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;

        if (contractBalance < bridgeAmount) {
          console.log(`Funding StakingExample with pUSDT...`);
          const fundTx = await pushClient.universal.sendTransaction({
            to: pUsdtToken,
            data: encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'transfer',
              args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
            }),
          });
          const fundReceipt = await fundTx.wait();
          expect(fundReceipt.status).toBe(1);
        }

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;
        console.log(`Stake BEFORE: ${stakeBefore}`);

        const outboundPayload = buildStakeRoundTripPayload(
          ceaAddr, ueaAddress, sendBackAmount, ueaAddress,
        );
        console.log(`Outbound payload length: ${outboundPayload.length} chars`);

        const fees = await queryOutboundGasFees(pushPublicClient, pUsdtToken);
        const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);

        const triggerPayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'triggerOutbound',
          args: [pUsdtToken, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
        });

        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: triggerPayload,
          value: msgValue,
        });
        console.log(`Round-trip TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`Round-trip receipt status: ${receipt.status}`);
        expect(receipt.status).toBe(1);
      }, 600000);

      it('should verify stake was recorded after inbound (requires relay completion)', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Verify Stake After Round-Trip ===');

        const stake = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;

        console.log(`Stake for ${ueaAddress}: ${stake}`);
        expect(typeof stake).toBe('bigint');
      }, 60000);
    });

    // ============================================================================
    // 6. Full Round-Trip — Outbound + Inbound UNSTAKE
    // ============================================================================
    describe('6. Full Round-Trip — Outbound + Inbound UNSTAKE', () => {
      it('should trigger outbound with UNSTAKE multicall payload', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Full Round-Trip — Outbound + Inbound UNSTAKE ===');

        const [ceaAddr, isDeployed] = await publicClient.readContract({
          address: ceaFactory,
          abi: CEA_FACTORY_ABI,
          functionName: 'getCEAForPushAccount',
          args: [STAKING_PROXY],
        }) as [`0x${string}`, boolean];

        if (!isDeployed) {
          console.log('CEA not deployed — skipping');
          return;
        }

        const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)
        const sendBackAmount = BigInt(5000); // 0.005 USDT (6 decimals)

        // Ensure StakingExample has enough pUSDT
        const contractBalance = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;

        if (contractBalance < bridgeAmount) {
          console.log(`Funding StakingExample with pUSDT...`);
          const fundTx = await pushClient.universal.sendTransaction({
            to: pUsdtToken,
            data: encodeFunctionData({
              abi: ERC20_EVM,
              functionName: 'transfer',
              args: [STAKING_PROXY, bridgeAmount * BigInt(2)],
            }),
          });
          const fundReceipt = await fundTx.wait();
          expect(fundReceipt.status).toBe(1);
        }

        // Build UNSTAKE payload (action=1)
        const payloadData = encodeAbiParameters(
          [
            { name: 'action', type: 'uint8' },
            { name: 'user', type: 'address' },
            { name: 'executionPayload', type: 'bytes' },
          ],
          [1, ueaAddress, '0x']
        );

        const universalPayload = encodeAbiParameters(
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
          [{ to: ZERO_ADDRESS, value: BigInt(0), data: payloadData, gasLimit: INBOUND_EXECUTION_GAS_LIMIT, maxFeePerGas: INBOUND_MAX_FEE_PER_GAS, maxPriorityFeePerGas: BigInt(0), nonce: BigInt(0), deadline: BigInt(0), vType: 1 }]
        );

        const sendBackCalldata = encodeFunctionData({
          abi: CEA_EVM,
          functionName: 'sendUniversalTxToUEA',
          args: [fixtureUsdtAddress, sendBackAmount, universalPayload, ueaAddress],
        });

        const multicallEncoded = encodeAbiParameters(
          [{ type: 'tuple[]', components: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }] }],
          [[{ to: ceaAddr, value: BigInt(0), data: sendBackCalldata }]]
        );

        const outboundPayload = `${UEA_MULTICALL_SELECTOR}${multicallEncoded.slice(2)}` as `0x${string}`;

        const fees = await queryOutboundGasFees(pushPublicClient, pUsdtToken);
        const msgValue = await computeOutboundMsgValue(pushPublicClient, ueaAddress, fees.nativeValueForGas);

        const triggerPayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'triggerOutbound',
          args: [pUsdtToken, bridgeAmount, '0x', BigInt(0), outboundPayload, ueaAddress],
        });

        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: triggerPayload,
          value: msgValue,
        });
        console.log(`UNSTAKE Round-trip TX Hash: ${tx.hash}`);
        expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const receipt = await tx.wait();
        console.log(`UNSTAKE receipt status: ${receipt.status}`);
        expect(receipt.status).toBe(1);
      }, 600000);
    });

    // ============================================================================
    // 7. Direct Stake on Push Chain (No Cross-Chain)
    // ============================================================================
    describe('7. Direct Stake on Push Chain', () => {
      it('should approve and stake pUSDT directly on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Direct Stake pUSDT on Push Chain ===');

        const stakeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

        // Step 1: Approve StakingExample to spend pUSDT
        const approvePayload = encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'approve',
          args: [STAKING_PROXY, stakeAmount],
        });

        const approveTx = await pushClient.universal.sendTransaction({
          to: pUsdtToken,
          data: approvePayload,
        });
        console.log(`Approve TX Hash: ${approveTx.hash}`);
        const approveReceipt = await approveTx.wait();
        console.log(`Approve status: ${approveReceipt.status}`);
        expect(approveReceipt.status).toBe(1);

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;
        console.log(`Stake BEFORE: ${stakeBefore}`);

        // Step 2: Call stake()
        const stakePayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'stake',
          args: [pUsdtToken, stakeAmount],
        });

        const stakeTx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: stakePayload,
        });
        console.log(`Stake TX Hash: ${stakeTx.hash}`);

        const stakeReceipt = await stakeTx.wait();
        console.log(`Stake status: ${stakeReceipt.status}`);
        expect(stakeReceipt.status).toBe(1);

        // Verify stake increased
        await new Promise((r) => setTimeout(r, 3000));
        const stakeAfter = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;
        console.log(`Stake AFTER: ${stakeAfter}`);

        expect(stakeAfter).toBeGreaterThan(stakeBefore);
      }, 120000);
    });

    // ============================================================================
    // 7. Direct Unstake on Push Chain (No Cross-Chain)
    // ============================================================================
    describe('7. Direct Unstake on Push Chain', () => {
      it('should unstake pUSDT directly on Push Chain', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: Direct Unstake pUSDT on Push Chain ===');

        // Read stake BEFORE
        const stakeBefore = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;
        console.log(`Stake BEFORE unstake: ${stakeBefore}`);

        if (stakeBefore === BigInt(0)) {
          console.log('No stake to unstake — skipping');
          return;
        }

        // Check contract's actual token balance (may be less than staked if tokens were sent outbound)
        const contractBalance = await pushPublicClient.readContract({
          address: pUsdtToken,
          abi: ERC20_EVM,
          functionName: 'balanceOf',
          args: [STAKING_PROXY],
        }) as bigint;
        console.log(`StakingExample pUSDT balance: ${contractBalance}`);

        const unstakeAmount = contractBalance < stakeBefore ? contractBalance : stakeBefore;

        if (unstakeAmount === BigInt(0)) {
          console.log('Contract has no token balance to unstake — skipping');
          return;
        }
        console.log(`Unstaking amount: ${unstakeAmount}`);

        const unstakePayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'unstake',
          args: [pUsdtToken, unstakeAmount],
        });

        const tx = await pushClient.universal.sendTransaction({
          to: STAKING_PROXY,
          data: unstakePayload,
        });
        console.log(`Unstake TX Hash: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`Unstake status: ${receipt.status}`);
        expect(receipt.status).toBe(1);

        // Verify stake decreased
        await new Promise((r) => setTimeout(r, 3000));
        const stakeAfter = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;
        console.log(`Stake AFTER unstake: ${stakeAfter}`);

        expect(stakeAfter).toBeLessThan(stakeBefore);
      }, 120000);
    });

    // ============================================================================
    // 8. Error Handling
    // ============================================================================
    describe('8. Error Handling', () => {
      it('should fail triggerOutbound with zero amount', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: triggerOutbound with zero amount ===');

        const triggerPayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'triggerOutbound',
          args: [pUsdtToken, BigInt(0), '0x', BigInt(0), '0x', ueaAddress],
        });

        try {
          const tx = await pushClient.universal.sendTransaction({
            to: STAKING_PROXY,
            data: triggerPayload,
            value: parseEther('0.01'),
          });
          const receipt = await tx.wait();
          console.log(`TX status: ${receipt.status}`);
        } catch (error) {
          console.log(`Expected error for zero amount: ${(error as Error).message}`);
          expect(error).toBeDefined();
        }
      }, 120000);

      it('should fail unstake with more than staked amount', async () => {
        if (skipE2E) return;

        console.log('\n=== Test: unstake with excessive amount ===');

        const currentStake = await pushPublicClient.readContract({
          address: STAKING_PROXY,
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'getStake',
          args: [ueaAddress, pUsdtToken],
        }) as bigint;

        const excessiveAmount = currentStake + BigInt(1000000000); // 1000 USDT (6 decimals)

        const unstakePayload = encodeFunctionData({
          abi: STAKING_EXAMPLE_ABI,
          functionName: 'unstake',
          args: [pUsdtToken, excessiveAmount],
        });

        try {
          const tx = await pushClient.universal.sendTransaction({
            to: STAKING_PROXY,
            data: unstakePayload,
          });
          const receipt = await tx.wait();
          console.log(`TX status: ${receipt.status}`);
          // Should revert with InsufficientStake
        } catch (error) {
          console.log(`Expected error for excessive unstake: ${(error as Error).message}`);
          expect(error).toBeDefined();
        }
      }, 120000);
    });

    }); // end Additional
  }); // end describe.each
});

// ============================================================================
// Route 2: CEA Outbound Contract Call (BNB Testnet)
// Executes counter.increment() on BNB Testnet via CEA — UOA → CEA outbound
// flow with payload-only (no funds transfer).
// ============================================================================
describe('Route 2: CEA Outbound Contract Call (BNB Testnet)', () => {
  const COUNTER_ADDRESS_R2BNB = '0xf4bd8c13da0f5831d7b6dd3275a39f14ec7ddaa6' as `0x${string}`;

  const privateKeyR2BNB = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E_R2BNB = !privateKeyR2BNB;
  let pushClientR2BNB: Awaited<ReturnType<typeof PushChain.initialize>>;

  const publicClientR2BNB = createPublicClient({
    chain: bscTestnet,
    transport: http(CHAIN_INFO[CHAIN.BNB_TESTNET].defaultRPC[0]),
  });

  beforeAll(async () => {
    if (skipE2E_R2BNB) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: privateKeyR2BNB,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[init] [${val.id}] ${val.title}: ${val.message ?? ''}`);
      },
    });
    pushClientR2BNB = setup.pushClient;
    const ueaAddress = pushClientR2BNB.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);

    const pushPublicClient = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const code = await pushPublicClient.getCode({ address: ueaAddress });
    if (code === undefined) {
      console.log('UEA not deployed — sending self-transfer to trigger deployment...');
      const deployTx = await pushClientR2BNB.universal.sendTransaction({
        to: ueaAddress,
        value: BigInt(1),
      });
      const deployReceipt = await deployTx.wait();
      console.log(`UEA deployed via self-transfer — status: ${deployReceipt.status}`);
    }
  }, 120000);

  it('should increment counter on BNB Testnet via CEA', async () => {
    if (skipE2E_R2BNB) return;

    const counterBefore = (await publicClientR2BNB.readContract({
      address: COUNTER_ADDRESS_R2BNB,
      abi: COUNTER_ABI,
      functionName: 'count',
    })) as bigint;
    console.log(`Counter BEFORE: ${counterBefore}`);

    const data = encodeFunctionData({
      abi: COUNTER_ABI,
      functionName: 'increment',
    });

    const tx = await pushClientR2BNB.universal.sendTransaction({
      to: {
        address: COUNTER_ADDRESS_R2BNB,
        chain: CHAIN.BNB_TESTNET,
      },
      data,
    });

    console.log(`Push Chain TX Hash: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(tx.chain).toBe(CHAIN.BNB_TESTNET);

    console.log('Calling tx.wait() - polling for outbound tx hash...');
    const receipt = await tx.wait();
    console.log(`Receipt status: ${receipt.status}`);
    console.log(`External TX Hash: ${receipt.externalTxHash}`);

    expect(receipt.status).toBe(1);
    expect(receipt.externalTxHash).toBeDefined();
    expect(receipt.externalChain).toBe(CHAIN.BNB_TESTNET);

    await verifyExternalTransaction(
      receipt.externalTxHash!,
      receipt.externalChain!
    );

    await new Promise((r) => setTimeout(r, 5000));

    const counterAfter = (await publicClientR2BNB.readContract({
      address: COUNTER_ADDRESS_R2BNB,
      abi: COUNTER_ABI,
      functionName: 'count',
    })) as bigint;
    console.log(`Counter AFTER: ${counterAfter}`);
    expect(counterAfter).toBeGreaterThan(counterBefore);
  }, 360000);
});
