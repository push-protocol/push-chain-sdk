/**
 * Resolver tests against a scripted RPC.
 *
 * `viem`'s public client is mocked at the transport boundary rather than the
 * client boundary so `multicall` batching is exercised for real — the
 * round-trip budget assertions would be meaningless against a mocked
 * `multicall()`.
 */

import { CHAIN, PUSH_NETWORK, VM } from '../../../../constants/enums';

// ---------------------------------------------------------------------------
// Scripted client
// ---------------------------------------------------------------------------

type Script = {
  /** getPC20Source(wrapper, ns) → [source, known] */
  source?: [string, boolean];
  /** getPC20Wrapper(source, ns) → [wrapper, deployed] */
  wrapper?: [string, boolean];
  /** getPC20Wrapper per namespace, for deployment listing */
  wrappersByNamespace?: Record<string, [string, boolean]>;
  /** getPC20Source per namespace, for chain discovery */
  sourceByNamespace?: Record<string, [string, boolean]>;
  /** pc20Metadata() → [name, symbol, decimals, originAddress] */
  metadata?: [string, string, number, string] | 'revert';
  /** CHAIN_NAMESPACE() on the token, present only on synthetic PRC20s */
  prc20Namespace?: string;
  code?: string;
};

let script: Script = {};
let multicallCalls = 0;
let singleReads = 0;
/** Namespaces passed to getPC20Source in the most recent batch. */
let lastProbedNamespaces: string[] = [];

// Lowercase fixtures. Mixed-case addresses are checksum-validated, so an
// arbitrary `0xAaAa…` literal is (correctly) rejected as a typo.
const PUSH_PC20 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WRAPPER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER_WRAPPER = '0xdddddddddddddddddddddddddddddddddddddddd';
const UNIVERSAL_CORE = '0xcccccccccccccccccccccccccccccccccccccccc';
const ZERO = '0x0000000000000000000000000000000000000000';

const pad = (addr: string) => ('0x' + '0'.repeat(24) + addr.slice(2)) as `0x${string}`;
const ZERO32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

jest.mock('viem', () => {
  const actual = jest.requireActual('viem');

  const resolveOne = (c: { functionName: string }) => {
    switch (c.functionName) {
      case 'getPC20Source':
        return script.source
          ? { status: 'success', result: [script.source[0], script.source[1]] }
          : { status: 'success', result: [ZERO, false] };
      case 'getPC20Wrapper':
        return script.wrapper
          ? {
              status: 'success',
              result: [
                script.wrapper[0] === ZERO ? ZERO32 : pad(script.wrapper[0]),
                script.wrapper[1],
              ],
            }
          : { status: 'success', result: [ZERO32, false] };
      case 'pc20Metadata':
        return script.metadata && script.metadata !== 'revert'
          ? { status: 'success', result: script.metadata }
          : { status: 'failure', error: new Error('reverted') };
      case 'CHAIN_NAMESPACE':
        return script.prc20Namespace
          ? { status: 'success', result: script.prc20Namespace }
          : { status: 'failure', error: new Error('reverted') };
      default:
        return { status: 'failure', error: new Error('unscripted') };
    }
  };

  return {
    ...actual,
    createPublicClient: () => ({
      multicall: async ({ contracts }: { contracts: { functionName: string; args: unknown[] }[] }) => {
        multicallCalls += 1;
        const probed = contracts
          .filter((c) => c.functionName === 'getPC20Source')
          .map((c) => c.args[1] as string);
        if (probed.length > 0) lastProbedNamespaces = probed;

        return contracts.map((c) => {
          if (c.functionName === 'getPC20Wrapper' && script.wrappersByNamespace) {
            const ns = c.args[1] as string;
            const hit = script.wrappersByNamespace[ns];
            return hit
              ? { status: 'success', result: [pad(hit[0]), hit[1]] }
              : { status: 'success', result: [ZERO32, false] };
          }
          if (c.functionName === 'getPC20Source' && script.sourceByNamespace) {
            const ns = c.args[1] as string;
            const hit = script.sourceByNamespace[ns];
            return hit
              ? { status: 'success', result: [hit[0], hit[1]] }
              : { status: 'success', result: [ZERO, false] };
          }
          return resolveOne(c);
        });
      },
      readContract: async () => {
        singleReads += 1;
        return UNIVERSAL_CORE;
      },
      getCode: async () => {
        singleReads += 1;
        return script.code ?? '0x60006000';
      },
    }),
  };
});

// Imported after the mock so the resolver picks up the scripted client.
import {
  resolvePC20Token,
  discoverPC20Chain,
  resolveWrapperToSource,
  readPushPC20Metadata,
  listPC20Deployments,
  __clearPC20Caches,
  __readCount,
} from '../resolver';
import {
  PC20WrapperNotRegisteredError,
  PC20RegistryMismatchError,
  PC20ExpectedButPRC20Error,
  PC20AmbiguousAddressError,
  InvalidPC20MetadataError,
} from '../errors';
import { chainToNamespace } from '../chain-namespace';

const OPTS = { network: PUSH_NETWORK.TESTNET_DONUT };
const CHAIN_UNDER_TEST = CHAIN.ETHEREUM_SEPOLIA;

const validMetadata = (): [string, string, number, string] => [
  'Push Token',
  'PUSH',
  18,
  PUSH_PC20,
];

beforeEach(() => {
  script = {};
  multicallCalls = 0;
  singleReads = 0;
  lastProbedNamespaces = [];
  __clearPC20Caches();
});

describe('resolveWrapperToSource', () => {
  it('resolves a registered wrapper to its Push source', async () => {
    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];

    const result = await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    expect(result.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
    expect(result.chainNamespace).toBe(chainToNamespace(CHAIN_UNDER_TEST));
  });

  it('rejects an unknown wrapper', async () => {
    script.source = [ZERO, false];
    await expect(
      resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS)
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  it('rejects when forward and reverse registry lookups disagree', async () => {
    // Reverse resolves to a different wrapper — a stale registry entry. Burning
    // would unlock the wrong Push token.
    script.source = [PUSH_PC20, true];
    script.wrapper = [OTHER_WRAPPER, true];

    await expect(
      resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS)
    ).rejects.toThrow(PC20RegistryMismatchError);
  });

  it('rejects a wrapper that is not registered on the supplied chain', async () => {
    // Same address, different chain: the registry has no entry under this
    // namespace. This is the copy-paste-onto-the-wrong-chain case.
    script.source = [ZERO, false];
    await expect(
      resolveWrapperToSource(CHAIN.BASE_SEPOLIA, WRAPPER, OPTS)
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });

  it('caches positive results and does not re-read', async () => {
    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];

    await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);
    const after = multicallCalls;
    await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    expect(multicallCalls).toBe(after);
  });

  it('does not cache negative results', async () => {
    // A first export creates a mapping that did not exist. A cached negative
    // would make the SDK permanently wrong about a token that now works.
    script.source = [ZERO, false];
    await expect(
      resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS)
    ).rejects.toThrow();
    const afterFirst = multicallCalls;

    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];
    const result = await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    expect(multicallCalls).toBeGreaterThan(afterFirst);
    expect(result.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
  });

  it('stays within the cold round-trip budget', async () => {
    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];

    __readCount.n = 0;
    await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    // universalCore pointer + getPC20Source + getPC20Wrapper.
    expect(__readCount.n).toBeLessThanOrEqual(4);
  });

  it('stays within the warm round-trip budget', async () => {
    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];
    await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    __readCount.n = 0;
    await resolveWrapperToSource(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    expect(__readCount.n).toBeLessThanOrEqual(2);
  });
});

describe('readPushPC20Metadata', () => {
  it('accepts valid metadata', async () => {
    script.metadata = validMetadata();
    const meta = await readPushPC20Metadata(PUSH_PC20, OPTS);
    expect(meta).toEqual({
      name: 'Push Token',
      symbol: 'PUSH',
      decimals: 18,
      originAddress: expect.any(String),
    });
  });

  it('rejects a token with no pc20Metadata()', async () => {
    script.metadata = 'revert';
    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      InvalidPC20MetadataError
    );
  });

  it('rejects a synthetic PRC20 with a distinct, actionable error', async () => {
    script.metadata = 'revert';
    script.prc20Namespace = 'eip155:11155111';

    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      PC20ExpectedButPRC20Error
    );
    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      /MoveableToken/
    );
  });

  it('rejects an originAddress that does not match the token address', async () => {
    script.metadata = ['Push Token', 'PUSH', 18, WRAPPER];
    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      /originAddress/
    );
  });

  it('rejects empty name or symbol', async () => {
    script.metadata = ['', 'PUSH', 18, PUSH_PC20];
    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      /non-empty/
    );
  });

  it('rejects an address with no deployed bytecode', async () => {
    script.code = '0x';
    script.metadata = validMetadata();
    await expect(readPushPC20Metadata(PUSH_PC20, OPTS)).rejects.toThrow(
      /No contract is deployed/
    );
  });
});

describe('listPC20Deployments', () => {
  it('returns only confirmed deployments', async () => {
    script.wrappersByNamespace = {
      [chainToNamespace(CHAIN.ETHEREUM_SEPOLIA)]: [WRAPPER, true],
      // Registered but not deployed — must not be reported.
      [chainToNamespace(CHAIN.BASE_SEPOLIA)]: [WRAPPER, false],
    };

    const deployments = await listPC20Deployments(PUSH_PC20, {
      ...OPTS,
      chains: [CHAIN.ETHEREUM_SEPOLIA, CHAIN.BASE_SEPOLIA, CHAIN.BNB_TESTNET],
    });

    expect(deployments).toHaveLength(1);
    expect(deployments[0].chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(deployments[0].vm).toBe(VM.EVM);
    expect(deployments[0].address.toLowerCase()).toBe(WRAPPER);
  });

  it('issues exactly one multicall regardless of chain count', async () => {
    script.wrappersByNamespace = {
      [chainToNamespace(CHAIN.ETHEREUM_SEPOLIA)]: [WRAPPER, true],
    };

    // Warm the UniversalCore pointer so it is not counted here.
    await listPC20Deployments(PUSH_PC20, { ...OPTS, chains: [CHAIN.BNB_TESTNET] });
    multicallCalls = 0;

    await listPC20Deployments(PUSH_PC20, OPTS); // every supported external chain
    expect(multicallCalls).toBe(1);
  });

  it('returns an empty list rather than throwing for a never-exported token', async () => {
    script.wrappersByNamespace = {};
    await expect(listPC20Deployments(PUSH_PC20, OPTS)).resolves.toEqual([]);
  });
});

describe('discoverPC20Chain', () => {
  it('short-circuits on a Push-native address without probing the registry', async () => {
    script.metadata = validMetadata();

    const found = await discoverPC20Chain(PUSH_PC20, OPTS);

    expect(found?.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
    expect(found?.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
  });

  it('finds the chain a wrapper is registered on', async () => {
    script.metadata = 'revert'; // not Push-native
    script.sourceByNamespace = {
      [chainToNamespace(CHAIN_UNDER_TEST)]: [PUSH_PC20, true],
    };

    const found = await discoverPC20Chain(WRAPPER, OPTS);

    expect(found?.chain).toBe(CHAIN_UNDER_TEST);
    expect(found?.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
  });

  it('returns null when no chain claims the address', async () => {
    script.metadata = 'revert';
    script.sourceByNamespace = {};

    await expect(discoverPC20Chain(WRAPPER, OPTS)).resolves.toBeNull();
  });

  it('accepts the same address on several chains when they agree', async () => {
    // CREATE2 can legitimately land the same wrapper address on two chains.
    // That is only ambiguous if they resolve to different tokens.
    script.metadata = 'revert';
    script.sourceByNamespace = {
      [chainToNamespace(CHAIN.ETHEREUM_SEPOLIA)]: [PUSH_PC20, true],
      [chainToNamespace(CHAIN.BASE_SEPOLIA)]: [PUSH_PC20, true],
    };

    const found = await discoverPC20Chain(WRAPPER, OPTS);
    expect(found?.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
  });

  it('throws rather than guessing when chains disagree on the source', async () => {
    script.metadata = 'revert';
    script.sourceByNamespace = {
      [chainToNamespace(CHAIN.ETHEREUM_SEPOLIA)]: [PUSH_PC20, true],
      [chainToNamespace(CHAIN.BASE_SEPOLIA)]: [OTHER_WRAPPER, true],
    };

    await expect(discoverPC20Chain(WRAPPER, OPTS)).rejects.toThrow(
      PC20AmbiguousAddressError
    );
  });

  it('narrows by address format so a hex address never probes SVM chains', async () => {
    script.metadata = 'revert';
    script.sourceByNamespace = {};

    await discoverPC20Chain(WRAPPER, OPTS);

    // Every namespace probed in the single batch must be EVM.
    expect(lastProbedNamespaces.length).toBeGreaterThan(0);
    expect(lastProbedNamespaces.every((ns) => ns.startsWith('eip155:'))).toBe(true);
  });
});

describe('resolvePC20Token', () => {
  it('resolves an external wrapper as an import', async () => {
    script.source = [PUSH_PC20, true];
    script.wrapper = [WRAPPER, true];
    script.metadata = validMetadata();

    const resolved = await resolvePC20Token(CHAIN_UNDER_TEST, WRAPPER, OPTS);

    expect(resolved.direction).toBe('import');
    expect(resolved.originChain).toBe(CHAIN_UNDER_TEST);
    expect(resolved.wrapperAddress?.toLowerCase()).toBe(WRAPPER);
    expect(resolved.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
    expect(resolved.symbol).toBe('PUSH');
  });

  it('resolves a Push-native token as an export', async () => {
    script.metadata = validMetadata();

    const resolved = await resolvePC20Token(
      CHAIN.PUSH_TESTNET_DONUT,
      PUSH_PC20,
      OPTS
    );

    expect(resolved.direction).toBe('export');
    expect(resolved.wrapperAddress).toBeUndefined();
    expect(resolved.pushAddress.toLowerCase()).toBe(PUSH_PC20.toLowerCase());
  });

  it('never infers identity from symbol', async () => {
    // A token whose metadata says "PUSH" but whose wrapper is unregistered must
    // still fail. Symbol carries no authority.
    script.source = [ZERO, false];
    script.metadata = validMetadata();

    await expect(
      resolvePC20Token(CHAIN_UNDER_TEST, WRAPPER, OPTS)
    ).rejects.toThrow(PC20WrapperNotRegisteredError);
  });
});
