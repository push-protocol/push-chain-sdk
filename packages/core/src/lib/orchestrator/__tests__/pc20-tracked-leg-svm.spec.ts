/**
 * Solana counterpart of the PC20 tracked-leg selection.
 *
 * The default heuristic returns the SECOND gateway event when a transaction
 * emits two. For a PC20 wrapper burn that carries a native gas deposit, the
 * second event is the gas/funds leg — the one the known fee-credit bug fails —
 * while the user's transfer is the first (PC20) event. Tracking the wrong leg
 * reported a successful transfer as failed.
 *
 * The PC20 event body below is the real base64 emitted by the deployed devnet
 * gateway (captured from a `send_universal_tx` simulation of a 0.001 burn), so
 * the Borsh offsets used by the selector are pinned against production bytes
 * rather than a hand-rolled fixture.
 */
import { getSvmGatewayLogIndexFromTx } from '../internals/svm-helpers';

/** Real PC20 burn event — payload is exactly the 4-byte `PC20` selector. */
const PC20_EVENT_B64 =
  'bJrYKbXqHXwpUwJtMoIYsQcmjv5g99mGNa8f9TWpFzH3XKfPioWQRBERERERERERERERERERERERERERAXbFpQxfD7JfdFKBXAssDhuD4d11GRiHPnwAmKuFVhIAgMakfo0DAAQAAABQQzIwKVMCbTKCGLEHJo7+YPfZhjWvH/U1qRcx91ynz4qFkEQDAAAAAAA=';

/**
 * A sibling gateway event with an empty payload — the shape of the native
 * funds leg emitted alongside the burn. Same discriminator, payload_len = 0.
 */
function emptyPayloadEventB64(): string {
  const pc20 = Buffer.from(PC20_EVENT_B64, 'base64');
  const PAYLOAD_LEN_OFFSET = 8 + 32 + 20 + 32 + 8;
  const head = pc20.subarray(0, PAYLOAD_LEN_OFFSET);
  const zeroLen = Buffer.alloc(4); // payload_len = 0
  const tail = pc20.subarray(PAYLOAD_LEN_OFFSET + 4 + 4); // skip len + 4B selector
  return Buffer.concat([head, zeroLen, tail]).toString('base64');
}

const txWith = (events: string[]) => ({
  meta: {
    logMessages: [
      'Program CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS invoke [1]',
      'Program log: Instruction: SendUniversalTx',
      ...events.map((e) => `Program data: ${e}`),
      'Program CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS success',
    ],
  },
});

describe('PC20 tracked leg selection (SVM)', () => {
  const fundsLeg = emptyPayloadEventB64();

  it('default behaviour is unchanged: second gateway event wins', () => {
    const tx = txWith([PC20_EVENT_B64, fundsLeg]);
    // logMessages index of the 2nd `Program data:` line.
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(3);
  });

  it('preferPC20 selects the burn leg rather than the trailing funds leg', () => {
    const tx = txWith([PC20_EVENT_B64, fundsLeg]);
    expect(getSvmGatewayLogIndexFromTx(tx, true)).toBe(2);
  });

  it('finds the PC20 leg regardless of emission order', () => {
    const tx = txWith([fundsLeg, PC20_EVENT_B64]);
    expect(getSvmGatewayLogIndexFromTx(tx, true)).toBe(3);
  });

  it('falls back to default selection when no PC20 leg is present', () => {
    const tx = txWith([fundsLeg]);
    expect(getSvmGatewayLogIndexFromTx(tx, true)).toBe(2);
  });

  it('a single PC20 event is selected under either mode', () => {
    const tx = txWith([PC20_EVENT_B64]);
    expect(getSvmGatewayLogIndexFromTx(tx)).toBe(2);
    expect(getSvmGatewayLogIndexFromTx(tx, true)).toBe(2);
  });
});
