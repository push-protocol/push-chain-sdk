import {
  OutboundObservation,
  OutboundTxV2Codec,
} from '../../../../generated/uexecutor/v2/types';
import { Inbound } from '../../../../generated/uexecutor/v1/types';

describe('PC20 protobuf fields', () => {
  it('round-trips OutboundObservation.pc20WrapperAddress (field 6)', () => {
    const encoded = OutboundObservation.encode(
      OutboundObservation.fromPartial({
        success: true,
        txHash: '0xabc',
        pc20WrapperAddress: '0xWrapper',
      })
    ).finish();

    const decoded = OutboundObservation.decode(encoded);
    expect(decoded.pc20WrapperAddress).toBe('0xWrapper');
    expect(decoded.txHash).toBe('0xabc');
  });

  it('round-trips OutboundTx PC20 fields (22, 23)', () => {
    const encoded = OutboundTxV2Codec.encode(
      OutboundTxV2Codec.fromPartial({
        destinationChain: 'eip155:11155111',
        isPc20: true,
        pc20ContractAddress: '0xPushPC20',
        abortReason: 'none',
      })
    ).finish();

    const decoded = OutboundTxV2Codec.decode(encoded);
    expect(decoded.isPc20).toBe(true);
    expect(decoded.pc20ContractAddress).toBe('0xPushPC20');
    // Neighbouring field must not have been shifted by the additions.
    expect(decoded.abortReason).toBe('none');
    expect(decoded.destinationChain).toBe('eip155:11155111');
  });

  it('defaults PC20 fields for a non-PC20 outbound', () => {
    const decoded = OutboundTxV2Codec.decode(
      OutboundTxV2Codec.encode(
        OutboundTxV2Codec.fromPartial({ destinationChain: 'eip155:97' })
      ).finish()
    );
    expect(decoded.isPc20).toBe(false);
    expect(decoded.pc20ContractAddress).toBe('');
  });

  it('round-trips Inbound.isPc20 (field 14) alongside its neighbours', () => {
    const encoded = Inbound.encode(
      Inbound.fromPartial({
        sourceChain: 'eip155:11155111',
        logIndex: '3',
        txType: 4,
        verificationData: '0xdead',
        isCea: true,
        rawPayload: '0xbeef',
        isPc20: true,
      })
    ).finish();

    const decoded = Inbound.decode(encoded);
    expect(decoded.isPc20).toBe(true);
    // Field numbering was previously misaligned with the chain from field 7 on;
    // these assertions pin the corrected layout.
    expect(decoded.logIndex).toBe('3');
    expect(decoded.txType).toBe(4);
    expect(decoded.verificationData).toBe('0xdead');
    expect(decoded.isCea).toBe(true);
    expect(decoded.rawPayload).toBe('0xbeef');
  });
});
