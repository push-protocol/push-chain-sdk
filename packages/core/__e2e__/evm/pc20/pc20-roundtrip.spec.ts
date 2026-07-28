/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 round trip: Push → EVM → Push.
 *
 * The conservation check. Export locks N and mints N; burning N unlocks N. If
 * the lock and the wrapper supply ever disagree, the bridge is minting value —
 * which is the failure this suite exists to catch, and which no unit test can.
 */

import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { getPC20Fixtures, announcePC20Skip } from '@e2e/shared/pc20-fixtures';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { createPublicClient, http, getAddress } from 'viem';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';

const fixtures = getPC20Fixtures();
const d = fixtures ? describe : describe.skip;

announcePC20Skip('PC20 round trip');

const AMOUNT = BigInt(1_000);

d('PC20 round trip — Push to EVM and back', () => {
  let client: Awaited<ReturnType<typeof PushChain.initialize>>;
  let signerAddress: `0x${string}`;
  let ueaAddress: `0x${string}`;

  const destChain = () => fixtures!.exportDestChain;

  const read = (chain: CHAIN) =>
    createPublicClient({ transport: http(CHAIN_INFO[chain].defaultRPC[0]) });

  const balanceOf = (chain: CHAIN, token: string, owner: `0x${string}`) =>
    read(chain).readContract({
      address: getAddress(token),
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>;

  const totalSupply = (chain: CHAIN, token: string) =>
    read(chain).readContract({
      address: getAddress(token),
      abi: ERC20_EVM,
      functionName: 'totalSupply',
      args: [],
    }) as Promise<bigint>;

  beforeAll(async () => {
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: fixtures!.privateKey,
      printTraces: true,
    });
    client = setup.pushClient;
    signerAddress = setup.account.address;
    ueaAddress = client.universal.account as `0x${string}`;
  }, 120_000);

  it('conserves value across a full export and return', async () => {
    const pushBefore = await balanceOf(
      CHAIN.PUSH_TESTNET_DONUT,
      fixtures!.pushToken,
      ueaAddress
    );

    // --- Leg 1: export ----------------------------------------------------
    const exportTx = await client.universal.sendTransaction({
      to: { chain: destChain(), address: signerAddress },
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await exportTx.wait();

    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { network: PUSH_NETWORK.TESTNET_DONUT, chain: CHAIN.PUSH_TESTNET_DONUT }
    );
    const deployments = registry.filter((e) => e.chain === destChain());
    expect(deployments).toHaveLength(1);
    const wrapper = deployments[0].address;

    const pushAfterExport = await balanceOf(
      CHAIN.PUSH_TESTNET_DONUT,
      fixtures!.pushToken,
      ueaAddress
    );
    const wrapperAfterExport = await balanceOf(destChain(), wrapper, signerAddress);
    const supplyAfterExport = await totalSupply(destChain(), wrapper);

    // Locked exactly what was minted.
    expect(pushBefore - pushAfterExport).toBe(AMOUNT);
    expect(wrapperAfterExport).toBeGreaterThanOrEqual(AMOUNT);

    // --- Leg 2: return ----------------------------------------------------
    const returnTx = await client.universal.sendTransaction({
      to: ueaAddress,
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: destChain(),
          address: wrapper,
        },
      },
    });
    await returnTx.wait();

    const pushFinal = await balanceOf(
      CHAIN.PUSH_TESTNET_DONUT,
      fixtures!.pushToken,
      ueaAddress
    );
    const wrapperFinal = await balanceOf(destChain(), wrapper, signerAddress);
    const supplyFinal = await totalSupply(destChain(), wrapper);

    // Burned exactly what was unlocked.
    expect(wrapperAfterExport - wrapperFinal).toBe(AMOUNT);
    expect(pushFinal - pushAfterExport).toBe(AMOUNT);
    expect(supplyAfterExport - supplyFinal).toBe(AMOUNT);

    // Net zero: the round trip neither created nor destroyed value.
    expect(pushFinal).toBe(pushBefore);
  }, 1_800_000);
});
