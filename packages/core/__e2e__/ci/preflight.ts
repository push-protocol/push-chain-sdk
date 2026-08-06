#!/usr/bin/env ts-node
/**
 * Pre-flight fund gate for the CI e2e suite.
 *
 * Usage (from packages/core):
 *   npx ts-node --transpile-only __e2e__/ci/preflight.ts [--group <name>] [--dry-run]
 *
 * What it does, in order:
 *   1. Requires the three master keys. Missing key → exit 1, nothing read.
 *   2. Sums `needs` for the selected scenarios and applies headroom + gas reserves.
 *   3. Reads every balance: the three masters, the shared UEA on Push Chain, and the
 *      UEA's CEA PDA on Solana Devnet.
 *   4. Prints a need-vs-have table. **If a master is short, it exits 1 and broadcasts
 *      nothing** — this is the "don't proceed" gate.
 *   5. If the masters can cover it, tops the UEA and the SVM CEA PDA up to target and
 *      re-reads them. `--dry-run` stops after step 4.
 *
 * Why the two tiers: Route 1 is paid by the origin master on Sepolia/Devnet, but
 * Routes 2 and 3 are paid by the UEA on Push Chain, which only ever gets funded from
 * the Push master. See the `Asset` docblock in ./suite.ts for the full accounting.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

// Match __e2e__/shared/setup.ts: absolute path, so this works from any cwd. dotenv
// does not override variables already present, so a CI `env:` block wins.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  getAddress,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import {
  CHAIN_INFO,
  SYNTHETIC_PUSH_ERC20,
  getPushViemChain,
} from '../../src/lib/constants/chain';
import {
  deriveSvmCeaPda,
  deriveAtaPubkey,
} from '../../src/lib/orchestrator/internals/svm-rent';
import { scenariosFor, aggregateNeeds, type Asset } from './suite';

// ---------------------------------------------------------------------------
// tunables
// ---------------------------------------------------------------------------

/** Multiplier over the summed `needs` — absorbs gas spikes and retries. */
const HEADROOM = 1.25;

/** Flat reserves on top, so a run never ends with a wallet at exactly zero. */
const RESERVE: Partial<Record<Asset, string>> = {
  sepoliaEth: '0.02',
  masterPC: '2',
  solanaSOL: '0.01',
};

/**
 * Minimum PC the UEA is topped up to whenever *any* Route 2/3 scenario is selected.
 * 10 PC is the floor the gas sizer needs to avoid the dead-zone; cross-chain/forced-
 * sizer.spec.ts uses the same 10-min / 15-target convention.
 */
const UEA_PC_FLOOR = 15;

// ---------------------------------------------------------------------------
// args + env
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const DRY_RUN = process.argv.includes('--dry-run');
const group = arg('group') ?? 'all';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name} — set it in packages/core/.env or as a CI secret.`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// abis + spl encoding
// ---------------------------------------------------------------------------

const ERC20 = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Associated Token Program `CreateIdempotent` (discriminant 1) — no-op if it exists. */
function createAtaIdempotentIx(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  ata: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** SPL Token `Transfer` (discriminant 3) + u64 LE amount. */
function splTransferIx(
  source: PublicKey,
  dest: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// misc helpers
// ---------------------------------------------------------------------------

async function retry<T>(fn: () => Promise<T>, attempts = 4, delayMs = 600): Promise<T> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw err;
}

function pad(s: string, w: number, align: 'l' | 'r' | 'c' = 'l'): string {
  const fill = w - s.length;
  if (fill <= 0) return s;
  if (align === 'r') return ' '.repeat(fill) + s;
  if (align === 'c') {
    const l = Math.floor(fill / 2);
    return ' '.repeat(l) + s + ' '.repeat(fill - l);
  }
  return s + ' '.repeat(fill);
}

interface Row {
  scope: string;
  asset: string;
  need: bigint;
  have: bigint;
  decimals: number;
  /** Derived rows are topped up; master rows are the hard gate. */
  tier: 'master' | 'derived';
}

function fmt(v: bigint, decimals: number): string {
  const n = Number(formatUnits(v, decimals));
  if (n === 0) return '0';
  return n < 1 ? n.toFixed(Math.min(6, decimals)) : n.toFixed(4);
}

/**
 * Float → base units. Pinning to the token's own precision first keeps binary
 * float error (2 * 1.25 + 0.02 = 2.5200000000000005) from reaching parseUnits.
 */
function units(value: number, decimals: number): bigint {
  return parseUnits(value.toFixed(decimals), decimals);
}

function renderTable(rows: Row[]): void {
  const cells = rows.map((r) => ({
    scope: r.scope,
    asset: r.asset,
    need: fmt(r.need, r.decimals),
    have: fmt(r.have, r.decimals),
    ok: r.have >= r.need,
  }));
  const w = { scope: 5, asset: 5, need: 4, have: 4, status: 6 };
  for (const c of cells) {
    w.scope = Math.max(w.scope, c.scope.length);
    w.asset = Math.max(w.asset, c.asset.length);
    w.need = Math.max(w.need, c.need.length);
    w.have = Math.max(w.have, c.have.length);
  }
  const line = (l: string, m: string, r: string) =>
    l +
    '─'.repeat(w.scope + 2) + m +
    '─'.repeat(w.asset + 2) + m +
    '─'.repeat(w.need + 2) + m +
    '─'.repeat(w.have + 2) + m +
    '─'.repeat(w.status + 2) + r;

  console.log(line('┌', '┬', '┐'));
  console.log(
    '│ ' + pad('Scope', w.scope, 'c') +
    ' │ ' + pad('Asset', w.asset, 'c') +
    ' │ ' + pad('Need', w.need, 'c') +
    ' │ ' + pad('Have', w.have, 'c') +
    ' │ ' + pad('Status', w.status, 'c') + ' │'
  );
  console.log(line('├', '┼', '┤'));
  for (const c of cells) {
    console.log(
      '│ ' + pad(c.scope, w.scope) +
      ' │ ' + pad(c.asset, w.asset) +
      ' │ ' + pad(c.need, w.need, 'r') +
      ' │ ' + pad(c.have, w.have, 'r') +
      ' │ ' + pad(c.ok ? '✓' : '✗', w.status, 'c') + ' │'
    );
  }
  console.log(line('└', '┴', '┘'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

(async () => {
  const scenarios = scenariosFor(group);
  const raw = aggregateNeeds(scenarios);

  /** Summed need for an asset, with headroom and reserve, as a decimal string. */
  const target = (a: Asset): number => {
    const base = (raw[a] ?? 0) * HEADROOM;
    const reserve = Number(RESERVE[a] ?? '0');
    return base + (base > 0 ? reserve : 0);
  };

  const evmKey = requireEnv('EVM_PRIVATE_KEY') as Hex;
  const pushKey = requireEnv('PUSH_PRIVATE_KEY') as Hex;
  const solKeyRaw = requireEnv('SOLANA_PRIVATE_KEY');

  const evmAcc = privateKeyToAccount(evmKey);
  const pushAcc = privateKeyToAccount(pushKey);
  const solKp = (() => {
    try {
      return Keypair.fromSecretKey(bs58.decode(solKeyRaw));
    } catch {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(solKeyRaw)));
    }
  })();

  // -- clients -------------------------------------------------------------
  const sepRpcs = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC;
  const pushRpcs = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC;
  const solRpc =
    process.env['SOLANA_RPC_URL'] ?? CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0];

  const sep = createPublicClient({
    chain: sepolia,
    transport: fallback(sepRpcs.map((u) => http(u))),
  }) as PublicClient;
  const pushChainDef = getPushViemChain(CHAIN.PUSH_TESTNET_DONUT);
  if (!pushChainDef) {
    console.error('No viem chain definition for Push Donut — SDK constants changed.');
    process.exit(1);
  }
  const push = createPublicClient({
    chain: pushChainDef,
    transport: fallback(pushRpcs.map((u) => http(u))),
  }) as PublicClient;
  const pushWallet = createWalletClient({
    account: pushAcc,
    chain: pushChainDef,
    transport: http(pushRpcs[0]),
  }) as WalletClient;
  const conn = new Connection(solRpc, 'confirmed');

  // -- addresses -----------------------------------------------------------
  const uea = (
    await PushChain.utils.account.deriveExecutorAccount(
      { chain: CHAIN.ETHEREUM_SEPOLIA, address: evmAcc.address },
      { skipNetworkCheck: true }
    )
  ).address as `0x${string}`;
  const ceaPda = deriveSvmCeaPda(uea);

  const s = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];
  const usdtSepolia = getAddress(
    PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDT.address
  );
  const usdtSolMint = new PublicKey(
    PushChain.CONSTANTS.MOVEABLE.TOKEN.SOLANA_DEVNET.USDT.address
  );
  const pc20Push = process.env['PC20_PUSH_TOKEN'] as `0x${string}` | undefined;

  const masterAta = deriveAtaPubkey(solKp.publicKey, usdtSolMint);
  const ceaAta = deriveAtaPubkey(ceaPda, usdtSolMint);

  console.log('\nWallets');
  console.log(`  EVM master     (Sepolia)        ${evmAcc.address}`);
  console.log(`  Push master    (Donut)          ${pushAcc.address}`);
  console.log(`  Solana master  (Devnet)         ${solKp.publicKey.toBase58()}`);
  console.log(`  Shared UEA     (Donut)          ${uea}`);
  console.log(`  UEA CEA PDA    (Devnet)         ${ceaPda.toBase58()}`);
  console.log(
    `\nGroup "${group}" — ${scenarios.length} scenarios, headroom ×${HEADROOM}.\n`
  );

  // -- reads ---------------------------------------------------------------
  const erc20 = (token: `0x${string}`, owner: `0x${string}`, client: PublicClient) =>
    retry(
      () =>
        client.readContract({
          address: token,
          abi: ERC20,
          functionName: 'balanceOf',
          args: [owner],
        }) as Promise<bigint>
    );
  const decimalsOf = (token: `0x${string}`, client: PublicClient) =>
    retry(
      () =>
        client.readContract({
          address: token,
          abi: ERC20,
          functionName: 'decimals',
        }) as Promise<number>
    );
  const splBalance = (ata: PublicKey) =>
    retry(async () => {
      const r = await conn.getTokenAccountBalance(ata).catch(() => null);
      return BigInt(r?.value.amount ?? '0');
    });

  const [dUsdtSep, dPeth, dUsdtEth, dPsol, dUsdtSol] = await Promise.all([
    decimalsOf(usdtSepolia, sep),
    decimalsOf(s.pETH, push),
    decimalsOf(s.USDT_ETH, push),
    decimalsOf(s.pSOL, push),
    decimalsOf(s.USDT_SOL, push),
  ]);
  const dPc20 = pc20Push ? await decimalsOf(pc20Push, push) : 18;

  const [
    sepEth, sepUsdt,
    mPC, mPeth, mUsdtEth, mPsol, mUsdtSol, mPc20,
    uPC, uPeth, uUsdtEth, uPsol, uUsdtSol, uPc20,
    solBal, solUsdt, ceaSol, ceaUsdt,
  ] = await Promise.all([
    retry(() => sep.getBalance({ address: evmAcc.address })),
    erc20(usdtSepolia, evmAcc.address, sep),

    retry(() => push.getBalance({ address: pushAcc.address })),
    erc20(s.pETH, pushAcc.address, push),
    erc20(s.USDT_ETH, pushAcc.address, push),
    erc20(s.pSOL, pushAcc.address, push),
    erc20(s.USDT_SOL, pushAcc.address, push),
    pc20Push ? erc20(pc20Push, pushAcc.address, push) : Promise.resolve(BigInt(0)),

    retry(() => push.getBalance({ address: uea })),
    erc20(s.pETH, uea, push),
    erc20(s.USDT_ETH, uea, push),
    erc20(s.pSOL, uea, push),
    erc20(s.USDT_SOL, uea, push),
    pc20Push ? erc20(pc20Push, uea, push) : Promise.resolve(BigInt(0)),

    retry(() => conn.getBalance(solKp.publicKey), 5, 800).then((n) => BigInt(n)),
    splBalance(masterAta),
    retry(() => conn.getBalance(ceaPda), 5, 800).then((n) => BigInt(n)),
    splBalance(ceaAta),
  ]);

  // -- targets for the derived accounts ------------------------------------
  // If any Route 2/3 scenario is selected, hold the UEA at the gas-sizer floor.
  const needsUeaGas = target('ueaPC') > 0;
  const ueaPcTarget = needsUeaGas ? Math.max(target('ueaPC'), UEA_PC_FLOOR) : 0;

  const derivedAll: (Row & { key: string })[] = [
    { key: 'ueaPC', scope: 'UEA (Donut)', asset: 'PC', need: units(ueaPcTarget, 18), have: uPC, decimals: 18, tier: 'derived' },
    { key: 'ueaPETH', scope: 'UEA (Donut)', asset: 'pETH', need: units(target('ueaPETH'), dPeth), have: uPeth, decimals: dPeth, tier: 'derived' },
    { key: 'ueaUsdtEth', scope: 'UEA (Donut)', asset: 'pUSDT.eth', need: units(target('ueaUsdtEth'), dUsdtEth), have: uUsdtEth, decimals: dUsdtEth, tier: 'derived' },
    { key: 'ueaPSOL', scope: 'UEA (Donut)', asset: 'pSOL', need: units(target('ueaPSOL'), dPsol), have: uPsol, decimals: dPsol, tier: 'derived' },
    { key: 'ueaUsdtSol', scope: 'UEA (Donut)', asset: 'pUSDT.sol', need: units(target('ueaUsdtSol'), dUsdtSol), have: uUsdtSol, decimals: dUsdtSol, tier: 'derived' },
    { key: 'ueaPC20', scope: 'UEA (Donut)', asset: 'PC20', need: units(target('ueaPC20'), dPc20), have: uPc20, decimals: dPc20, tier: 'derived' },
    { key: 'ceaSvmSOL', scope: 'CEA PDA (Devnet)', asset: 'SOL', need: units(target('ceaSvmSOL'), 9), have: ceaSol, decimals: 9, tier: 'derived' },
    { key: 'ceaSvmUsdt', scope: 'CEA PDA (Devnet)', asset: 'USDT', need: units(target('ceaSvmUsdt'), 6), have: ceaUsdt, decimals: 6, tier: 'derived' },
  ];
  const derived = derivedAll.filter((r) => r.need > BigInt(0));

  const deficit = (key: string): bigint => {
    const r = derived.find((d) => d.key === key);
    if (!r) return BigInt(0);
    return r.have >= r.need ? BigInt(0) : r.need - r.have;
  };

  // -- master requirements = own need + whatever the derived accounts lack --
  const mastersAll: Row[] = [
    { scope: 'EVM master (Sepolia)', asset: 'ETH', need: units(target('sepoliaEth'), 18), have: sepEth, decimals: 18, tier: 'master' },
    { scope: 'EVM master (Sepolia)', asset: 'USDT', need: units(target('sepoliaUsdt'), dUsdtSep), have: sepUsdt, decimals: dUsdtSep, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'PC', need: units(target('masterPC'), 18) + deficit('ueaPC'), have: mPC, decimals: 18, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'pETH', need: units(target('masterPETH'), dPeth) + deficit('ueaPETH'), have: mPeth, decimals: dPeth, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'pUSDT.eth', need: deficit('ueaUsdtEth'), have: mUsdtEth, decimals: dUsdtEth, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'pSOL', need: deficit('ueaPSOL'), have: mPsol, decimals: dPsol, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'pUSDT.sol', need: deficit('ueaUsdtSol'), have: mUsdtSol, decimals: dUsdtSol, tier: 'master' },
    { scope: 'Push master (Donut)', asset: 'PC20', need: deficit('ueaPC20'), have: mPc20, decimals: dPc20, tier: 'master' },
    { scope: 'Solana master (Devnet)', asset: 'SOL', need: units(target('solanaSOL'), 9) + deficit('ceaSvmSOL'), have: solBal, decimals: 9, tier: 'master' },
    { scope: 'Solana master (Devnet)', asset: 'USDT', need: units(target('solanaUsdt'), 6) + deficit('ceaSvmUsdt'), have: solUsdt, decimals: 6, tier: 'master' },
  ];
  const masters = mastersAll.filter((r) => r.need > BigInt(0));

  if (masters.length === 0 && derived.length === 0) {
    console.log('No funded scenarios in this group — nothing to gate. Ready to run.');
    process.exit(0);
  }

  renderTable([...masters, ...derived]);

  if (pc20Push === undefined && scenarios.some((x) => x.group === 'pc20')) {
    console.log(
      '\nNote: PC20_PUSH_TOKEN is unset — the PC20 suites will skip themselves loudly.'
    );
  }

  // -- the gate ------------------------------------------------------------
  const short = masters.filter((r) => r.have < r.need);
  if (short.length > 0) {
    console.error(`\n${short.length} master balance(s) short — not proceeding:`);
    for (const r of short) {
      console.error(
        `  • ${r.scope} ${r.asset}: need ${fmt(r.need, r.decimals)}, have ${fmt(r.have, r.decimals)} ` +
        `(short ${fmt(r.need - r.have, r.decimals)})`
      );
    }
    console.error('\nTop up the master wallets and re-run. No transactions were sent.');
    process.exit(1);
  }

  console.log('\nAll master wallets can cover this run.');

  const toFund = derived.filter((r) => r.have < r.need);
  if (toFund.length === 0) {
    console.log('Derived accounts are already at target. Ready to run.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`\n--dry-run: skipping ${toFund.length} top-up(s):`);
    for (const r of toFund) {
      console.log(`  • ${r.scope} ${r.asset}: would send ${fmt(r.need - r.have, r.decimals)}`);
    }
    process.exit(0);
  }

  // -- top-ups -------------------------------------------------------------
  console.log(`\nTopping up ${toFund.length} derived balance(s)…`);

  for (const r of toFund) {
    const amount = r.need - r.have;
    const label = `${r.scope} ${r.asset}`;

    if (r.key === 'ueaPC') {
      const hash = await pushWallet.sendTransaction({
        account: pushAcc,
        chain: pushChainDef,
        to: uea,
        value: amount,
      });
      await push.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${label}: +${fmt(amount, r.decimals)} (${hash})`);
      continue;
    }

    const prc20: Record<string, `0x${string}` | undefined> = {
      ueaPETH: s.pETH,
      ueaUsdtEth: s.USDT_ETH,
      ueaPSOL: s.pSOL,
      ueaUsdtSol: s.USDT_SOL,
      ueaPC20: pc20Push,
    };
    const token = prc20[r.key];
    if (token) {
      const hash = await pushWallet.sendTransaction({
        account: pushAcc,
        chain: pushChainDef,
        to: token,
        data: encodeFunctionData({
          abi: ERC20,
          functionName: 'transfer',
          args: [uea, amount],
        }),
      });
      const receipt = await push.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        console.error(`  ✗ ${label}: transfer reverted (${hash})`);
        process.exit(1);
      }
      console.log(`  ✓ ${label}: +${fmt(amount, r.decimals)} (${hash})`);
      continue;
    }

    if (r.key === 'ceaSvmSOL') {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: solKp.publicKey,
          toPubkey: ceaPda,
          lamports: Number(amount),
        })
      );
      const sig = await sendAndConfirmTransaction(conn, tx, [solKp]);
      console.log(`  ✓ ${label}: +${fmt(amount, r.decimals)} (${sig})`);
      continue;
    }

    if (r.key === 'ceaSvmUsdt') {
      const tx = new Transaction()
        .add(createAtaIdempotentIx(solKp.publicKey, ceaPda, usdtSolMint, ceaAta))
        .add(splTransferIx(masterAta, ceaAta, solKp.publicKey, amount));
      const sig = await sendAndConfirmTransaction(conn, tx, [solKp]);
      console.log(`  ✓ ${label}: +${fmt(amount, r.decimals)} (${sig})`);
      continue;
    }

    console.error(`  ✗ ${label}: no funding route implemented for "${r.key}"`);
    process.exit(1);
  }

  // -- confirm -------------------------------------------------------------
  console.log('\nRe-reading derived balances…');
  const after: (Row & { key: string })[] = [];
  for (const r of derived) {
    let have: bigint;
    if (r.key === 'ueaPC') have = await retry(() => push.getBalance({ address: uea }));
    else if (r.key === 'ceaSvmSOL')
      have = BigInt(await retry(() => conn.getBalance(ceaPda), 5, 800));
    else if (r.key === 'ceaSvmUsdt') have = await splBalance(ceaAta);
    else {
      const token = { ueaPETH: s.pETH, ueaUsdtEth: s.USDT_ETH, ueaPSOL: s.pSOL, ueaUsdtSol: s.USDT_SOL, ueaPC20: pc20Push }[r.key];
      have = token ? await erc20(token, uea, push) : r.have;
    }
    after.push({ ...r, have });
  }
  renderTable(after);

  const stillShort = after.filter((r) => r.have < r.need);
  if (stillShort.length > 0) {
    console.error('\nTop-up did not land for:');
    for (const r of stillShort) console.error(`  • ${r.scope} ${r.asset}`);
    process.exit(1);
  }

  console.log('\nReady to run.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
