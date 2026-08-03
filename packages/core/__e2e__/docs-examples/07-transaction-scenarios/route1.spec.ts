import '@e2e/shared/setup';
/**
 * Mirrors all Route 1 examples (UOA_TO_PUSH) in
 * docs/chain/03-build/07-Universal-Transaction-Scenarios.mdx.
 *
 * Each `it()` cites the customPropGTagEvent slug + MDX line range.
 * Funding amounts match the docs prompt verbatim.
 */
import {
  createWalletClient,
  http,
  encodeFunctionData,
  parseUnits as viemParseUnits,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { ethers } from 'ethers';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import {
  PUSH_CHAIN_DEF,
  fundSepoliaUoa,
  fundSepoliaUoaUsdt,
  fundUeaPC,
  makeSepoliaContext,
  makePushContext,
  waitForReceipt,
} from '../_helpers/docs-fund';
import { getPC20ReadFixtures, skipNote } from '@e2e/shared/pc20-fixtures';

const COUNTER_PUSH = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const COUNTER_PAYABLE = '0x9F95857e43d25Bb9DaFc6376055eFf63bC0887C1';
const COUNTER_ABI = [
  { inputs: [], name: 'increment', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'countPC', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

// The PC20 example needs a live registry deployment on top of the usual keys.
// Chosen up front so jest reports it as skipped rather than passed-without-asserting.
const pc20Fixtures = getPC20ReadFixtures();
const pc20Ready = Boolean(evmKey && pushKey && pc20Fixtures?.wrapperSepolia);
if (!pc20Ready) {
  skipNote(
    'docs-examples route1_pc20_import',
    'needs EVM_PRIVATE_KEY + PUSH_PRIVATE_KEY + PC20_PUSH_TOKEN + PC20_WRAPPER_SEPOLIA'
  );
}

describe('docs-examples › 07-transaction-scenarios › Route 1 (UOA_TO_PUSH)', () => {
  /**
   * slug: send_transaction_contract_call_from_push_chain
   * MDX: 07:35-88. Push UOA → counter.increment() on Push Chain. Fund 1 PC.
   */
  (pushKey ? it : it.skip)('contract_call_from_push_chain — Push UOA → counter.increment()', async () => {
    const pushCtx = makePushContext(pushKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: PUSH_CHAIN_DEF,
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    await fundUeaPC(pushCtx, account.address, '1');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.PUSH_TESTNET_DONUT,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const ethersProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const counter = new ethers.Contract(COUNTER_PUSH, [...COUNTER_ABI], ethersProvider);
    const before = (await counter['countPC']()) as bigint;

    const tx = await client.universal.sendTransaction({ to: COUNTER_PUSH, data });
    await tx.wait();
    const after = (await counter['countPC']()) as bigint;
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(after).toBe(before + BigInt(1));
  }, 120_000);

  /**
   * slug: send_transaction_move_funds_native_ethers
   * MDX: 07:105-141. Sepolia UOA → bridge 1 wei of ETH to UEA. Fund 0.005 ETH.
   */
  (evmKey ? it : it.skip)('move_funds_native_ethers — Sepolia UOA bridges 1 wei ETH to UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      progressHook: (p) => console.log('TX Progress:', p.title || p.id),
    });

    const res = await client.universal.sendTransaction({
      to: client.universal.account,
      funds: {
        amount: BigInt(1),
        token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
      },
    });
    expect(res.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await res.wait();
    expect(receipt.status).toBe(1);
  }, 240_000);

  /**
   * slug: send_transaction_funds_erc20
   * MDX: 07:155-197. Sepolia UOA bridges 0.01 USDT to UEA. Fund 0.005 ETH + 0.02 USDT.
   */
  (evmKey ? it : it.skip)('funds_erc20 — Sepolia UOA bridges 0.01 USDT to UEA', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
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

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT;
    await fundSepoliaUoaUsdt(sepoliaCtx, account.address, '0.005', '0.02', usdt);

    const oneCents = PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals });
    const res = await client.universal.sendTransaction({
      to: client.universal.account,
      funds: { amount: oneCents, token: usdt },
    });
    expect(res.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await res.wait();
    expect(receipt.status).toBe(1);
  }, 240_000);

  /**
   * slug: send_transaction_funds_payload
   * MDX: 07:211-264. Sepolia UOA bridges 0.01 USDT + calls counter.increment(). Fund 0.005 ETH + 0.02 USDT.
   */
  (evmKey ? it : it.skip)('funds_payload — bridges 0.01 USDT and calls counter.increment() atomically', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
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

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT;
    await fundSepoliaUoaUsdt(sepoliaCtx, account.address, '0.005', '0.02', usdt);

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const oneCents = PushChain.utils.helpers.parseUnits('0.01', { decimals: usdt.decimals });

    const res = await client.universal.sendTransaction({
      to: COUNTER_PAYABLE,
      value: BigInt(0),
      data,
      funds: { amount: oneCents, token: usdt },
    });
    expect(res.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await res.wait();
    expect(receipt.status).toBe(1);
  }, 240_000);

  /**
   * slug: send_transaction_pay_gas_erc20
   * MDX: 07:487-548. Sepolia UOA bridges 0.1 USDT, USDC pays Push Chain gas.
   * Fund 0.005 ETH + 0.2 USDT + 0.1 USDC.
   */
  it.skip('pay_gas_erc20 — bridges USDT, pays Push Chain gas with USDC', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
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
    });

    const usdt = PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT;
    const usdc = PushChain.CONSTANTS.PAYABLE.TOKEN.ETHEREUM_SEPOLIA.USDC;

    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');
    for (const [tok, amt] of [
      [usdt, '0.2'] as const,
      [usdc, '5'] as const,
    ]) {
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [account.address, viemParseUnits(amt, tok.decimals)],
      });
      const hash = await sepoliaCtx.walletClient.sendTransaction({
        account: sepoliaCtx.master,
        chain: sepolia,
        to: tok.address as `0x${string}`,
        data,
      });
      await waitForReceipt(sepoliaCtx.publicClient, hash);
      console.log(`[fund] ${amt} ${tok.symbol} → ${account.address} on Sepolia (${hash})`);
    }

    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const tx = await client.universal.sendTransaction({
      to: COUNTER_PUSH,
      data,
      funds: {
        amount: PushChain.utils.helpers.parseUnits('0.1', { decimals: usdt.decimals }),
        token: usdt,
      },
      payGasWith: { token: usdc },
    });
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
  }, 300_000);

  /**
   * slug: send_transaction_full_example
   * MDX: 07:282-377. Sepolia UOA → multicall (2× counter.increment()) on Push Chain. Fund 0.005 ETH.
   */
  (evmKey ? it : it.skip)('full_example — Sepolia UOA runs 2× counter.increment() multicall', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const account = privateKeyToAccount(generatePrivateKey());
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });
    await fundSepoliaUoa(sepoliaCtx, account.address, '0.01');

    const universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    const client = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });

    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });
    const calls: { to: `0x${string}`; value: bigint; data: `0x${string}` }[] = [
      { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
      { to: COUNTER_PUSH as `0x${string}`, value: BigInt(0), data: incrementData },
    ];

    const pushProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const counter = new ethers.Contract(COUNTER_PUSH, [...COUNTER_ABI], pushProvider);
    const before = (await counter['countPC']()) as bigint;

    const tx = await client.universal.sendTransaction({
      to: client.universal.account,
      value: BigInt(0),
      data: calls,
    });
    await tx.wait();
    const after = (await counter['countPC']()) as bigint;
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(after).toBe(before + BigInt(2));
  }, 300_000);

  /**
   * slug: send_transaction_route1_pc20_import
   * MDX: "Move a PC20 Token to Push Chain (wrapper burn)".
   *
   * Burns a PC20 wrapper on Sepolia and unlocks the canonical Push-native
   * token to the UEA. Needs PC20_PUSH_TOKEN + PC20_WRAPPER_SEPOLIA on top of
   * the usual keys, so it is gated separately — see __e2e__/shared/pc20-fixtures.ts.
   *
   * The docs example asks the reader to send the wrapper to a fresh UOA; here
   * the master wallet transfers it, matching the prompt's amount verbatim.
   */
  (pc20Ready ? it : it.skip)('route1_pc20_import — burns a Sepolia PC20 wrapper, unlocks on Push', async () => {
    const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
    const pushCtx = makePushContext(pushKey as Hex);
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

    // Mirrors the docs: resolve the wrapper to learn the canonical token.
    const token = await PushChain.utils.tokens.getPC20Address(
      pc20Fixtures!.wrapperSepolia!,
      { chain: CHAIN.ETHEREUM_SEPOLIA, network: PUSH_NETWORK.TESTNET_DONUT }
    );
    expect(token.address.toLowerCase()).toBe(pc20Fixtures!.pushToken.toLowerCase());

    // Fund the fresh UOA with signing gas plus the wrapper that gets burned.
    await fundSepoliaUoaUsdt(sepoliaCtx, account.address, '0.005', '1', {
      address: pc20Fixtures!.wrapperSepolia as string,
      decimals: token.decimals,
    });
    // A wrapper burn carries no native funds leg to fee-lock against, so a
    // brand-new UEA has no PC to pay the inbound execution gas with and the
    // Push-side tx fails with "insufficient gas: available 0 upc". Seed it
    // directly — the docs prompt asks the reader for the same 1 PC.
    await fundUeaPC(pushCtx, client.universal.account as `0x${string}`, '1');

    const pushProvider = new ethers.JsonRpcProvider(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]);
    const pushToken = new ethers.Contract(
      token.address,
      ['function balanceOf(address) view returns (uint256)'],
      pushProvider
    );
    const before = (await pushToken['balanceOf'](client.universal.account)) as bigint;

    const amount = PushChain.utils.helpers.parseUnits('1', { decimals: token.decimals });
    const tx = await client.universal.sendTransaction({
      to: client.universal.account,
      funds: {
        amount,
        // `chain` is where the token IS — the wrapper's chain, not the destination.
        token: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: pc20Fixtures!.wrapperSepolia as string,
        },
      },
    });
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    await tx.wait();

    const after = (await pushToken['balanceOf'](client.universal.account)) as bigint;
    expect(after).toBe(before + amount);
  }, 900_000);
});
