/**
 * SVM (Solana) specific helper functions extracted from Orchestrator.
 */

import { PublicKey } from '@solana/web3.js';
import { bytesToHex, hexToBytes, stringToBytes, zeroAddress } from 'viem';
import SVM_GATEWAY_IDL from '../../constants/abi/universalGatewayV0.json';
import type { UniversalTxRequest } from '../orchestrator.types';

// ============================================================================
// SVM Request Builders
// ============================================================================

export function buildSvmUniversalTxRequest({
  recipient,
  token,
  amount,
  payload,
  revertRecipient,
  signatureData,
}: {
  recipient: number[];
  token: PublicKey;
  amount: bigint;
  payload: `0x${string}` | Uint8Array;
  revertRecipient: PublicKey;
  signatureData?: Uint8Array | `0x${string}`;
}) {
  const payloadBuf =
    typeof payload === 'string' && payload.startsWith('0x')
      ? (() => {
          const hex = payload.slice(2);
          if (!hex.length) return Buffer.alloc(0);
          const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
          return Buffer.from(normalized, 'hex');
        })()
      : Buffer.from(payload);

  let signatureBuf: Buffer;
  if (!signatureData) {
    signatureBuf = Buffer.alloc(0);
  } else if (
    typeof signatureData === 'string' &&
    signatureData.startsWith('0x')
  ) {
    const hex = signatureData.slice(2);
    if (!hex.length) {
      signatureBuf = Buffer.alloc(0);
    } else {
      const normalized = hex.length % 2 === 1 ? `0${hex}` : hex;
      signatureBuf = Buffer.from(normalized, 'hex');
    }
  } else {
    signatureBuf = Buffer.from(signatureData);
  }

  return {
    recipient,
    token,
    amount,
    payload: payloadBuf,
    revertRecipient,
    signatureData: signatureBuf,
  };
}

export function buildSvmUniversalTxRequestFromReq(
  req: UniversalTxRequest,
  revertRecipient: PublicKey,
  signatureDataOverride?: Uint8Array | `0x${string}`
) {
  const recipientBytes = hexToBytes(req.recipient);
  const recipient: number[] = Array.from(recipientBytes.subarray(0, 20));

  const tokenAddress = req.token as string;
  let token: PublicKey;
  if (tokenAddress === zeroAddress || tokenAddress === 'solana-native') {
    token = PublicKey.default;
  } else {
    if (!tokenAddress.startsWith('0x')) {
      throw new Error(
        'Unsupported token format for SVM UniversalTxRequest: ' + tokenAddress
      );
    }
    const token20 = hexToBytes(tokenAddress as `0x${string}`);
    const token32 = new Uint8Array(32);
    token32.set(token20, 12);
    token = new PublicKey(token32);
  }

  return buildSvmUniversalTxRequest({
    recipient,
    token,
    amount: req.amount,
    payload: req.payload,
    revertRecipient,
    signatureData: signatureDataOverride ?? req.signatureData,
  });
}

// ============================================================================
// SVM Protocol Fee
// ============================================================================

export async function getSvmProtocolFee(
  svmClient: { readContract: (args: any) => Promise<any> },
  programId: PublicKey
) {
  const [feeVaultPda] = PublicKey.findProgramAddressSync(
    [stringToBytes('fee_vault')],
    programId
  );
  try {
    const feeVault: any = await svmClient.readContract({
      abi: SVM_GATEWAY_IDL,
      address: SVM_GATEWAY_IDL.address,
      functionName: 'feeVault',
      args: [feeVaultPda.toBase58()],
    });
    const protocolFeeLamports = BigInt(
      (
        feeVault.inboundFeeLamports ??
        feeVault.inbound_fee_lamports ??
        feeVault.protocolFeeLamports ??
        feeVault.protocol_fee_lamports
      )?.toString() ?? '0'
    );
    return { feeVaultPda, protocolFeeLamports };
  } catch {
    return { feeVaultPda, protocolFeeLamports: BigInt(0) };
  }
}

// ============================================================================
// SVM Log Parsing
// ============================================================================

/** Anchor event discriminator for the SVM gateway's UniversalTxSent event */
const SVM_GATEWAY_EVENT_DISCRIMINATOR = '6c9ad829b5ea1d7c';

// ============================================================================
// ============================================================================

/**
 * Does this decoded `UniversalTx` event body carry a PC20-selector payload?
 *
 * Borsh layout after the 8-byte discriminator: sender(32) ++ recipient(20) ++
 * token(32) ++ amount(8) ++ payload_len(u32 LE) ++ payload. The gateway stamps
 * the `PC20` selector (ASCII, 0x50433230) on the front of the payload for a
 * PC20 burn, which is what distinguishes that leg from the native funds leg
 * emitted by the same transaction.
 */
function isPC20EventBody(decoded: Uint8Array): boolean {
  const PAYLOAD_LEN_OFFSET = 8 + 32 + 20 + 32 + 8;
  if (decoded.length < PAYLOAD_LEN_OFFSET + 4) return false;
  const view = new DataView(
    decoded.buffer,
    decoded.byteOffset,
    decoded.byteLength
  );
  const payloadLen = view.getUint32(PAYLOAD_LEN_OFFSET, true);
  const start = PAYLOAD_LEN_OFFSET + 4;
  if (payloadLen < 4 || decoded.length < start + 4) return false;
  return (
    decoded[start] === 0x50 &&
    decoded[start + 1] === 0x43 &&
    decoded[start + 2] === 0x32 &&
    decoded[start + 3] === 0x30
  );
}

/**
 * Locate the gateway event whose UTX the caller should track.
 *
 * Default: the second gateway event when there are two (a gas leg followed by
 * the funds leg), else the last one.
 *
 * `preferPC20` inverts that for PC20 wrapper burns. Such a transaction emits
 * the PC20 burn event first and then, when native value rides along, a plain
 * funds event for the gas deposit — so the default would track the deposit
 * leg. A failure crediting that deposit (the known chain-side fee-credit bug)
 * would then be reported as the whole transfer failing, even though the tokens
 * arrived via the first event. Selection is by payload selector rather than
 * position, so it survives a change in emission order.
 */
export function getSvmGatewayLogIndexFromTx(
  txResp: any,
  preferPC20 = false
): number {
  const logs: string[] = (txResp?.meta?.logMessages || []) as string[];
  if (!Array.isArray(logs) || logs.length === 0) return 0;

  const prefix = 'Program data: ';
  let matchCount = 0;
  let lastMatchIndex = -1;
  let pc20MatchIndex = -1;

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i] || '';
    if (!log.startsWith(prefix)) continue;

    const base64Data = log.slice(prefix.length).trim();
    let decoded: Uint8Array | null = null;
    try {
      decoded = new Uint8Array(Buffer.from(base64Data, 'base64'));
    } catch {
      continue;
    }

    if (!decoded || decoded.length < 8) continue;
    const discriminatorHex = bytesToHex(decoded.slice(0, 8)).slice(2);

    if (discriminatorHex === SVM_GATEWAY_EVENT_DISCRIMINATOR) {
      matchCount++;
      lastMatchIndex = i;
      if (preferPC20 && pc20MatchIndex === -1 && isPC20EventBody(decoded)) {
        pc20MatchIndex = i;
      }
      // Default selection returns eagerly on the second event; when looking
      // for the PC20 leg the scan must continue so ordering cannot matter.
      if (!preferPC20 && matchCount === 2) return i;
    }
  }

  if (preferPC20 && pc20MatchIndex !== -1) return pc20MatchIndex;
  if (lastMatchIndex !== -1) return lastMatchIndex;
  return 0;
}
