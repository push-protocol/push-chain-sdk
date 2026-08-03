import '@e2e/shared/setup';
/**
 * Mirrors all Route 3 examples (CEA_TO_PUSH) in
 * docs/chain/03-build/07-Universal-Transaction-Scenarios.mdx.
 *
 * Each `it()` cites the customPropGTagEvent slug + MDX line range.
 * `EVM_PRIVATE_KEY` is reused for both the Sepolia UOA (signer gas) and the BNB CEA
 * funding — same address holds both balances since BSC Testnet is EVM.
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PublicKey } from '@solana/web3.js';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { ethers } from 'ethers';
import {
  fundSepoliaUoa,
  fundSepoliaUoaUsdt,
  fundUeaPC,
  fundBnbCea,
  fundBnbCeaUsdt,
  deriveBnbCea,
  makeSepoliaContext,
  makePushContext,
  makeBnbContext,
  makeSolanaContext,
  fundSolanaUoa,
} from '../_helpers/docs-fund';
import { getPC20ReadFixtures, skipNote } from '@e2e/shared/pc20-fixtures';

const COUNTER_PUSH = '0x70d8f7a0fF8e493fb9cbEE19Eb780E40Aa872aaf';
const COUNTER_ABI = [
  { type: 'function', name: 'increment', inputs: [], outputs: [], stateMutability: 'payable' },
] as const;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
const solanaKey = process.env['SOLANA_PRIVATE_KEY'];
const ROUTE3_UEA_PC_GAS_BUFFER = '250';
const ROUTE3_BNB_CEA_TARGET = '0.001';
const ROUTE3_LIVE_TIMEOUT_MS = 900_000;

// The PC20 CEA burn needs a deployed wrapper on Sepolia — it does not exist
// until a first export has created one.
const pc20Fixtures = getPC20ReadFixtures();
const pc20Ready = Boolean(evmKey && pushKey && pc20Fixtures?.wrapperSepolia);
if (!pc20Ready) {
  skipNote(
    'docs-examples route3_pc20_cea_burn',
    'needs EVM_PRIVATE_KEY + PUSH_PRIVATE_KEY + PC20_PUSH_TOKEN + PC20_WRAPPER_SEPOLIA'
  );
}

describe('docs-examples › 07-transaction-scenarios › Route 3 (CEA_TO_PUSH)', () => {
  /**
   * slug: send_transaction_route3_payload
   * MDX: 07:915-979. BNB CEA → counter.increment() on Push Chain.
   * Fund 0.005 ETH (UOA) + 0.02 BNB (CEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('route3_payload — BNB CEA → counter.increment() on Push Chain', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    console.log('CEA on BNB Testnet:', ceaAddress);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    await fundBnbCea(bnbCtx, ceaAddress, ROUTE3_BNB_CEA_TARGET);

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: COUNTER_PUSH,
      data,
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, ROUTE3_LIVE_TIMEOUT_MS);

  /**
   * slug: send_transaction_route3_native
   * MDX: 07:993-1048. BNB CEA bridges 0.00005 BNB → Push Chain UEA.
   * Fund 0.005 ETH (UOA) + 0.02 BNB (CEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('route3_native — bridges 0.00005 BNB from BNB CEA → Push Chain UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    await fundBnbCea(bnbCtx, ceaAddress, ROUTE3_BNB_CEA_TARGET);

    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: client.universal.account,
      value: PushChain.utils.helpers.parseUnits('0.00005', 18),
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, ROUTE3_LIVE_TIMEOUT_MS);

  /**
   * slug: send_transaction_route3_funds
   * MDX: 07:1062-1117. BNB CEA bridges 0.01 USDT → Push Chain UEA.
   * Fund 0.005 ETH (UOA) + 0.02 BNB + 0.02 USDT (CEA).
   */
  ((evmKey && pushKey) ? it : it.skip)('route3_funds — bridges 0.01 USDT from BNB CEA → Push Chain UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    await fundBnbCeaUsdt(bnbCtx, ceaAddress, ROUTE3_BNB_CEA_TARGET, '0.02', usdt);

    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: client.universal.account,
      funds: { amount: BigInt(10000), token: usdt },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, ROUTE3_LIVE_TIMEOUT_MS);

  /**
   * slug: send_transaction_route3_funds_with_payload
   * MDX: 07:1131-1195. BNB CEA bridges 0.01 USDT and calls counter.increment() on Push Chain.
   */
  ((evmKey && pushKey) ? it : it.skip)('route3_funds_with_payload — bridges 0.01 USDT + calls counter.increment()', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.BNB_TESTNET.USDT;
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    await fundBnbCeaUsdt(bnbCtx, ceaAddress, ROUTE3_BNB_CEA_TARGET, '0.02', usdt);

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: COUNTER_PUSH,
      data,
      funds: { amount: BigInt(10000), token: usdt },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, ROUTE3_LIVE_TIMEOUT_MS);

  /**
   * slug: send_transaction_route3_solana
   * Solana CEA → counter.increment() on Push Chain. Mirrors the BNB-CEA route3_payload pattern
   * but originates from a Solana Devnet CEA. Fund 0.005 ETH (UOA) + 0.02 SOL (CEA).
   *
   * Currently skipped: the fresh-UEA fee-lock on the Push Chain side needs PC
   * bought via the same pSOL/WPC pool swap that blocks route2_solana; the
   * underpriced swap leaves the UEA with `InsufficientBalance` (0xf4d678b8).
   * Re-enable once the contracts team recalibrates the pSOL/WPC pool. See
   * __e2e__/docs-examples/KNOWN_FAILURES.md.
   */
  it.skip('route3_solana — Solana CEA → counter.increment() on Push Chain', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const solanaCtx = makeSolanaContext(solanaKey as string);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const uoa = PushChain.utils.account.toUniversal(account.address, {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
    });
    const solanaCEA = await PushChain.utils.account.deriveExecutorAccount(uoa, {
      chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
      skipNetworkCheck: true,
    });
    // deriveExecutorAccount returns the SVM CEA as 0x-prefixed 32-byte hex.
    // Convert to base58 for Solana RPCs / explorers / funding helpers.
    const solanaCeaBase58 = new PublicKey(
      Buffer.from(solanaCEA.address.slice(2), 'hex')
    ).toBase58();
    console.log('Solana CEA:', solanaCeaBase58);

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundSolanaUoa(solanaCtx, solanaCeaBase58, '0.02');

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET },
      to: COUNTER_PUSH,
      data,
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, 600_000);

  /**
   * slug: send_transaction_route3_multicall
   * MDX: 07:1209-1271. BNB CEA → 2× counter.increment() on Push Chain. Fund 0.005 ETH + 0.02 BNB.
   */
  ((evmKey && pushKey) ? it : it.skip)('route3_multicall — 2× counter.increment() on Push Chain via Route 3 multicall', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const bnbCtx = makeBnbContext(evmKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const ceaAddress = await deriveBnbCea(bnbCtx, client.universal.account as `0x${string}`);
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    await fundBnbCea(bnbCtx, ceaAddress, ROUTE3_BNB_CEA_TARGET);

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.BNB_TESTNET },
      to: '0x0000000000000000000000000000000000000000',
      data: [
        { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
        { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
      ],
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);
  }, ROUTE3_LIVE_TIMEOUT_MS);

  /**
   * slug: send_transaction_route3_pc20_cea_burn
   * MDX: "Bring a PC20 Back from your CEA".
   *
   * The CEA on Sepolia burns its PC20 wrapper balance and the canonical
   * Push-native token is unlocked to the UEA.
   *
   * Uses the master key directly (not a fresh wallet) for the same reason the
   * other Route 3 tests do: the CEA is derived from the UEA, so a fresh wallet
   * would mean funding a brand-new CEA on every run.
   */
  (pc20Ready ? it : it.skip)('route3_pc20_cea_burn — burns a Sepolia CEA wrapper, unlocks on Push', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(evmKey as Hex);
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    // Mirrors the docs: derive the Sepolia CEA via the SDK, not a raw factory read.
    const uoa = PushChain.utils.account.toUniversal(account.address, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
    });
    const sepoliaCea = await PushChain.utils.account.deriveExecutorAccount(uoa, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      skipNetworkCheck: true,
    });

    const token = await PushChain.utils.tokens.getPC20Address(
      pc20Fixtures!.wrapperSepolia!,
      { chain: CHAIN.ETHEREUM_SEPOLIA, network: PUSH_NETWORK.TESTNET_DONUT }
    );
    expect(token.address.toLowerCase()).toBe(pc20Fixtures!.pushToken.toLowerCase());

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, ROUTE3_UEA_PC_GAS_BUFFER);
    // The CEA needs signing gas plus the wrapper it is going to burn.
    await fundSepoliaUoaUsdt(sepoliaCtx, sepoliaCea.address as `0x${string}`, '0.005', '1', {
      address: pc20Fixtures!.wrapperSepolia as string,
      decimals: token.decimals,
    });

    const pushProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const pushToken = new ethers.Contract(
      token.address,
      ['function balanceOf(address) view returns (uint256)'],
      pushProvider
    );
    const before = (await pushToken['balanceOf'](client.universal.account)) as bigint;

    const amount = PushChain.utils.helpers.parseUnits('1', { decimals: token.decimals });
    const tx = await client.universal.sendTransaction({
      from: { chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA }, // burn from the CEA
      to: client.universal.account, // unlock back to self
      funds: {
        amount,
        token: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: pc20Fixtures!.wrapperSepolia as string,
        },
      },
    });
    const receipt = await tx.wait();
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(receipt.status).toBe(1);

    const after = (await pushToken['balanceOf'](client.universal.account)) as bigint;
    expect(after).toBe(before + amount);
  }, ROUTE3_LIVE_TIMEOUT_MS);
});
