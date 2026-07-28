import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  derivePC20Mint,
  derivePC20State,
  decodePc20State,
  validatePC20Mint,
  buildPC20BurnAccounts,
  predictSvmWrapperMint,
  PC20_MINT_SEED,
  PC20_STATE_SEED,
  PC20_SELECTOR_BYTES,
  PC20_STATE_LEN,
} from '../svm';
import { InvalidPC20AddressError, PC20RegistryMismatchError } from '../errors';

const PROGRAM_ID = new PublicKey('11111111111111111111111111111112');
const PUSH_PC20 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SOURCE = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function encodeState(sourceAsset: string, mint: PublicKey, decimals = 18, bump = 255) {
  const buf = Buffer.alloc(PC20_STATE_LEN);
  buf.write('00'.repeat(8), 0, 'hex'); // discriminator
  Buffer.from(sourceAsset.slice(2), 'hex').copy(buf, 8);
  mint.toBuffer().copy(buf, 28);
  buf[60] = decimals;
  buf[61] = bump;
  return buf;
}

describe('SVM PC20 seeds', () => {
  it('pins the seeds to the program source', () => {
    // state.rs:13-15 @ push-chain-gateway-contracts pc20-3rd-iteration.
    expect(PC20_MINT_SEED.toString()).toBe('pc20_mint');
    expect(PC20_STATE_SEED.toString()).toBe('pc20_state');
    expect(PC20_SELECTOR_BYTES.toString()).toBe('PC20');
    expect(PC20_SELECTOR_BYTES.toString('hex')).toBe('50433230');
  });

  it('pins the Pc20State length', () => {
    // 8 discriminator + 20 source_asset + 32 wrapped_mint + 1 decimals + 1 bump
    expect(PC20_STATE_LEN).toBe(62);
  });
});

describe('derivePC20Mint', () => {
  it('seeds on the raw 20-byte source asset, not a padded 32-byte form', () => {
    const { mint } = derivePC20Mint(PROGRAM_ID, PUSH_PC20);

    const expected = PublicKey.findProgramAddressSync(
      [PC20_MINT_SEED, Buffer.from(PUSH_PC20.slice(2), 'hex')],
      PROGRAM_ID
    )[0];
    expect(mint.equals(expected)).toBe(true);

    // A 32-byte padded seed derives a different, valid-looking PDA that no
    // wrapper is ever minted to.
    const padded = PublicKey.findProgramAddressSync(
      [PC20_MINT_SEED, Buffer.concat([Buffer.alloc(12), Buffer.from(PUSH_PC20.slice(2), 'hex')])],
      PROGRAM_ID
    )[0];
    expect(mint.equals(padded)).toBe(false);
  });

  it('is case-insensitive on the source address', () => {
    expect(
      derivePC20Mint(PROGRAM_ID, PUSH_PC20).mint.equals(
        derivePC20Mint(PROGRAM_ID, PUSH_PC20.toUpperCase().replace('0X', '0x')).mint
      )
    ).toBe(true);
  });

  it('derives distinct mints for distinct sources', () => {
    expect(
      derivePC20Mint(PROGRAM_ID, PUSH_PC20).mint.equals(
        derivePC20Mint(PROGRAM_ID, OTHER_SOURCE).mint
      )
    ).toBe(false);
  });

  it('rejects a malformed source address', () => {
    expect(() => derivePC20Mint(PROGRAM_ID, '0xdeadbeef')).toThrow(
      InvalidPC20AddressError
    );
  });

  it('matches predictSvmWrapperMint', () => {
    expect(
      predictSvmWrapperMint(PROGRAM_ID, PUSH_PC20).equals(
        derivePC20Mint(PROGRAM_ID, PUSH_PC20).mint
      )
    ).toBe(true);
  });
});

describe('derivePC20State', () => {
  it('seeds on the mint', () => {
    const { mint } = derivePC20Mint(PROGRAM_ID, PUSH_PC20);
    const { state } = derivePC20State(PROGRAM_ID, mint);

    const expected = PublicKey.findProgramAddressSync(
      [PC20_STATE_SEED, mint.toBuffer()],
      PROGRAM_ID
    )[0];
    expect(state.equals(expected)).toBe(true);
  });
});

describe('decodePc20State', () => {
  it('decodes the account layout', () => {
    const { mint } = derivePC20Mint(PROGRAM_ID, PUSH_PC20);
    const decoded = decodePc20State(encodeState(PUSH_PC20, mint, 6, 254));

    expect(decoded.sourceAsset.toLowerCase()).toBe(PUSH_PC20);
    expect(decoded.wrappedMint.equals(mint)).toBe(true);
    expect(decoded.decimals).toBe(6);
    expect(decoded.bump).toBe(254);
  });

  it('rejects a truncated account', () => {
    expect(() => decodePc20State(Buffer.alloc(10))).toThrow(
      InvalidPC20AddressError
    );
  });
});

describe('validatePC20Mint', () => {
  const { mint } = derivePC20Mint(PROGRAM_ID, PUSH_PC20);
  const { state: statePda } = derivePC20State(PROGRAM_ID, mint);
  const state = decodePc20State(encodeState(PUSH_PC20, mint));

  it('accepts a mutually consistent mint, state, and source', () => {
    expect(() =>
      validatePC20Mint({
        programId: PROGRAM_ID,
        mint,
        state,
        statePda,
        expectedSource: PUSH_PC20 as `0x${string}`,
      })
    ).not.toThrow();
  });

  it('rejects a state PDA that does not derive from the mint', () => {
    const wrongPda = derivePC20State(
      PROGRAM_ID,
      derivePC20Mint(PROGRAM_ID, OTHER_SOURCE).mint
    ).state;

    expect(() =>
      validatePC20Mint({
        programId: PROGRAM_ID,
        mint,
        state,
        statePda: wrongPda,
        expectedSource: PUSH_PC20 as `0x${string}`,
      })
    ).toThrow(PC20RegistryMismatchError);
  });

  it('rejects a state whose wrapped_mint is a different mint', () => {
    const otherMint = derivePC20Mint(PROGRAM_ID, OTHER_SOURCE).mint;
    const mismatched = decodePc20State(encodeState(PUSH_PC20, otherMint));

    expect(() =>
      validatePC20Mint({
        programId: PROGRAM_ID,
        mint,
        state: mismatched,
        statePda,
        expectedSource: PUSH_PC20 as `0x${string}`,
      })
    ).toThrow(PC20RegistryMismatchError);
  });

  it('rejects a source that disagrees with UniversalCore', () => {
    expect(() =>
      validatePC20Mint({
        programId: PROGRAM_ID,
        mint,
        state,
        statePda,
        expectedSource: OTHER_SOURCE as `0x${string}`,
      })
    ).toThrow(PC20RegistryMismatchError);
  });

  it('rejects a mint that does not re-derive from the stored source', () => {
    // A mint copied from another deployment: its state PDA and wrapped_mint can
    // both be self-consistent while the source seed points elsewhere.
    const foreignMint = derivePC20Mint(PROGRAM_ID, OTHER_SOURCE).mint;
    const foreignPda = derivePC20State(PROGRAM_ID, foreignMint).state;
    const foreignState = decodePc20State(encodeState(PUSH_PC20, foreignMint));

    expect(() =>
      validatePC20Mint({
        programId: PROGRAM_ID,
        mint: foreignMint,
        state: foreignState,
        statePda: foreignPda,
        expectedSource: PUSH_PC20 as `0x${string}`,
      })
    ).toThrow(PC20RegistryMismatchError);
  });
});

describe('buildPC20BurnAccounts', () => {
  const { mint } = derivePC20Mint(PROGRAM_ID, PUSH_PC20);

  it('orders remaining accounts as [pc20_state, pc20_mint]', () => {
    // pc20.rs:244-245 reads remaining_accounts[0] as state, [1] as mint.
    const { remainingAccounts } = buildPC20BurnAccounts({
      programId: PROGRAM_ID,
      mint,
    });

    expect(remainingAccounts).toHaveLength(2);
    expect(remainingAccounts[0].equals(derivePC20State(PROGRAM_ID, mint).state)).toBe(true);
    expect(remainingAccounts[1].equals(mint)).toBe(true);
  });

  it('passes no gateway token account', () => {
    // The wrapper is burned via the mint authority, not escrowed in a vault.
    expect(
      buildPC20BurnAccounts({ programId: PROGRAM_ID, mint }).gatewayTokenAccount
    ).toBeNull();
  });
});
