/**
 * Regression coverage for Route 3 prepared payloads targeting a native Push
 * EOA whose account carries an EIP-7702 delegation designator.
 */
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import type { OrchestratorContext } from '../internals/context';
import { buildPayloadForRoute } from '../internals/route-handlers';
import type {
  ChainSource,
  UniversalExecuteParams,
} from '../orchestrator.types';
import { TransactionRoute } from '../route-detector';
import { getCEAAddress } from '../cea-utils';

jest.mock('../cea-utils', () => ({
  getCEAAddress: jest.fn(),
  chainSupportsOutbound: jest.fn(() => true),
}));

const PUSH_EOA = '0xBa8F52487b31d3c212373da7C44bf855DeBf2283' as const;
const CEA = '0x20c3f10d167146aE86E220ee2C31682F72efe556' as const;
const EIP_7702_DELEGATION =
  '0xef01000106bf2f9b02f32203a83a3bdad79fe8818f3796' as const;

function makeCtx(): OrchestratorContext {
  return {
    rpcUrls: {},
    printTraces: false,
    progressHook: () => undefined,
    pushClient: {
      publicClient: {
        getCode: jest.fn().mockResolvedValue(EIP_7702_DELEGATION),
      },
      readContract: jest.fn(),
    } as never,
    universalSigner: {
      account: {
        address: PUSH_EOA,
        chain: CHAIN.PUSH_TESTNET_DONUT,
      },
    } as never,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

describe('buildPayloadForRoute — EVM Route 3 native Push EOA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCEAAddress as jest.Mock).mockResolvedValue({
      cea: CEA,
      isDeployed: true,
    });
  });

  it('uses the supplied native-EOA nonce without probing delegated code', async () => {
    const ctx = makeCtx();
    const params: UniversalExecuteParams = {
      from: { chain: CHAIN.ETHEREUM_SEPOLIA } as ChainSource,
      to: PUSH_EOA,
      funds: {
        amount: BigInt(10_000),
        token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.USDT,
      },
    };

    await buildPayloadForRoute(
      ctx,
      params,
      TransactionRoute.CEA_TO_PUSH,
      BigInt(0)
    );

    expect(ctx.pushClient.publicClient.getCode).not.toHaveBeenCalled();
    expect(ctx.pushClient.readContract).not.toHaveBeenCalled();
  });
});
