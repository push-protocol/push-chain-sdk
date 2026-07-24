/**
 * Unit tests for gateway-client.ts, uea-manager.ts, and account-manager.ts
 *
 * Tests pure data transformations, deterministic address computation,
 * nonce retrieval logic, caching behavior, and validation errors.
 * No real RPC calls are made — all chain interactions are mocked.
 */
import { CHAIN, PUSH_NETWORK, VM } from '../../constants/enums';
import { CHAIN_INFO, UEA_PROXY } from '../../constants/chain';
import type { OrchestratorContext } from '../internals/context';
import type {
  UniversalTxRequest,
  UniversalTokenTxRequest,
  AccountStatus,
} from '../orchestrator.types';

// ── Gateway client imports ──────────────────────────────────────────────────
import {
  toGatewayRequestV1,
  toGatewayTokenRequestV1,
} from '../internals/gateway-client';

// ── UEA manager imports ─────────────────────────────────────────────────────
import {
  computeUEAOffchain,
  getUEANonce,
  getUeaNonceForExecution,
  getUeaStatusAndNonce,
} from '../internals/uea-manager';

// ── Account manager imports ─────────────────────────────────────────────────
import {
  getAccountStatus,
  fetchLatestUEAVersion,
  migrateCEA,
} from '../internals/account-manager';

// ── Mock cea-utils ──────────────────────────────────────────────────────────
jest.mock('../cea-utils', () => ({
  getCEAAddress: jest.fn(),
  chainSupportsCEA: jest.fn(),
}));

import { getCEAAddress, chainSupportsCEA } from '../cea-utils';

jest.setTimeout(30000);

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

function makeMockCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    pushClient: {
      readContract: jest.fn(),
      publicClient: {
        getCode: jest.fn(),
      },
      pushChainInfo: {
        factoryAddress: '0x00000000000000000000000000000000000000eA',
      },
    } as any,
    universalSigner: {
      account: {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
      },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
    ueaVersionCache: undefined,
    ...overrides,
  } as unknown as OrchestratorContext;
}

function makeNativePushCtx(): OrchestratorContext {
  return makeMockCtx({
    universalSigner: {
      account: {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0xBa8F52487b31d3c212373da7C44bf855DeBf2283',
      },
    } as any,
  });
}

// ============================================================================
// gateway-client.ts — toGatewayRequestV1
// ============================================================================

describe('toGatewayRequestV1', () => {
  const baseReq: UniversalTxRequest = {
    recipient: '0x1111111111111111111111111111111111111111',
    token: '0x2222222222222222222222222222222222222222',
    amount: BigInt('1000000000000000000'),
    payload: '0xdeadbeef',
    revertInstruction: {
      fundRecipient: '0x3333333333333333333333333333333333333333',
      revertMsg: '0x00',
    },
    signatureData: '0xsig1234',
  };

  it('should flatten revertInstruction to revertRecipient', () => {
    const v1 = toGatewayRequestV1(baseReq);
    expect(v1.revertRecipient).toBe('0x3333333333333333333333333333333333333333');
    expect(v1).not.toHaveProperty('revertInstruction');
  });

  it('should preserve recipient, token, amount, payload, signatureData', () => {
    const v1 = toGatewayRequestV1(baseReq);
    expect(v1.recipient).toBe(baseReq.recipient);
    expect(v1.token).toBe(baseReq.token);
    expect(v1.amount).toBe(baseReq.amount);
    expect(v1.payload).toBe(baseReq.payload);
    expect(v1.signatureData).toBe(baseReq.signatureData);
  });

  it('should produce exactly 6 keys in the V1 output', () => {
    const v1 = toGatewayRequestV1(baseReq);
    expect(Object.keys(v1)).toHaveLength(6);
  });

  it('should handle zero amount', () => {
    const req = { ...baseReq, amount: BigInt(0) };
    const v1 = toGatewayRequestV1(req);
    expect(v1.amount).toBe(BigInt(0));
  });

  it('should handle empty payload', () => {
    const req = { ...baseReq, payload: '0x' as `0x${string}` };
    const v1 = toGatewayRequestV1(req);
    expect(v1.payload).toBe('0x');
  });
});

// ============================================================================
// gateway-client.ts — toGatewayTokenRequestV1
// ============================================================================

describe('toGatewayTokenRequestV1', () => {
  const baseTokenReq: UniversalTokenTxRequest = {
    recipient: '0x1111111111111111111111111111111111111111',
    token: '0x2222222222222222222222222222222222222222',
    amount: BigInt('500000000000000000'),
    gasToken: '0x4444444444444444444444444444444444444444',
    gasAmount: BigInt('100000'),
    payload: '0xcafe',
    revertInstruction: {
      fundRecipient: '0x5555555555555555555555555555555555555555',
      revertMsg: '0x00',
    },
    signatureData: '0xsig5678',
    amountOutMinETH: BigInt('100000000000000'),
    deadline: BigInt(1700000000),
  };

  it('should flatten revertInstruction to revertRecipient', () => {
    const v1 = toGatewayTokenRequestV1(baseTokenReq);
    expect(v1.revertRecipient).toBe('0x5555555555555555555555555555555555555555');
    expect(v1).not.toHaveProperty('revertInstruction');
  });

  it('should preserve all token-specific fields', () => {
    const v1 = toGatewayTokenRequestV1(baseTokenReq);
    expect(v1.gasToken).toBe(baseTokenReq.gasToken);
    expect(v1.gasAmount).toBe(baseTokenReq.gasAmount);
    expect(v1.amountOutMinETH).toBe(baseTokenReq.amountOutMinETH);
    expect(v1.deadline).toBe(baseTokenReq.deadline);
  });

  it('should preserve base fields', () => {
    const v1 = toGatewayTokenRequestV1(baseTokenReq);
    expect(v1.recipient).toBe(baseTokenReq.recipient);
    expect(v1.token).toBe(baseTokenReq.token);
    expect(v1.amount).toBe(baseTokenReq.amount);
    expect(v1.payload).toBe(baseTokenReq.payload);
    expect(v1.signatureData).toBe(baseTokenReq.signatureData);
  });

  it('should produce exactly 10 keys in the V1 output', () => {
    const v1 = toGatewayTokenRequestV1(baseTokenReq);
    expect(Object.keys(v1)).toHaveLength(10);
  });

  it('should handle zero gasAmount and amountOutMinETH', () => {
    const req = { ...baseTokenReq, gasAmount: BigInt(0), amountOutMinETH: BigInt(0) };
    const v1 = toGatewayTokenRequestV1(req);
    expect(v1.gasAmount).toBe(BigInt(0));
    expect(v1.amountOutMinETH).toBe(BigInt(0));
  });
});

// ============================================================================
// uea-manager.ts — computeUEAOffchain
// ============================================================================

describe('computeUEAOffchain', () => {
  it('should return a 0x-prefixed address for EVM signer', () => {
    const ctx = makeMockCtx();
    const addr = computeUEAOffchain(ctx);
    expect(addr.startsWith('0x')).toBe(true);
    expect(addr.length).toBe(42);
  });

  it('should produce deterministic output for same inputs', () => {
    const ctx = makeMockCtx();
    const addr1 = computeUEAOffchain(ctx);
    const addr2 = computeUEAOffchain(ctx);
    expect(addr1).toBe(addr2);
  });

  it('should produce different addresses for different signer addresses', () => {
    const ctx1 = makeMockCtx({
      universalSigner: {
        account: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: '0x1111111111111111111111111111111111111111',
        },
      } as any,
    });
    const ctx2 = makeMockCtx({
      universalSigner: {
        account: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: '0x2222222222222222222222222222222222222222',
        },
      } as any,
    });
    expect(computeUEAOffchain(ctx1)).not.toBe(computeUEAOffchain(ctx2));
  });

  it('should produce different addresses for different chains', () => {
    const ctx1 = makeMockCtx({
      universalSigner: {
        account: {
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
        },
      } as any,
    });
    const ctx2 = makeMockCtx({
      universalSigner: {
        account: {
          chain: CHAIN.ARBITRUM_SEPOLIA,
          address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
        },
      } as any,
    });
    expect(computeUEAOffchain(ctx1)).not.toBe(computeUEAOffchain(ctx2));
  });

  it('should return the raw signer address for Push Chain', () => {
    const pushAddress = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const ctx = makeMockCtx({
      universalSigner: {
        account: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: pushAddress,
        },
      } as any,
    });
    expect(computeUEAOffchain(ctx)).toBe(pushAddress);
  });

  it('should use the UEA_PROXY for the current pushNetwork in minimal proxy code', () => {
    // Verify the address depends on the pushNetwork's UEA_PROXY
    const ctxTestnet = makeMockCtx({ pushNetwork: PUSH_NETWORK.TESTNET });
    const ctxLocalnet = makeMockCtx({ pushNetwork: PUSH_NETWORK.LOCALNET });
    const addrTestnet = computeUEAOffchain(ctxTestnet);
    const addrLocalnet = computeUEAOffchain(ctxLocalnet);
    // Different UEA_PROXY values should yield different CREATE2 addresses
    if (UEA_PROXY[PUSH_NETWORK.TESTNET] !== UEA_PROXY[PUSH_NETWORK.LOCALNET]) {
      expect(addrTestnet).not.toBe(addrLocalnet);
    }
  });
});

// ============================================================================
// uea-manager.ts — getUeaNonceForExecution
// ============================================================================

describe('getUeaNonceForExecution', () => {
  it('should not probe EIP-7702 delegation code for a native Push EOA', async () => {
    const ctx = makeNativePushCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(
      '0xef01000106bf2f9b02f32203a83a3bdad79fe8818f3796'
    );

    const nonce = await getUeaNonceForExecution(ctx);

    expect(nonce).toBe(BigInt(0));
    expect(ctx.pushClient.publicClient.getCode).not.toHaveBeenCalled();
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });

  it('should return 0 when UEA is not deployed (no code)', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const nonce = await getUeaNonceForExecution(ctx);
    expect(nonce).toBe(BigInt(0));
  });

  it('should query nonce from contract when UEA is deployed', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue('0x6001');
    (ctx.pushClient.readContract as jest.Mock).mockResolvedValue(BigInt(5));

    const nonce = await getUeaNonceForExecution(ctx);
    expect(nonce).toBe(BigInt(5));
  });

  it('should call getCode with the computed UEA address', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    await getUeaNonceForExecution(ctx);

    const computedUEA = computeUEAOffchain(ctx);
    expect(ctx.pushClient.publicClient.getCode).toHaveBeenCalledWith({
      address: computedUEA,
    });
  });

  it('should call readContract with nonce function when deployed', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue('0x600160');
    (ctx.pushClient.readContract as jest.Mock).mockResolvedValue(BigInt(42));

    await getUeaNonceForExecution(ctx);

    expect(ctx.pushClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'nonce' })
    );
  });
});

// ============================================================================
// uea-manager.ts — getUeaStatusAndNonce
// ============================================================================

describe('getUeaStatusAndNonce', () => {
  it('should classify an EIP-7702 delegated native Push account as an EOA', async () => {
    const ctx = makeNativePushCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(
      '0xef01000106bf2f9b02f32203a83a3bdad79fe8818f3796'
    );

    const result = await getUeaStatusAndNonce(ctx);

    expect(result).toEqual({ deployed: false, nonce: BigInt(0) });
    expect(ctx.pushClient.publicClient.getCode).not.toHaveBeenCalled();
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });

  it('should return deployed=false, nonce=0 when no code exists', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const result = await getUeaStatusAndNonce(ctx);
    expect(result.deployed).toBe(false);
    expect(result.nonce).toBe(BigInt(0));
  });

  it('should return deployed=true with on-chain nonce when code exists', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue('0x6001');
    (ctx.pushClient.readContract as jest.Mock).mockResolvedValue(BigInt(10));

    const result = await getUeaStatusAndNonce(ctx);
    expect(result.deployed).toBe(true);
    expect(result.nonce).toBe(BigInt(10));
  });

  it('should not call readContract when UEA is not deployed', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    await getUeaStatusAndNonce(ctx);
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });
});

describe('getUEANonce', () => {
  it('should use no UEA nonce for a native Push EOA', async () => {
    const ctx = makeNativePushCtx();

    const nonce = await getUEANonce(
      ctx,
      ctx.universalSigner.account.address as `0x${string}`
    );

    expect(nonce).toBe(BigInt(0));
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });
});

// ============================================================================
// account-manager.ts — getAccountStatus (caching)
// ============================================================================

describe('getAccountStatus', () => {
  it('should skip UEA lifecycle checks for an EIP-7702 native Push EOA', async () => {
    const ctx = makeNativePushCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(
      '0xef01000106bf2f9b02f32203a83a3bdad79fe8818f3796'
    );

    const status = await getAccountStatus(ctx);

    expect(status.uea.deployed).toBe(false);
    expect(status.uea.requiresUpgrade).toBe(false);
    expect(ctx.pushClient.publicClient.getCode).not.toHaveBeenCalled();
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });

  it('should return cached status on second call', async () => {
    const ctx = makeMockCtx();
    // First call: UEA not deployed
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const first = await getAccountStatus(ctx);
    expect(first.uea.deployed).toBe(false);
    expect(first.uea.loaded).toBe(true);

    // Second call: should return cache without hitting getCode again
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockClear();
    const second = await getAccountStatus(ctx);
    expect(second).toBe(first); // exact same reference (cache hit)
    expect(ctx.pushClient.publicClient.getCode).not.toHaveBeenCalled();
  });

  it('should bypass cache when forceRefresh is true', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const first = await getAccountStatus(ctx);

    // Force refresh should re-fetch
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockClear();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);
    const refreshed = await getAccountStatus(ctx, { forceRefresh: true });
    expect(ctx.pushClient.publicClient.getCode).toHaveBeenCalled();
    expect(refreshed.uea.loaded).toBe(true);
  });

  it('should set mode to signer', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const status = await getAccountStatus(ctx);
    expect(status.mode).toBe('signer');
  });

  it('should return deployed=false with empty versions when UEA not deployed', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    const status = await getAccountStatus(ctx);
    expect(status.uea.deployed).toBe(false);
    expect(status.uea.version).toBe('');
    expect(status.uea.minRequiredVersion).toBe('');
    expect(status.uea.requiresUpgrade).toBe(false);
  });

  it('should fetch versions when UEA is deployed', async () => {
    const ctx = makeMockCtx();
    // getCode returns code (deployed)
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue('0x6001');
    // readContract is called by nonce, VERSION, and UEA_VERSION in parallel;
    // use function-based mock to return correct value based on functionName.
    (ctx.pushClient.readContract as jest.Mock).mockImplementation(
      (args: { functionName: string }) => {
        if (args.functionName === 'nonce') return Promise.resolve(BigInt(3));
        if (args.functionName === 'VERSION') return Promise.resolve('1.0.0');
        if (args.functionName === 'UEA_VERSION') return Promise.resolve('1.0.2');
        return Promise.resolve(undefined);
      }
    );

    const status = await getAccountStatus(ctx);
    expect(status.uea.deployed).toBe(true);
    expect(status.uea.version).toBe('1.0.0');
    expect(status.uea.minRequiredVersion).toBe('1.0.2');
    expect(status.uea.requiresUpgrade).toBe(true);
  });

  it('should set requiresUpgrade=false when versions match', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue('0x6001');
    (ctx.pushClient.readContract as jest.Mock).mockImplementation(
      (args: { functionName: string }) => {
        if (args.functionName === 'nonce') return Promise.resolve(BigInt(0));
        if (args.functionName === 'VERSION') return Promise.resolve('1.0.2');
        if (args.functionName === 'UEA_VERSION') return Promise.resolve('1.0.2');
        return Promise.resolve(undefined);
      }
    );

    const status = await getAccountStatus(ctx);
    expect(status.uea.requiresUpgrade).toBe(false);
  });

  it('should persist status to ctx.accountStatusCache', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.publicClient.getCode as jest.Mock).mockResolvedValue(undefined);

    expect(ctx.accountStatusCache).toBeNull();
    const status = await getAccountStatus(ctx);
    expect(ctx.accountStatusCache).toBe(status);
  });
});

// ============================================================================
// account-manager.ts — fetchLatestUEAVersion
// ============================================================================

describe('fetchLatestUEAVersion', () => {
  it('should call readContract with UEA_VERSION and keccak256 of VM string', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.readContract as jest.Mock).mockResolvedValue('1.0.2');

    const version = await fetchLatestUEAVersion(ctx, VM.EVM);
    expect(version).toBe('1.0.2');
    expect(ctx.pushClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'UEA_VERSION' })
    );
  });

  it('should return empty string when readContract throws', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.readContract as jest.Mock).mockRejectedValue(
      new Error('contract reverted')
    );

    const version = await fetchLatestUEAVersion(ctx, VM.EVM);
    expect(version).toBe('');
  });

  it('should return empty string when factory address is 0xTBD', async () => {
    const ctx = makeMockCtx({ pushNetwork: PUSH_NETWORK.MAINNET });

    const version = await fetchLatestUEAVersion(ctx, VM.EVM);
    expect(version).toBe('');
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });

  it('should work for SVM vm type', async () => {
    const ctx = makeMockCtx();
    (ctx.pushClient.readContract as jest.Mock).mockResolvedValue('2.0.0');

    const version = await fetchLatestUEAVersion(ctx, VM.SVM);
    expect(version).toBe('2.0.0');
  });
});

// ============================================================================
// account-manager.ts — migrateCEA (validation)
// ============================================================================

describe('migrateCEA', () => {
  const mockExecuteFn = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw "Cannot migrate CEA on Push Chain" for Push Chain', async () => {
    const ctx = makeMockCtx();

    await expect(
      migrateCEA(ctx, CHAIN.PUSH_TESTNET_DONUT, mockExecuteFn)
    ).rejects.toThrow('Cannot migrate CEA on Push Chain');

    expect(mockExecuteFn).not.toHaveBeenCalled();
  });

  it('should throw "Cannot migrate CEA on Push Chain" for Push Localnet', async () => {
    const ctx = makeMockCtx();

    await expect(
      migrateCEA(ctx, CHAIN.PUSH_LOCALNET, mockExecuteFn)
    ).rejects.toThrow('Cannot migrate CEA on Push Chain');
  });

  it('should throw when chain does not support CEA', async () => {
    const ctx = makeMockCtx();
    (chainSupportsCEA as jest.Mock).mockReturnValue(false);

    await expect(
      migrateCEA(ctx, CHAIN.SOLANA_DEVNET, mockExecuteFn)
    ).rejects.toThrow(`Chain ${CHAIN.SOLANA_DEVNET} does not support CEA`);
  });

  it('should throw when CEA is not deployed on the target chain', async () => {
    const ctx = makeMockCtx();
    (chainSupportsCEA as jest.Mock).mockReturnValue(true);
    (getCEAAddress as jest.Mock).mockResolvedValue({
      cea: '0x9999999999999999999999999999999999999999',
      isDeployed: false,
    });

    await expect(
      migrateCEA(ctx, CHAIN.ETHEREUM_SEPOLIA, mockExecuteFn)
    ).rejects.toThrow(
      `CEA not deployed on chain ${CHAIN.ETHEREUM_SEPOLIA}. Deploy CEA first.`
    );
  });

  it('should call executeFn with cea address and migration flag when valid', async () => {
    const ctx = makeMockCtx();
    const ceaAddr = '0xAAAA000000000000000000000000000000000AAA' as `0x${string}`;
    (chainSupportsCEA as jest.Mock).mockReturnValue(true);
    (getCEAAddress as jest.Mock).mockResolvedValue({
      cea: ceaAddr,
      isDeployed: true,
    });
    mockExecuteFn.mockResolvedValue({ txHash: '0xresult' });

    const result = await migrateCEA(ctx, CHAIN.ETHEREUM_SEPOLIA, mockExecuteFn);

    expect(mockExecuteFn).toHaveBeenCalledWith({
      to: { address: ceaAddr, chain: CHAIN.ETHEREUM_SEPOLIA },
      migration: true,
    });
    expect(result).toEqual({ txHash: '0xresult' });
  });

  it('should call getCEAAddress with computed UEA and chain', async () => {
    const ctx = makeMockCtx();
    (chainSupportsCEA as jest.Mock).mockReturnValue(true);
    (getCEAAddress as jest.Mock).mockResolvedValue({
      cea: '0x0000000000000000000000000000000000000001',
      isDeployed: true,
    });
    mockExecuteFn.mockResolvedValue({});

    await migrateCEA(ctx, CHAIN.ETHEREUM_SEPOLIA, mockExecuteFn);

    const expectedUEA = computeUEAOffchain(ctx);
    expect(getCEAAddress).toHaveBeenCalledWith(
      expectedUEA,
      CHAIN.ETHEREUM_SEPOLIA,
      undefined // ctx.rpcUrls[chain]?.[0] is undefined for default mock
    );
  });
});
