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
  remainingAccounts: PublicKey[];
  gatewayTokenAccount: null;
} {
  const { state } = derivePC20State(params.programId, params.mint);
  return {
    remainingAccounts: [state, params.mint],
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
