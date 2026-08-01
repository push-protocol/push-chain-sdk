/**
 * Solana PC20 support.
 *
 * Derived directly from the program source at
 * `push-chain-gateway-contracts@pc20-3rd-iteration`:
 *   `contracts/svm-gateway/programs/universal-gateway/src/state.rs`
 *   `contracts/svm-gateway/programs/universal-gateway/src/instructions/pc20.rs`
 *
 * No built IDL artifact exists in that repo yet, so the PDA seeds and the
 * `Pc20State` layout are mirrored here rather than read from an IDL. Both are
 * pinned by unit test against the constants below; if the program changes them,
 * the tests must be updated deliberately rather than silently drifting.
 *
 * Relevant program facts, and why each matters to the SDK:
 *
 *   - `pc20_mint = PDA([b"pc20_mint", source_asset_20], program_id)` where
 *     `source_asset` is the **20-byte** Push-native address, not a 32-byte
 *     padded one. Getting this wrong yields a valid-looking but wrong mint.
 *   - `pc20_state = PDA([b"pc20_state", pc20_mint], program_id)`.
 *   - An inbound burn passes `remaining_accounts = [pc20_state, pc20_mint]`, in
 *     that order (`pc20.rs:244-245` reads index 0 then 1).
 *   - An inbound burn passes NO gateway token vault — the wrapper is burned,
 *     not escrowed.
 */

import { PublicKey } from '@solana/web3.js';
import { getAddress, type Hex } from 'viem';
import { Buffer } from 'buffer';
import { CHAIN } from '../../../constants/enums';
import { InvalidPC20AddressError, PC20RegistryMismatchError } from './errors';

/** `state.rs:13` — `pub const PC20_MINT_SEED: &[u8] = b"pc20_mint";` */
export const PC20_MINT_SEED = Buffer.from('pc20_mint');
/** `state.rs:14` — `pub const PC20_STATE_SEED: &[u8] = b"pc20_state";` */
export const PC20_STATE_SEED = Buffer.from('pc20_state');
/** `state.rs:15` — `pub const PC20_SELECTOR: [u8; 4] = *b"PC20";` */
export const PC20_SELECTOR_BYTES = Buffer.from('PC20');

/**
 * `Pc20State` account layout (`state.rs:125-134`):
 *
 *     discriminator [8]
 *     source_asset  [20]   // Push-native EVM address, unpadded
 *     wrapped_mint  [32]
 *     decimals      [1]
 *     bump          [1]
 */
export const PC20_STATE_LEN = 8 + 20 + 32 + 1 + 1;

export type Pc20State = {
  /** Push-native PC20 address, checksummed. */
  sourceAsset: `0x${string}`;
  wrappedMint: PublicKey;
  decimals: number;
  bump: number;
};

/**
 * Derive the wrapper mint for a Push-native PC20.
 *
 * The seed is the raw 20 bytes of the EVM address. A 32-byte left-padded form —
 * the shape UniversalCore stores for EVM identities — would derive a different,
 * entirely valid-looking PDA that no wrapper is ever minted to.
 */
export function derivePC20Mint(
  programId: PublicKey,
  pushPC20Address: string
): { mint: PublicKey; bump: number } {
  const sourceAsset = toSourceAssetBytes(pushPC20Address);
  const [mint, bump] = PublicKey.findProgramAddressSync(
    [PC20_MINT_SEED, sourceAsset],
    programId
  );
  return { mint, bump };
}

/** Derive the `Pc20State` PDA for a wrapper mint. */
export function derivePC20State(
  programId: PublicKey,
  mint: PublicKey
): { state: PublicKey; bump: number } {
  const [state, bump] = PublicKey.findProgramAddressSync(
    [PC20_STATE_SEED, mint.toBuffer()],
    programId
  );
  return { state, bump };
}

/** Decode a `Pc20State` account. */
export function decodePc20State(data: Uint8Array): Pc20State {
  if (data.length < PC20_STATE_LEN) {
    throw new InvalidPC20AddressError(
      `Pc20State account is ${data.length} bytes; expected at least ${PC20_STATE_LEN}.`,
      { chain: String(CHAIN.SOLANA_DEVNET) }
    );
  }
  const buf = Buffer.from(data);
  const sourceAsset = `0x${buf.subarray(8, 28).toString('hex')}` as Hex;
  const wrappedMint = new PublicKey(buf.subarray(28, 60));
  return {
    sourceAsset: getAddress(sourceAsset) as `0x${string}`,
    wrappedMint,
    decimals: buf[60],
    bump: buf[61],
  };
}

/**
 * Validate a supplied Solana PC20 mint against the program's own derivation and
 * stored state.
 *
 * Three independent checks, all required — any one alone can be satisfied by a
 * mint that is not the canonical wrapper:
 *   1. the state PDA derives from the supplied mint;
 *   2. the state's `wrapped_mint` equals the supplied mint;
 *   3. re-deriving the mint from the state's `source_asset` reproduces it.
 *
 * Together they mean the mint, its state, and the Push source are mutually
 * consistent — which is exactly what stops a mint copied from another
 * deployment from passing.
 */
export function validatePC20Mint(params: {
  programId: PublicKey;
  mint: PublicKey;
  state: Pc20State;
  statePda: PublicKey;
  /** Push source UniversalCore returned for this wrapper. */
  expectedSource: `0x${string}`;
}): void {
  const { programId, mint, state, statePda, expectedSource } = params;

  const { state: derivedState } = derivePC20State(programId, mint);
  if (!derivedState.equals(statePda)) {
    throw new PC20RegistryMismatchError({
      address: mint.toBase58(),
      hint: `pc20_state PDA does not derive from this mint (expected ${derivedState.toBase58()}).`,
    });
  }

  if (!state.wrappedMint.equals(mint)) {
    throw new PC20RegistryMismatchError({
      address: mint.toBase58(),
      hint: `Pc20State.wrapped_mint is ${state.wrappedMint.toBase58()}, not the supplied mint.`,
    });
  }

  const { mint: derivedMint } = derivePC20Mint(programId, state.sourceAsset);
  if (!derivedMint.equals(mint)) {
    throw new PC20RegistryMismatchError({
      address: mint.toBase58(),
      hint: `Re-deriving from Pc20State.source_asset yields ${derivedMint.toBase58()}.`,
    });
  }

  if (getAddress(state.sourceAsset) !== getAddress(expectedSource)) {
    throw new PC20RegistryMismatchError({
      address: mint.toBase58(),
      hint:
        `Pc20State.source_asset (${state.sourceAsset}) does not match the Push ` +
        `source UniversalCore returned (${expectedSource}).`,
    });
  }
}

/**
 * Accounts a Solana PC20 burn adds to the generic `send_universal_tx`
 * instruction.
 *
 * Order is load-bearing: the program reads `remaining_accounts[0]` as the state
 * and `[1]` as the mint (`pc20.rs:244-245`).
 *
 * `gatewayTokenAccount` is deliberately `null`. A PC20 inbound burns the
 * wrapper via the mint authority rather than escrowing it in a gateway vault,
 * so passing a vault here would be both unused and misleading.
 */
export function buildPC20BurnAccounts(params: {
  programId: PublicKey;
  mint: PublicKey;
}): {
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  gatewayTokenAccount: null;
} {
  const { state } = derivePC20State(params.programId, params.mint);
  return {
    // Flags per route_pc20_universal_tx (deposit.rs): the state is read-only,
    // the mint must be writable (it is burned against), and neither may sign —
    // the program rejects any deviation, so these are load-bearing.
    remainingAccounts: [
      { pubkey: state, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: true },
    ],
    gatewayTokenAccount: null,
  };
}

/**
 * Predicted destination mint for a first Push-to-Solana export.
 *
 * The SVM counterpart of the EVM `computeWrapperAddress` call. Unlike EVM,
 * where the factory computes the address on chain, the mint is a pure PDA — so
 * deriving it locally cannot drift, provided the seeds above stay in sync with
 * the program.
 */
export function predictSvmWrapperMint(
  programId: PublicKey,
  pushPC20Address: string
): PublicKey {
  return derivePC20Mint(programId, pushPC20Address).mint;
}

/**
 * Delivery instruction for a repeat export: SPL `TransferChecked` moving the
 * freshly minted wrapper from the CEA ATA to the recipient's ATA.
 *
 * Settlement (`pc20.rs` id=5) mints into the CEA ATA and then CPIs exactly one
 * instruction from the userData, signed by the CEA PDA — so delivery IS this
 * one transfer. The signer flag is not encoded: `invoke_signed_gateway_instruction`
 * marks whichever account equals the CEA authority as the signer.
 *
 * Only valid when the recipient ATA already exists — SPL transfers do not
 * create destination accounts, and a failed CPI fails the whole settlement
 * with the source already locked. Callers must verify existence first; on a
 * first export the ATA cannot exist (its mint doesn't yet), so this is
 * strictly a repeat-export tool.
 */
export function buildPC20SvmDeliveryFields(params: {
  mint: PublicKey;
  ceaAta: PublicKey;
  recipientAta: PublicKey;
  ceaAuthority: PublicKey;
  amount: bigint;
  decimals: number;
}): {
  targetProgram: `0x${string}`;
  accounts: Array<{ pubkey: `0x${string}`; isWritable: boolean }>;
  ixData: Uint8Array;
  instructionId: 2;
} {
  // SPL Token TransferChecked: index 12, data = u8 || u64 LE amount || u8 decimals.
  const ixData = new Uint8Array(10);
  ixData[0] = 12;
  new DataView(ixData.buffer).setBigUint64(1, params.amount, true);
  ixData[9] = params.decimals;

  const hex = (k: PublicKey): `0x${string}` =>
    `0x${Buffer.from(k.toBytes()).toString('hex')}` as `0x${string}`;

  return {
    targetProgram: hex(SPL_TOKEN_PROGRAM_ID),
    accounts: [
      { pubkey: hex(params.ceaAta), isWritable: true }, // source
      { pubkey: hex(params.mint), isWritable: false }, // mint (checked)
      { pubkey: hex(params.recipientAta), isWritable: true }, // destination
      { pubkey: hex(params.ceaAuthority), isWritable: false }, // owner → CPI signer
    ],
    ixData,
    instructionId: 2,
  };
}

/** SPL Token program. */
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);


/**
 * R3 (CEA → Push) burn payload: the outbound's execute-payload making the CEA
 * self-call `send_universal_tx` to burn wrapper tokens it holds.
 *
 * The finalize dispatcher detects this shape (`execute.rs:511`:
 * target == gateway && `is_pc20_burn_ix`) and routes to
 * `route_pc20_burn_from_finalize_cea`, which enforces:
 *   - ix_data = discriminator("global:send_universal_tx") || Borsh
 *     `SendUniversalTxIxArgs { req, native_amount }` with native_amount == 0;
 *   - `req.recipient == push_account` — the unlocked token goes to the CEA's
 *     bound UEA on Push, nowhere else (forwarding happens via `req.payload`);
 *   - payload accounts exactly `[pc20_state ro, pc20_mint w, cea_ata w,
 *     token_program ro]` (`parse_pc20_cea_burn_accounts`).
 *
 * The revert recipient is the CEA PDA: a failed inbound re-mints the wrapper
 * back to the CEA (`revert.rs` PC20 branch), restoring the pre-burn state.
 */
export function buildPC20SvmCeaBurnPayload(params: {
  gatewayProgram: PublicKey;
  mint: PublicKey;
  ceaAuthority: PublicKey;
  ceaAta: PublicKey;
  /** 20-byte UEA (the CEA's push_account) — program-enforced recipient. */
  ueaAddress: `0x${string}`;
  amount: bigint;
  /** Push-side UniversalPayload bytes executed after the unlock (may be empty). */
  pushPayload: Uint8Array;
}): {
  targetProgram: `0x${string}`;
  accounts: Array<{ pubkey: `0x${string}`; isWritable: boolean }>;
  ixData: Uint8Array;
  instructionId: 2;
} {
  const { state } = derivePC20State(params.gatewayProgram, params.mint);

  // Anchor discriminator: first 8 bytes of SHA-256("global:send_universal_tx").
  const discriminator = sha256(
    new TextEncoder().encode('global:send_universal_tx')
  ).subarray(0, 8);

  const recipient = Buffer.from(params.ueaAddress.slice(2), 'hex');
  if (recipient.length !== 20) {
    throw new InvalidPC20AddressError('UEA must be a 20-byte address.', {
      address: params.ueaAddress,
    });
  }

  // Borsh SendUniversalTxIxArgs { req: UniversalTxRequest, native_amount: u64 }
  // req: recipient [u8;20] || token [32] || amount u64 LE || payload Vec<u8>
  //      || revert_recipient [32] || signature_data Vec<u8>   (state.rs:67)
  const payloadLen = params.pushPayload.length;
  const ixData = new Uint8Array(8 + 20 + 32 + 8 + 4 + payloadLen + 32 + 4 + 8);
  const view = new DataView(ixData.buffer);
  let o = 0;
  ixData.set(discriminator, o); o += 8;
  ixData.set(recipient, o); o += 20;
  ixData.set(params.mint.toBytes(), o); o += 32;
  view.setBigUint64(o, params.amount, true); o += 8;
  view.setUint32(o, payloadLen, true); o += 4; // Borsh Vec<u8>: u32 LE length
  ixData.set(params.pushPayload, o); o += payloadLen;
  // Revert re-mints to the CEA, restoring pre-burn state.
  ixData.set(params.ceaAuthority.toBytes(), o); o += 32;
  view.setUint32(o, 0, true); o += 4; // signature_data: empty Vec<u8>
  view.setBigUint64(o, BigInt(0), true); // native_amount: must be 0

  const hex = (k: PublicKey): `0x${string}` =>
    `0x${Buffer.from(k.toBytes()).toString('hex')}` as `0x${string}`;

  return {
    targetProgram: hex(params.gatewayProgram),
    accounts: [
      { pubkey: hex(state), isWritable: false },
      { pubkey: hex(params.mint), isWritable: true },
      { pubkey: hex(params.ceaAta), isWritable: true },
      { pubkey: hex(SPL_TOKEN_PROGRAM_ID), isWritable: false },
    ],
    ixData,
    instructionId: 2,
  };
}

/** Minimal sha256 over bytes, returned as bytes. */
function sha256(data: Uint8Array): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(data).digest();
}

/** Normalize a Push-native EVM address into the 20 raw bytes used as a seed. */
function toSourceAssetBytes(address: string): Buffer {
  let checksummed: string;
  try {
    checksummed = getAddress(address);
  } catch {
    throw new InvalidPC20AddressError(
      'Push-native PC20 address is not a valid 20-byte EVM address.',
      { address }
    );
  }
  return Buffer.from(checksummed.slice(2), 'hex');
}
