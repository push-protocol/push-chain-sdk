import { getUniversalTxId } from './trackTransaction';
import type { ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';

const event = (response: object | null): ProgressEvent => ({
  id: 'SEND-TX-209-01',
  title: 'Pending',
  message: 'Pending',
  level: 'INFO',
  response,
  timestamp: new Date(0).toISOString(),
});

describe('getUniversalTxId', () => {
  it('combines the initial chain and transaction hash in CAIP format', () => {
    expect(
      getUniversalTxId(
        event({ txHash: '0xd68c9945' }),
        'eip155:11155111'
      )
    ).toBe('eip155:11155111:0xd68c9945');
  });

  it('supports relay progress events carrying pushTxHash', () => {
    expect(
      getUniversalTxId(event({ pushTxHash: '0xpush' }), 'eip155:42101')
    ).toBe('eip155:42101:0xpush');
  });

  it('falls back to the response chain when no initial chain is available', () => {
    expect(
      getUniversalTxId(event({ chain: 'solana:devnet', txHash: 'signature' }))
    ).toBe('solana:devnet:signature');
  });

  it('does not create a tracking ID without both a hash and chain', () => {
    expect(getUniversalTxId(event({}), 'eip155:11155111')).toBeNull();
    expect(getUniversalTxId(event({ txHash: '0xhash' }))).toBeNull();
  });
});
