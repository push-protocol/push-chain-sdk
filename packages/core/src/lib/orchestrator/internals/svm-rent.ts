/**
 * SVM finalize gas-budget helpers.
 *
 * The gateway program (svm-gateway) computes per-tx fees with a conditional
 * rent for first-time SPL transfers — see `calculateSplExecuteFees` in
 * `push-chain-gateway-contracts/contracts/svm-gateway/tests/helpers/test-utils.ts`:
 *
 *   const ataExists = await ceaAtaExists(connection, ceaAta);
 *   const ceaAtaRent = ataExists ? 0n : BigInt(getMinimumBalanceForRentExemption(165));
 *   gasFee = signatureFee + executedTxRent + ceaAtaRent + COMPUTE_BUFFER;
 *
 * The gateway's on-chain `getOutboundTxGasAndFees` quote does NOT factor in
 * the ATA rent today, so the SDK has to bump `effectiveGasLimit` itself
 * before building the outbound request. Native-SOL outbounds still need the
 * same base finalize budget plus compute buffer.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { OrchestratorContext } from './context';
import { printLog } from './context';
import type { CHAIN as ChainType } from '../../constants/enums';
import { CHAIN_INFO } from '../../constants/chain';
import { queryOutboundGasFee } from './gas-calculator';

// ---------------------------------------------------------------------------
// Constants — mirror gateway test-utils.ts. These are SOL protocol values;
// they only change if Solana itself adjusts rent rates (effectively never).
// ---------------------------------------------------------------------------

/** Base Solana fee per relayer signature, mirrored from SVM gateway execute.rs. */
export const SVM_SIGNATURE_FEE_LAMPORTS = BigInt(5_000);

/** Operational buffer used by SVM gateway tests for tx fees / compute. */
export const SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS = BigInt(100_000);

/** Devnet/mainnet rent-exempt minimum for ExecutedSubTx::LEN = 8 bytes. */
export const SVM_EXECUTED_SUB_TX_RENT_FALLBACK = BigInt(946_560);

/** Devnet/mainnet rent-exempt minimum for a 165-byte SPL token account. */
export const SVM_TOKEN_ACCOUNT_RENT_FALLBACK = BigInt(2_039_280);

/** Rent-exempt minimum for an 82-byte SPL mint — created on a first PC20 export. */
export const SVM_MINT_RENT_FALLBACK = BigInt(1_461_600);

/** Rent-exempt minimum for the 62-byte Pc20State PDA (state.rs: 8+20+32+1+1). */
export const SVM_PC20_STATE_RENT_FALLBACK = BigInt(1_322_400);

/** Back-compat export for older tests/callers: ATA rent + base finalization overhead. */
export const CEA_ATA_RENT_LAMPORTS_BUMP =
  SVM_SIGNATURE_FEE_LAMPORTS +
  SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
  SVM_TOKEN_ACCOUNT_RENT_FALLBACK +
  SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;

/** SVM gateway program ID (matches CHAIN_INFO[SOLANA_DEVNET].lockerContract). */
const SVM_GATEWAY_PROGRAM = new PublicKey(
  'CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS'
);

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

const SVM_RENT_RPC_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// PDA derivations
// ---------------------------------------------------------------------------

/** Derive CEA PDA from a 20-byte EVM address. Seeds: ["push_identity", evmBytes]. */
export function deriveSvmCeaPda(evmAddress: `0x${string}`): PublicKey {
  const senderBytes = Buffer.from(evmAddress.slice(2), 'hex');
  const [ceaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), senderBytes],
    SVM_GATEWAY_PROGRAM
  );
  return ceaPda;
}

/** Derive a standard SPL Associated Token Account address. */
export function deriveAtaPubkey(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// ---------------------------------------------------------------------------
// Public helper
// ---------------------------------------------------------------------------

export interface MaybeBumpInput {
  ctx: OrchestratorContext;
  ueaAddress: `0x${string}`;
  targetChain: ChainType;
  /** SPL mint as base58 (from MoveableToken.address for SVM tokens). undefined ⇒ no SPL. */
  splMintBase58: string | undefined;
  /** Burn amount in token units. 0 ⇒ no SPL transferFrom ⇒ no ATA needed. */
  burnAmount: bigint;
  effectiveGasLimit: bigint;
}

export interface SvmFinalizeGasBudgetInput {
  ctx: OrchestratorContext;
  ueaAddress: `0x${string}`;
  targetChain: ChainType;
  /** SPL mint as base58. undefined means native SOL / no SPL staging. */
  splMintBase58: string | undefined;
  /** Burn amount in token units. 0 means no SPL staging. */
  burnAmount: bigint;
  /** PC20 export: use the id=5 finalize rent profile instead of the SPL one. */
  pc20?: { isFirstExport: boolean };
}

function getRpcUrl(
  ctx: OrchestratorContext,
  targetChain: ChainType
): string | undefined {
  return (
    ctx.rpcUrls?.[targetChain]?.[0] ??
    CHAIN_INFO[targetChain]?.defaultRPC?.[0]
  );
}

function isAccountInitialized(
  info: { data: Buffer | Uint8Array } | null
): boolean {
  return info !== null && info.data.length > 0;
}

async function withSvmRentRpcTimeout<T>(
  promise: Promise<T>,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out after ${SVM_RENT_RPC_TIMEOUT_MS}ms`
              )
            ),
          SVM_RENT_RPC_TIMEOUT_MS
        );
        (timer as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function gasLimitForSvmGasFeeBudget(
  gasFeeBudget: bigint,
  gasPrice: bigint
): bigint {
  if (gasPrice <= BigInt(0)) {
    throw new Error(
      `Cannot derive SVM gasLimit from gasPrice=${gasPrice.toString()}`
    );
  }
  return (gasFeeBudget + gasPrice - BigInt(1)) / gasPrice;
}

type OutboundGasQuote = Awaited<ReturnType<typeof queryOutboundGasFee>>;

function resolveSvmGasLimitUsed<T extends OutboundGasQuote>(quote: T): T {
  if (
    quote.gasLimitUsed > BigInt(0) ||
    quote.gasFee <= BigInt(0) ||
    quote.gasPrice <= BigInt(0)
  ) {
    return quote;
  }

  return {
    ...quote,
    gasLimitUsed: gasLimitForSvmGasFeeBudget(quote.gasFee, quote.gasPrice),
  };
}

export async function ensureSvmFinalizeGasBudgetQuote({
  ctx,
  ueaAddress,
  targetChain,
  prc20Token,
  quote,
  splMintBase58,
  burnAmount,
  pathTag,
  pc20,
  requoteFn,
}: {
  ctx: OrchestratorContext;
  ueaAddress: `0x${string}`;
  targetChain: ChainType;
  prc20Token: `0x${string}`;
  quote: OutboundGasQuote;
  splMintBase58: string | undefined;
  burnAmount: bigint;
  pathTag: string;
  /** PC20 export: switches the floor to the id=5 rent profile. */
  pc20?: { isFirstExport: boolean };
  /**
   * Re-quote function for the bump path. PC20 exports MUST pass one backed by
   * getPC20ExportGasAndFees — the default getOutboundTxGasAndFees reverts for a
   * PC20 token, which has no PRC20 config.
   */
  requoteFn?: (gasLimit: bigint) => Promise<OutboundGasQuote>;
}): Promise<OutboundGasQuote> {
  const minGasFee = await getSvmFinalizeGasBudget({
    ctx,
    ueaAddress,
    targetChain,
    splMintBase58,
    burnAmount,
    pc20,
  });

  if (quote.gasFee >= minGasFee) {
    const resolvedQuote = resolveSvmGasLimitUsed(quote);
    printLog(
      ctx,
      `${pathTag} — SVM finalize gas budget ok: gasFee=${resolvedQuote.gasFee.toString()}, ` +
        `minimum=${minGasFee.toString()}, gasLimit=${resolvedQuote.gasLimitUsed.toString()}`
    );
    return resolvedQuote;
  }

  const bumpedGasLimit = gasLimitForSvmGasFeeBudget(
    minGasFee,
    quote.gasPrice
  );
  printLog(
    ctx,
    `${pathTag} — bumping SVM gasLimit ${quote.gasLimitUsed.toString()} → ${bumpedGasLimit.toString()}; ` +
      `gasFee=${quote.gasFee.toString()} below finalize minimum=${minGasFee.toString()}`
  );

  const bumpedQuote = requoteFn
    ? await requoteFn(bumpedGasLimit)
    : await queryOutboundGasFee(ctx, prc20Token, bumpedGasLimit, targetChain);
  if (bumpedQuote.gasFee < minGasFee) {
    printLog(
      ctx,
      `${pathTag} — WARNING: bumped SVM gasFee=${bumpedQuote.gasFee.toString()} ` +
        `still below finalize minimum=${minGasFee.toString()}`
    );
  }
  return resolveSvmGasLimitUsed(bumpedQuote);
}

/**
 * Returns the minimum SVM `gas_fee` budget in lamports for the gateway
 * finalize instruction, including a small compute buffer. If RPC is not
 * available, falls back to Solana protocol rent constants.
 */
export async function getSvmFinalizeGasBudget(
  input: SvmFinalizeGasBudgetInput
): Promise<bigint> {
  const { ctx, ueaAddress, targetChain, splMintBase58, burnAmount, pc20 } = input;
  const needsSplAta = Boolean(splMintBase58) && burnAmount > BigInt(0);

  // PC20 export finalize (id=5) has its own rent profile — settle_pc20_finalize_gas
  // (pc20.rs) requires gas_fee to cover, beyond the base costs:
  //   - CEA ATA rent for the *wrapper mint* (created at settlement);
  //   - on a first export, the mint account (82B) and Pc20State PDA (62B) rents.
  // The on-chain quote does not know about Solana rent, so without this floor a
  // first export reverts InsufficientGasBudget on the destination — after the
  // source token is locked. Fallback constants are used rather than RPC reads:
  // the mint does not exist yet on a first export, so there is nothing to query,
  // and rent-exempt minimums are Solana protocol values that effectively never
  // change.
  if (pc20) {
    let budget =
      SVM_SIGNATURE_FEE_LAMPORTS +
      SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
      SVM_TOKEN_ACCOUNT_RENT_FALLBACK + // CEA ATA for the wrapper mint
      SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;
    if (pc20.isFirstExport) {
      budget += SVM_MINT_RENT_FALLBACK + SVM_PC20_STATE_RENT_FALLBACK;
    }
    printLog(
      ctx,
      `getSvmFinalizeGasBudget — PC20 budget=${budget.toString()} ` +
        `(isFirstExport=${pc20.isFirstExport})`
    );
    return budget;
  }
  const rpcUrl = getRpcUrl(ctx, targetChain);

  let executedTxRent = SVM_EXECUTED_SUB_TX_RENT_FALLBACK;
  let ataRent = BigInt(0);

  if (!needsSplAta) {
    const budget =
      SVM_SIGNATURE_FEE_LAMPORTS +
      executedTxRent +
      ataRent +
      SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;
    printLog(
      ctx,
      `getSvmFinalizeGasBudget — no SPL ATA needed for ${targetChain}; ` +
        `using fallback base budget ${budget.toString()}`
    );
    return budget;
  }

  if (!rpcUrl) {
    ataRent = SVM_TOKEN_ACCOUNT_RENT_FALLBACK;
    printLog(
      ctx,
      `getSvmFinalizeGasBudget — no Solana RPC URL for ${targetChain}; ` +
        `using fallback budget ${(
          SVM_SIGNATURE_FEE_LAMPORTS +
          executedTxRent +
          ataRent +
          SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS
        ).toString()}`
    );
    return (
      SVM_SIGNATURE_FEE_LAMPORTS +
      executedTxRent +
      ataRent +
      SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS
    );
  }

  try {
    const conn = new Connection(rpcUrl, 'confirmed');
    executedTxRent = BigInt(
      await withSvmRentRpcTimeout(
        conn.getMinimumBalanceForRentExemption(8),
        'getMinimumBalanceForRentExemption(8)'
      )
    );

    if (needsSplAta && splMintBase58) {
      const ceaPda = deriveSvmCeaPda(ueaAddress);
      const splMint = new PublicKey(splMintBase58);
      const ceaAta = deriveAtaPubkey(ceaPda, splMint);
      const info = await withSvmRentRpcTimeout(
        conn.getAccountInfo(ceaAta),
        `getAccountInfo(${ceaAta.toBase58()})`
      );
      if (!isAccountInitialized(info)) {
        ataRent = BigInt(
          await withSvmRentRpcTimeout(
            conn.getMinimumBalanceForRentExemption(165),
            'getMinimumBalanceForRentExemption(165)'
          )
        );
        printLog(
          ctx,
          `getSvmFinalizeGasBudget — CEA ATA ${ceaAta.toBase58()} not deployed on ${targetChain}; ` +
            `including ${ataRent.toString()} lamports ATA rent`
        );
      } else {
        printLog(
          ctx,
          `getSvmFinalizeGasBudget — CEA ATA ${ceaAta.toBase58()} already deployed on ${targetChain}; no ATA rent`
        );
      }
    }
  } catch (err) {
    ataRent = SVM_TOKEN_ACCOUNT_RENT_FALLBACK;
    printLog(
      ctx,
      `getSvmFinalizeGasBudget — RPC error on ${targetChain}: ` +
        `${err instanceof Error ? err.message : String(err)}; using fallback rents`
    );
  }

  const budget =
    SVM_SIGNATURE_FEE_LAMPORTS +
    executedTxRent +
    ataRent +
    SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;
  printLog(
    ctx,
    `getSvmFinalizeGasBudget — budget=${budget.toString()} ` +
      `(signature=${SVM_SIGNATURE_FEE_LAMPORTS}, executedTxRent=${executedTxRent}, ataRent=${ataRent}, ` +
      `computeBuffer=${SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS})`
  );
  return budget;
}

/**
 * Returns the (possibly bumped) effectiveGasLimit. Logs the decision via
 * printLog. On any RPC failure or invalid input, logs a warning and returns
 * the input unchanged — better to risk one underflow than to block all SPL
 * outbounds on RPC flake; pre-flight will surface insufficient gas anyway.
 */
export async function maybeBumpForCeaAtaRent(
  input: MaybeBumpInput
): Promise<bigint> {
  const {
    ctx,
    ueaAddress,
    targetChain,
    splMintBase58,
    burnAmount,
    effectiveGasLimit,
  } = input;

  // Only applies to SPL outbounds. Native SOL outbounds use the gateway's
  // calculateSolExecuteFees which has no ATA conditional.
  if (!splMintBase58 || burnAmount === BigInt(0)) {
    return effectiveGasLimit;
  }

  const rpcUrl = getRpcUrl(ctx, targetChain);
  if (!rpcUrl) {
    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — no Solana RPC URL for ${targetChain}; skipping rent bump`
    );
    return effectiveGasLimit;
  }

  try {
    const ceaPda = deriveSvmCeaPda(ueaAddress);
    const splMint = new PublicKey(splMintBase58);
    const ceaAta = deriveAtaPubkey(ceaPda, splMint);
    const conn = new Connection(rpcUrl, 'confirmed');
    const info = await withSvmRentRpcTimeout(
      conn.getAccountInfo(ceaAta),
      `getAccountInfo(${ceaAta.toBase58()})`
    );
    const ataExists = info !== null && info.data.length > 0;

    if (!ataExists) {
      const bumped = effectiveGasLimit + CEA_ATA_RENT_LAMPORTS_BUMP;
      printLog(
        ctx,
        `maybeBumpForCeaAtaRent — CEA ATA ${ceaAta.toBase58()} not deployed on ${targetChain}; ` +
          `bumping effectiveGasLimit ${effectiveGasLimit} → ${bumped} ` +
          `(+${CEA_ATA_RENT_LAMPORTS_BUMP} lamports for ATA rent + exec rent + compute buffer)`
      );
      return bumped;
    }

    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — CEA ATA ${ceaAta.toBase58()} already deployed on ${targetChain}; no rent bump`
    );
    return effectiveGasLimit;
  } catch (err) {
    printLog(
      ctx,
      `maybeBumpForCeaAtaRent — RPC error querying CEA ATA on ${targetChain}: ` +
        `${err instanceof Error ? err.message : String(err)}; proceeding without bump`
    );
    return effectiveGasLimit;
  }
}
