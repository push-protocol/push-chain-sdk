import {
  getSvmFinalizeGasBudget,
  SVM_SIGNATURE_FEE_LAMPORTS,
  SVM_EXECUTED_SUB_TX_RENT_FALLBACK,
  SVM_TOKEN_ACCOUNT_RENT_FALLBACK,
  SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS,
  SVM_MINT_RENT_FALLBACK,
  SVM_PC20_STATE_RENT_FALLBACK,
} from '../../svm-rent';
import { CHAIN } from '../../../../constants/enums';
import type { OrchestratorContext } from '../../context';

// The PC20 branch returns before any RPC use, so a logging stub suffices.
const ctx = { printTraces: false } as unknown as OrchestratorContext;

const base = {
  ctx,
  ueaAddress: '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D' as const,
  targetChain: CHAIN.SOLANA_DEVNET,
  splMintBase58: undefined,
  burnAmount: BigInt(0),
};

describe('SVM PC20 finalize rent floor', () => {
  // settle_pc20_finalize_gas (pc20.rs) requires gas_fee ≥ signature fee +
  // ExecutedSubTx rent + CEA ATA rent (+ mint & Pc20State rent on a first
  // export). The on-chain quote knows nothing about Solana rent, so without
  // this floor a first export reverts InsufficientGasBudget on the destination
  // — after the source token is locked.

  it('covers mint and state rent on a first export', async () => {
    const budget = await getSvmFinalizeGasBudget({
      ...base,
      pc20: { isFirstExport: true },
    });
    expect(budget).toBe(
      SVM_SIGNATURE_FEE_LAMPORTS +
        SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
        SVM_TOKEN_ACCOUNT_RENT_FALLBACK +
        SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS +
        SVM_MINT_RENT_FALLBACK +
        SVM_PC20_STATE_RENT_FALLBACK
    );
    // The raw on-chain quote for solana came back ~1.92M lamports; the floor
    // must exceed it or the bump never triggers and settlement reverts.
    expect(budget).toBeGreaterThan(BigInt(1_920_000));
  });

  it('drops deployment rents on a repeat export but keeps the ATA', async () => {
    const budget = await getSvmFinalizeGasBudget({
      ...base,
      pc20: { isFirstExport: false },
    });
    expect(budget).toBe(
      SVM_SIGNATURE_FEE_LAMPORTS +
        SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
        SVM_TOKEN_ACCOUNT_RENT_FALLBACK +
        SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS
    );
  });

  it('pins the rent constants to Solana protocol values', () => {
    // (128 + dataLen) * 3480 lamports/byte-year * 2 years.
    expect(SVM_MINT_RENT_FALLBACK).toBe(BigInt((128 + 82) * 3480 * 2));
    expect(SVM_PC20_STATE_RENT_FALLBACK).toBe(BigInt((128 + 62) * 3480 * 2));
  });
});
