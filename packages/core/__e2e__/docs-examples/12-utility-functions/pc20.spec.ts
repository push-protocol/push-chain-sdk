/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Mirrors the PC20 utility example in
 * docs/chain/03-build/12-Utility-Functions.mdx → "### Get PC20 Address".
 *
 * slug: utility_get_pc20_address
 *
 * Read-only: no signer, no funds, nothing broadcast. This is the one PC20 docs
 * example that can run the moment a deployment exists, so it is gated on
 * PC20_PUSH_TOKEN alone rather than on a private key.
 *
 * The assertions are the docs' own claims, stated as tests:
 *   - either end of the mapping resolves to the same canonical token
 *   - `registry` lists confirmed deployments, canonical Push entry LAST
 *   - `chain` is optional; auto-discovery agrees with the explicit answer
 *   - malformed and unregistered addresses reject
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
  skipNote,
} from '@e2e/shared/pc20-fixtures';

const fixtures = getPC20ReadFixtures();
const d = fixtures ? describe : describe.skip;

/**
 * Wrapper-dependent cases are chosen as `it.skip` up front rather than
 * returning early inside the body — an early return reports as PASSED while
 * asserting nothing, which is indistinguishable from a real pass.
 */
const itWrapper = fixtures?.wrapperSepolia ? it : it.skip;

announcePC20Skip('docs-examples › 12-utility-functions › PC20', false);
if (fixtures && !fixtures.wrapperSepolia) {
  skipNote(
    'docs-examples PC20 wrapper cases',
    'PC20_WRAPPER_SEPOLIA not set — no wrapper has been exported yet'
  );
}

d('docs-examples › 12-utility-functions › getPC20Address', () => {
  const opts = { network: PUSH_NETWORK.TESTNET };

  /**
   * MDX: the primary snippet — resolve from the canonical Push-native token
   * and read its metadata.
   */
  it('resolves the canonical Push token and its metadata', async () => {
    const token = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    expect(token.address.toLowerCase()).toBe(fixtures!.pushToken.toLowerCase());
    expect(token.name).toBeTruthy();
    expect(token.symbol).toBeTruthy();
    expect(typeof token.decimals).toBe('number');
    expect(token.network).toBe(PUSH_NETWORK.TESTNET);
  });

  /**
   * MDX: "Accepts either end of the mapping … and always returns the canonical
   * token at `address`."
   */
  itWrapper('returns the same result from either end of the mapping', async () => {
    const fromWrapper = await PushChain.utils.tokens.getPC20Address(
      fixtures!.wrapperSepolia!,
      { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
    );
    const fromPush = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    expect(fromWrapper.address).toBe(fromPush.address);
    expect(fromWrapper.registry).toEqual(fromPush.registry);
  });

  /**
   * MDX: "wrappers first, Push last" — the loop in the playground prints the
   * registry in this order, so the order is a documented guarantee.
   */
  it('lists confirmed deployments with the canonical Push entry last', async () => {
    const { registry } = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );

    expect(registry.length).toBeGreaterThan(0);
    for (const entry of registry) {
      expect(entry.address).toBeTruthy();
      expect(entry.chainName).toBeTruthy();
      expect(entry.chain).toBeTruthy();
    }
    expect(registry[registry.length - 1].chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
  });

  /**
   * MDX: "'chain' is optional. Omit it and the SDK discovers where the address
   * lives." The playground asserts this by comparing the two addresses.
   */
  it('discovers the chain when none is supplied', async () => {
    const withChain = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      { ...opts, chain: CHAIN.PUSH_TESTNET_DONUT }
    );
    const discovered = await PushChain.utils.tokens.getPC20Address(
      fixtures!.pushToken,
      opts
    );

    expect(discovered.address).toBe(withChain.address);
  });

  itWrapper('discovers the chain for a wrapper too', async () => {
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
});

d('docs-examples › 12-utility-functions › getPC20Address rejections', () => {
  const opts = { network: PUSH_NETWORK.TESTNET };

  /** MDX tip: an unregistered address is not silently resolved. */
  it('rejects an unregistered address', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address(
        '0x000000000000000000000000000000000000dEaD',
        { ...opts, chain: CHAIN.ETHEREUM_SEPOLIA }
      )
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  /** MDX args table: "Chain-native form: checksummed hex on EVM…". */
  it('rejects a malformed address before touching the network', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address('0xnothex', {
        ...opts,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      })
    ).rejects.toThrow(InvalidPC20AddressError);
  });

  /**
   * MDX `options.chain` row: "Where the address lives." A real wrapper looked
   * up under the wrong namespace is the copy-paste-onto-the-wrong-chain case.
   */
  itWrapper('rejects a real wrapper looked up on the wrong chain', async () => {
    await expect(
      PushChain.utils.tokens.getPC20Address(fixtures!.wrapperSepolia!, {
        ...opts,
        chain: CHAIN.BASE_SEPOLIA,
      })
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });
});
