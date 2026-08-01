/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * R3 (CEA → Push) PC20 on EVM, self-seeding:
 *   seed: export wrapper to the wallet if it holds none, move it into the CEA
 *   test: R3 burns from the CEA → the Push-native token unlocks to the UEA
 *
 * The R3 CEA burn dodges the known fee-credit chain bug (the self-call attaches
 * no native value, so no second inbound is created) — `wait()` is expected to
 * resolve cleanly here, unlike the R1 return leg.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  getAddress,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { ERC20_EVM } from '../../../src/lib/constants/abi';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { getPC20Fixtures, announcePC20Skip } from '@e2e/shared/pc20-fixtures';

const fixtures = getPC20Fixtures();
const d = fixtures?.wrapperSepolia ? describe : describe.skip;
announcePC20Skip('PC20 R3 EVM');
if (fixtures && !fixtures.wrapperSepolia)
  console.log('[SKIP] PC20 R3 EVM — PC20_WRAPPER_SEPOLIA not set');

const AMOUNT = parseEther('0.001');
const VAULT_PC20 = '0x00000000000000000000000000000000000000B1' as const;

jest.setTimeout(900_000);

d('PC20 R3 — CEA burn on EVM', () => {
  let client: Awaited<ReturnType<typeof PushChain.initialize>>;
  let sepolia: ReturnType<typeof createPublicClient>;
  let donut: ReturnType<typeof createPublicClient>;
  let sepoliaWallet: ReturnType<typeof createWalletClient>;
  let evmAccount: ReturnType<typeof privateKeyToAccount>;
  let walletAddress: `0x${string}`;
  let ueaAddress: `0x${string}`;
  let cea: `0x${string}`;

  const bal = (client_: typeof sepolia, token: `0x${string}`, who: `0x${string}`) =>
    client_.readContract({
      address: token,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [who],
    }) as Promise<bigint>;

  beforeAll(async () => {
    const account = privateKeyToAccount(process.env['EVM_PRIVATE_KEY'] as `0x${string}`);
    evmAccount = account;
    walletAddress = account.address;
    sepolia = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });
    donut = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    sepoliaWallet = createWalletClient({
      account,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

    const signer = await PushChain.utils.signer.toUniversalFromKeypair(sepoliaWallet, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    client = await PushChain.initialize(signer, { network: PUSH_NETWORK.TESTNET_DONUT });

    const uea = (await PushChain.utils.account.convertOriginToExecutor({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: account.address,
    })) as { address: `0x${string}` } | `0x${string}`;
    ueaAddress = typeof uea === 'string' ? uea : uea.address;
    cea = getAddress(
      (await getCEAAddress(ueaAddress, CHAIN.ETHEREUM_SEPOLIA)).cea
    ) as `0x${string}`;
  });

  it('burns wrapper from the CEA and unlocks to the UEA', async () => {
    const wrapper = fixtures!.wrapperSepolia!;

    // --- Seed: wallet needs wrapper; export if short (R2, delivered via CEA
    // multicall on EVM), then move it into the CEA.
    if ((await bal(sepolia, wrapper, walletAddress)) < AMOUNT) {
      const exp = await client.universal.sendTransaction({
        to: { chain: CHAIN.ETHEREUM_SEPOLIA, address: walletAddress },
        funds: {
          amount: AMOUNT,
          token: {
            chain: CHAIN.PUSH_TESTNET_DONUT,
            address: fixtures!.pushToken,
          },
        },
      });
      await exp.wait();
    }
    expect(await bal(sepolia, wrapper, walletAddress)).toBeGreaterThanOrEqual(AMOUNT);

    if ((await bal(sepolia, wrapper, cea)) < AMOUNT) {
      const hash = await sepoliaWallet.sendTransaction({
        account: evmAccount,
        to: wrapper,
        data: encodeFunctionData({
          abi: ERC20_EVM,
          functionName: 'transfer',
          args: [cea, AMOUNT],
        }),
        chain: null,
      });
      await sepolia.waitForTransactionReceipt({ hash });
    }
    const ceaBefore = await bal(sepolia, wrapper, cea);
    expect(ceaBefore).toBeGreaterThanOrEqual(AMOUNT);

    // --- R3 burn.
    const before = {
      vault: await bal(donut, fixtures!.pushToken, VAULT_PC20),
      uea: await bal(donut, fixtures!.pushToken, ueaAddress),
    };

    const r3 = await client.universal.sendTransaction({
      from: { chain: CHAIN.ETHEREUM_SEPOLIA },
      to: ueaAddress,
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: wrapper,
        },
      },
    });
    // No fee-credit tolerance here on purpose: the CEA burn produces a single
    // inbound, so a throw from wait() is a REAL regression.
    await r3.wait();

    const after = {
      vault: await bal(donut, fixtures!.pushToken, VAULT_PC20),
      uea: await bal(donut, fixtures!.pushToken, ueaAddress),
      cea: await bal(sepolia, wrapper, cea),
    };
    expect(ceaBefore - after.cea).toBe(AMOUNT);
    expect(before.vault - after.vault).toBe(AMOUNT);
    expect(after.uea - before.uea).toBe(AMOUNT);
  });
});
