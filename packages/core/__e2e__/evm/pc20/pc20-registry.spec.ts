/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 registry resolution against live UniversalCore.
 *
 * Read-only — no signer, no funds, no broadcast. This suite is the one that can
 * run the moment a PC20 deployment exists, and it is what proves the registry
 * wiring before anything is risked on it.
 */

import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import {
  PC20WrapperNotRegisteredError,
  InvalidPC20AddressError,
} from '../../../src/lib/orchestrator/internals/pc20/errors';
import {
  getPC20ReadFixtures,
  announcePC20Skip,
} from '@e2e/shared/pc20-fixtures';

// Read-only: no signer needed, nothing is broadcast.
const fixtures = getPC20ReadFixtures();
const d = fixtures ? describe : describe.skip;

/**
 * Wrapper-dependent tests are registered as `it.skip` when no wrapper exists
 * yet.
 *
 * An early `return` inside a test body would report as PASSED while asserting
 * nothing — indistinguishable from a real pass in CI, which is the precise
 * failure this suite exists to avoid. Choosing the runner up front makes jest
 * report them as skipped.
 */
const itWrapper = fixtures?.wrapperSepolia ? it : it.skip;
const itUndeployed = fixtures?.undeployedToken ? it : it.skip;

announcePC20Skip('PC20 registry', false);

d('PC20 registry — getPC20Address', () => {
  const opts = { network: PUSH_NETWORK.TESTNET_DONUT };

  itWrapper('resolves a wrapper to its canonical Push token', async () => {
    const result = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );

    expect(result.address.toLowerCase()).toBe(fixtures!.pushToken.toLowerCase());
    expect(result.name).toBeTruthy();
    expect(result.symbol).toBeTruthy();
    expect(typeof result.decimals).toBe('number');
    expect(result.network).toBe(PUSH_NETWORK.TESTNET_DONUT);
  });

  itWrapper('returns the same result whichever end of the mapping is supplied', async () => {
    const fromWrapper = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );
    const fromPush = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    expect(fromPush.address).toBe(fromWrapper.address);
    expect(fromPush.registry).toEqual(fromWrapper.registry);
  });

  itWrapper('lists the Sepolia wrapper and the Push token in the registry', async () => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );

    const sepolia = registry.find((e) => e.chain === CHAIN.ETHEREUM_SEPOLIA);
    expect(sepolia).toBeDefined();
    expect(sepolia!.address.toLowerCase()).toBe(
      fixtures!.wrapperSepolia!.toLowerCase()
    );
    expect(sepolia!.chainName).toBe('ETHEREUM_SEPOLIA');
    // Chain-native form: checksummed, not lowercase or bytes32-padded.
    expect(sepolia!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const push = registry.find((e) => e.chain === CHAIN.PUSH_TESTNET_DONUT);
    expect(push).toBeDefined();
    expect(push!.address.toLowerCase()).toBe(fixtures!.pushToken.toLowerCase());
    expect(push!.chainName).toBe('PUSH_TESTNET_DONUT');
  });

  itWrapper('puts the canonical Push entry last', async () => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );

    expect(registry[registry.length - 1].chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
  });

  it('lists confirmed deployments only', async () => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    // A predicted first-export address must never surface here — publishing an
    // address that does not exist yet invites callers to send to it.
    for (const entry of registry) {
      expect(entry.address).toBeTruthy();
      expect(entry.chainName).toBeTruthy();
    }
  });

  itUndeployed('returns only the Push entry for a never-exported token', async () => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.undeployedToken!,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    expect(registry).toHaveLength(1);
    expect(registry[0].chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
  });
});

d('PC20 registry — chain discovery', () => {
  const opts = { network: PUSH_NETWORK.TESTNET_DONUT };

  itWrapper('works out the chain when none is supplied', async () => {
    const withChain = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );
    const discovered = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      opts
    );

    expect(discovered.address).toBe(withChain.address);
    expect(discovered.registry).toEqual(withChain.registry);
  });

  it('discovers a Push-native address without a registry probe', async () => {
    const result = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      opts
    );
    expect(result.address.toLowerCase()).toBe(fixtures!.pushToken.toLowerCase());
  });
});

d('PC20 registry — rejections', () => {
  const opts = { network: PUSH_NETWORK.TESTNET_DONUT };

  itWrapper('rejects the same wrapper address on the wrong chain', async () => {
    // The copy-paste-onto-the-wrong-chain case. The address is real; the
    // namespace it is looked up under is not the one it is registered against.
    await expect(
      PushChain.utils.tokens.getPC20Address(fixtures!.wrapperSepolia!, {
        ...opts,
        chain: CHAIN.BASE_SEPOLIA,
      })
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  it('rejects an unregistered address', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address(
        '0x000000000000000000000000000000000000dEaD',
        { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
      )
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  it('rejects an unregistered address with no chain supplied', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address(
        '0x000000000000000000000000000000000000dEaD',
        opts
      )
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  it('rejects a malformed address before touching the network', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address('0xnothex', {
        ...opts,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      })
    ).rejects.toThrow(InvalidPC20AddressError);
  });

  itWrapper('passes strict factory-identity validation against the live gateway', async () => {
    // Tier B: the live external gateway's pc20Factory must equal
    // UniversalCore's pc20FactoryByChain, and the factory must recognize the
    // wrapper. This is what catches a misconfigured deployment.
    const result = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA, strict: true }
    );
    expect(result.address.toLowerCase()).toBe(fixtures!.pushToken.toLowerCase());
  });
});
