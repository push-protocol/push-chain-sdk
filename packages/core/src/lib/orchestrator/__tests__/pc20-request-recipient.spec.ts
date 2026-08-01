/**
 * `req.recipient` on the gateway request for a PC20 burn.
 *
 * `UniversalGateway._routePC20Tx` forwards the post-fee native value as a
 * FUNDS request while copying `req.recipient` verbatim — unlike the ERC20
 * route, which sends the excess down the GAS path where `address(0)` is the
 * "credit the caller's UEA" sentinel. A FUNDS inbound deposits straight to
 * `inbound.Recipient`, so a zero there makes the chain mint the prepaid gas to
 * `address(0)` and revert, silently losing the deposit.
 *
 * Confirmed on Donut by eth_call from the ue module address:
 *   depositPRC20Token(pETH, 529361008326850, 0x0)  → reverts
 *   depositPRC20Token(pETH, 529361008326850, UEA)  → succeeds
 *
 * So a PC20 burn must name the UEA. Every other flow keeps the zero sentinel:
 * the chain overwrites `recipient` with zero for non-CEA payload inbounds, and
 * the ERC20 gas route handles zero itself.
 */
import { zeroAddress } from 'viem';
import { buildGatewayPayloadAndGas } from '../internals/payload-builder';
import type { LegacyExecuteParams } from '../orchestrator.types';

const UEA = '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D';
const SIGNER = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf';
const WRAPPER = '0x81E05001A1f3fB574E18c1B0b2596163c68144ae';
const PUSH_TOKEN = '0x14693f665cE282A451ba9a86F2EC04B43F931145';

jest.mock('../internals/uea-manager', () => ({
  computeUEAOffchain: () => UEA,
  getUEANonce: jest.fn(),
  getUeaStatusAndNonce: jest.fn(),
  fetchUEAVersion: jest.fn(),
}));

const ctx = {
  universalSigner: { account: { address: SIGNER, chain: 'eip155:11155111' } },
  printLogs: false,
} as unknown as Parameters<typeof buildGatewayPayloadAndGas>[0];

function params(overrides: Partial<LegacyExecuteParams>): LegacyExecuteParams {
  return {
    to: UEA,
    funds: {
      amount: BigInt('1000000000000000'),
      token: {
        address: WRAPPER,
        symbol: 'RAIN',
        decimals: 18,
        mechanism: 'pc20-burn',
      },
    },
    ...overrides,
  } as unknown as LegacyExecuteParams;
}

const pc20Descriptor = {
  direction: 'import' as const,
  originChain: 'eip155:11155111',
  originAddress: WRAPPER,
  pushAddress: PUSH_TOKEN,
  name: 'Rain',
  symbol: 'RAIN',
  decimals: 18,
};

describe('gateway request recipient', () => {
  it('names the UEA for a PC20 burn so the native gas leg can be credited', async () => {
    const { req } = await buildGatewayPayloadAndGas(
      ctx,
      params({ _pc20: pc20Descriptor } as Partial<LegacyExecuteParams>),
      BigInt(58),
      'sendFunds',
      BigInt('1000000000000000')
    );
    expect(req.recipient).toBe(UEA);
    // The zero that made depositPRC20Token revert must not come back.
    expect(req.recipient).not.toBe(zeroAddress);
  });

  it('keeps the zero sentinel for a non-PC20 transfer', async () => {
    const { req } = await buildGatewayPayloadAndGas(
      ctx,
      params({
        funds: {
          amount: BigInt('1000000000000000'),
          token: {
            address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            symbol: 'ETH',
            decimals: 18,
            mechanism: 'native',
          },
        },
      } as Partial<LegacyExecuteParams>),
      BigInt(1),
      'sendFunds',
      BigInt('1000000000000000')
    );
    expect(req.recipient).toBe(zeroAddress);
  });

  it('keeps the zero sentinel for a PC20 export (no burn leg on the source)', async () => {
    const { req } = await buildGatewayPayloadAndGas(
      ctx,
      params({
        _pc20: { ...pc20Descriptor, direction: 'export' as const },
      } as Partial<LegacyExecuteParams>),
      BigInt(2),
      'sendFunds',
      BigInt('1000000000000000')
    );
    expect(req.recipient).toBe(zeroAddress);
  });
});
