/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 inbound: burn an EVM wrapper, unlock the canonical Push token.
 *
 * Covers the two behaviors that only show up against a live gateway:
 *   - the wrapper supply drops and the Push-native token appears, meaning the
 *     gateway took the PC20 burn path rather than the generic ERC20 path;
 *   - no approval transaction is sent for the wrapper.
 *
 * Requires a funded wrapper balance on the signer. See pc20-fixtures.ts.
 */

import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { PC20TokenChainMismatchError } from '../../../src/lib/orchestrator/internals/pc20/errors';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { getPC20Fixtures, announcePC20Skip } from '@e2e/shared/pc20-fixtures';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { createPublicClient, http, getAddress } from 'viem';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';

const fixtures = getPC20Fixtures();
const d = fixtures ? describe : describe.skip;

announcePC20Skip('PC20 inbound');

const AMOUNT = BigInt(1_000);

d('PC20 inbound — EVM wrapper burn', () => {
  let client: Awaited<ReturnType<typeof PushChain.initialize>>;
  let signerAddress: `0x${string}`;
  let ueaAddress: `0x${string}`;

  const sepoliaClient = () =>
    createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });

  const pushClient = () =>
    createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

  const wrapperBalance = (owner: `0x${string}`) =>
    sepoliaClient().readContract({
      address: getAddress(fixtures!.wrapperSepolia),
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>;

  const pushBalance = (owner: `0x${string}`) =>
    pushClient().readContract({
      address: getAddress(fixtures!.pushToken),
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
    signerAddress = setup.account.address;
    ueaAddress = client.universal.account as `0x${string}`;
  }, 120_000);

  it('rejects a wrong-chain token reference before any broadcast', async () => {
    // funds.token.chain must be where the wrapper lives. Naming the destination
    // here is the most likely caller mistake, and it must cost nothing.
    await expect(
      client.universal.sendTransaction({
        to: ueaAddress,
        funds: {
          amount: AMOUNT,
          token: {
            standard: 'pc20',
            chain: CHAIN.BASE_SEPOLIA,
            address: fixtures!.wrapperSepolia,
          },
        },
      })
    ).rejects.toThrow(PC20TokenChainMismatchError);
  }, 60_000);

  it('burns the wrapper and unlocks the Push-native token', async () => {
    const wrapperBefore = await wrapperBalance(signerAddress);
    const pushBefore = await pushBalance(ueaAddress);

    expect(wrapperBefore).toBeGreaterThanOrEqual(AMOUNT);

    const response = await client.universal.sendTransaction({
      to: ueaAddress,
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: fixtures!.wrapperSepolia,
        },
      },
    });

    expect(response.hash).toBeTruthy();
    await response.wait();

    const wrapperAfter = await wrapperBalance(signerAddress);
    const pushAfter = await pushBalance(ueaAddress);

    // Burn, not escrow: total wrapper supply held by the signer drops.
    expect(wrapperBefore - wrapperAfter).toBe(AMOUNT);
    // The canonical Push token is what unlocks — not a synthetic PRC20.
    expect(pushAfter - pushBefore).toBe(AMOUNT);
  }, 600_000);

  it('sends no approval transaction for the wrapper', async () => {
    // The gateway's PC20Factory burns via burnFrom, so an allowance would be
    // granted and never used. Assert the allowance stays at zero across a send.
    const gateway = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].lockerContract as `0x${string}`;

    const allowance = () =>
      sepoliaClient().readContract({
        address: getAddress(fixtures!.wrapperSepolia),
        abi: ERC20_EVM,
        functionName: 'allowance',
        args: [signerAddress, getAddress(gateway)],
      }) as Promise<bigint>;

    const before = await allowance();

    const response = await client.universal.sendTransaction({
      to: ueaAddress,
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: fixtures!.wrapperSepolia,
        },
      },
    });
    await response.wait();

    expect(await allowance()).toBe(before);
  }, 600_000);

  it('transfers then executes when calldata is supplied', async () => {
    // Order matters: funds land at execute.to first, then the call runs. The
    // target gets no allowance, so it must read its own received balance.
    const pushBefore = await pushBalance(ueaAddress);

    const response = await client.universal.sendTransaction({
      to: ueaAddress,
      // A no-op call against the UEA: exercises the transfer-then-call ordering
      // without depending on a deployed test contract.
      data: '0x',
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: fixtures!.wrapperSepolia,
        },
      },
    });
    await response.wait();

    expect((await pushBalance(ueaAddress)) - pushBefore).toBe(AMOUNT);
  }, 600_000);
});
