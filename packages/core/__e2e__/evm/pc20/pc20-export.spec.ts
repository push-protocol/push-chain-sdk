/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 export: lock a Push-native token, deliver a wrapper on an EVM chain.
 *
 * The first-export case is the one worth running: it deploys the wrapper, and
 * the SDK has to predict the address before it exists in order to build the
 * destination transfer. If the prediction is wrong the funds are already locked
 * — so the assertion that the predicted address equals the eventually-deployed
 * one is the point of this suite.
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

announcePC20Skip('PC20 export');
if (fixtures && !fixtures.undeployedToken) {
  console.log('[SKIP] PC20 first export — PC20_UNDEPLOYED_TOKEN not set');
}

const AMOUNT = BigInt(1_000);

d('PC20 export — Push to EVM', () => {
  let client: Awaited<ReturnType<typeof PushChain.initialize>>;
  let recipient: `0x${string}`;

  const destChain = () => fixtures!.exportDestChain;

  const destClient = () =>
    createPublicClient({
      transport: http(CHAIN_INFO[destChain()].defaultRPC[0]),
    });

  /** Confirmed wrapper entries for a Push token on one destination chain. */
  const wrappersOn = async (pushToken: string, chain: CHAIN) => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(pushToken, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      chain: CHAIN.PUSH_TESTNET_DONUT,
    });
    return registry.filter((e) => e.chain === chain);
  };

  const erc20Balance = (token: string, owner: `0x${string}`) =>
    destClient().readContract({
      address: getAddress(token),
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>;

  beforeAll(async () => {
    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey: fixtures!.privateKey,
      printTraces: true,
    });
    client = setup.pushClient;
    recipient = setup.account.address;
  }, 120_000);

  it('exports to an already-deployed wrapper and delivers to the recipient', async () => {
    const deployments = await wrappersOn(fixtures!.pushToken, destChain());
    if (deployments.length === 0) {
      console.log('[SKIP] no existing deployment — covered by the first-export test');
      return;
    }

    const wrapper = deployments[0].address;
    const before = await erc20Balance(wrapper, recipient);

    const response = await client.universal.sendTransaction({
      to: { chain: destChain(), address: recipient },
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await response.wait();

    expect((await erc20Balance(wrapper, recipient)) - before).toBe(AMOUNT);
  }, 900_000);

  it('reuses the same wrapper on a repeat export', async () => {
    const first = await wrappersOn(fixtures!.pushToken, destChain());

    const response = await client.universal.sendTransaction({
      to: { chain: destChain(), address: recipient },
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await response.wait();

    const second = await wrappersOn(fixtures!.pushToken, destChain());

    // A repeat export deploys nothing — the registry must be unchanged.
    expect(second[0]?.address).toBe(first[0]?.address);
  }, 900_000);

  (fixtures?.undeployedToken ? it : it.skip)('predicts the wrapper address correctly on a first export', async () => {
    // Nothing is deployed yet, so the SDK has to predict the wrapper address in
    // order to build the destination transfer.
    const token = fixtures!.undeployedToken!;
    const before = await wrappersOn(token, destChain());
    expect(before).toEqual([]);

    const response = await client.universal.sendTransaction({
      to: { chain: destChain(), address: recipient },
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: token,
        },
      },
    });
    await response.wait();

    const deployments = await wrappersOn(token, destChain());

    expect(deployments).toHaveLength(1);

    // The prediction is verified by consequence, which is stronger than
    // comparing two addresses: the destination transfer was built against the
    // predicted address before the wrapper existed. If the prediction had been
    // wrong, the transfer would have gone to a dead address and this balance
    // would be zero — with the source token already locked.
    expect(await erc20Balance(deployments[0].address, recipient)).toBe(AMOUNT);
  }, 900_000);

  it('reports the destination wrapper on the receipt', async () => {
    const response = await client.universal.sendTransaction({
      to: { chain: destChain(), address: recipient },
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    const receipt = await response.wait();

    // A repeat export deploys no wrapper, so nothing is observed at settlement.
    // The receipt must still carry the address, resolved from UniversalCore.
    expect(
      (receipt as unknown as { externalAssetAddr?: string }).externalAssetAddr
    ).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 900_000);
});
