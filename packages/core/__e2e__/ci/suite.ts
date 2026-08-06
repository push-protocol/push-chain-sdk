/**
 * CI scenario manifest — the curated subset of `__e2e__` that runs in GitHub Actions.
 *
 * The full suite is ~470 `it` blocks that broadcast real testnet transactions, and the
 * EVM specs are `describe.each(getActiveFixtures())` over four chains — an unfiltered
 * run is closer to ~900 live transactions. This file picks the scenarios worth paying
 * for, restricted to **Ethereum Sepolia + Solana Devnet**.
 *
 * Two consumers:
 *   - `preflight.ts` sums `needs` across the selected scenarios and refuses to start
 *     when the wallets cannot cover the run.
 *   - `run.ts` turns `file` + `grep` into a single `jest --runTestsByPath ... -t ...`.
 *
 * `grep` is a **regex fragment matched against the full jest test name** (describe path
 * and test title joined by spaces). Fragments are OR-joined by the runner, so each one
 * must be unique enough not to drag in neighbours — `run.ts --list --verify` checks
 * every fragment against the real titles.
 *
 * NOTE ON `[$label]`: the parameterised EVM suites title their describe blocks
 * `[$label]`, which jest interpolates to `[Ethereum Sepolia]` at runtime. The runner
 * pins `E2E_TARGET_CHAINS="Ethereum Sepolia"` so only the Sepolia variant exists — that
 * is what keeps these fragments from matching four chains' worth of tests.
 */

export const GROUPS = [
  'smoke',
  'evm-r1',
  'evm-r2',
  'evm-r3',
  'svm-r1',
  'svm-r2r3',
  'pc20',
  'push',
  'cross-chain',
  'known-fail',
] as const;

export type Group = (typeof GROUPS)[number];

/**
 * Assets the pre-flight prices, grouped by **which account actually pays**. This
 * distinction matters more than it looks:
 *
 *   - Route 1 (inbound) is paid by the *origin master EOA* on the source chain —
 *     Sepolia ETH/USDT, or Devnet SOL.
 *   - Routes 2 and 3 are paid by the **UEA on Push Chain**, which burns PC for gas and
 *     PRC-20s (pETH, pUSDT.eth, pSOL, pUSDT.sol) for funds. Every funds-moving spec in
 *     `evm/outbound`, `svm/outbound` and `evm/pc20` shares the *same* UEA — the one
 *     derived from `EVM_PRIVATE_KEY` — so it behaves as the suite's hot wallet.
 *   - The EVM-side CEA on Sepolia is **self-funding**: `ensureCeaErc20Balance` /
 *     `ensureCeaNativeBalance` (shared/outbound-helpers.ts) top it up over Route 2 from
 *     the UEA, so it needs no direct funding — only enough `uea*` to draw from.
 *   - The **SVM-side CEA PDA does not self-fund**. `svm/outbound/cea-to-uea.spec.ts`
 *     drains SOL/USDT that must already be sitting in the PDA, so the pre-flight tops it
 *     up directly from the Solana master.
 *
 * `ueaPC` and friends are targets for the UEA's *balance*, not amounts the master
 * spends. The pre-flight reads the UEA, computes the shortfall, and only then requires
 * the Push master to cover that delta.
 */
export type Asset =
  // EVM master (EVM_PRIVATE_KEY) on Ethereum Sepolia — Route 1 origin
  | 'sepoliaEth'
  | 'sepoliaUsdt'
  // Solana master (SOLANA_PRIVATE_KEY) on Solana Devnet — Route 1 origin
  | 'solanaSOL'
  | 'solanaUsdt'
  // Push master (PUSH_PRIVATE_KEY) on Push Donut — Push-native origin specs
  | 'masterPC'
  | 'masterPETH'
  // The EVM master's UEA on Push Donut — Routes 2/3 on both VMs, and PC20
  | 'ueaPC'
  | 'ueaPETH'
  | 'ueaUsdtEth'
  | 'ueaPSOL'
  | 'ueaUsdtSol'
  | 'ueaPC20'
  // The UEA's CEA PDA on Solana Devnet — drained by the SVM Route 3 specs
  | 'ceaSvmSOL'
  | 'ceaSvmUsdt';

export interface Scenario {
  /** Stable slug — appears in `--list`, the run log and the CI step summary. */
  id: string;
  group: Group;
  /** Spec path relative to `packages/core`. */
  file: string;
  /** Regex fragment matched against the full jest test name. */
  grep: string;
  /**
   * Approximate cost of one run, as decimal strings. Dominated by **gas and fee-lock
   * deposits**, not by transfer amounts — the specs move dust (0.0001 USDT, 0.00005 SOL)
   * but pay real fees. Deliberately generous; tune when a group fails the gate for the
   * wrong reason.
   */
  needs: Partial<Record<Asset, string>>;
  /** Extra env for this scenario — used by the `RUN_LIVE_*`-gated cascade tests. */
  env?: Record<string, string>;
  /** Why this scenario earned a slot. */
  note?: string;
}

const F = {
  acEth: '__e2e__/push/account-conversion/eth.spec.ts',
  acSol: '__e2e__/push/account-conversion/solana.spec.ts',
  acUtil: '__e2e__/push/account-conversion/utility.spec.ts',
  pushUtils: '__e2e__/push/utilities.spec.ts',
  pethGas: '__e2e__/cross-chain/peth-eth-gas-sizing.spec.ts',
  pc20Docs: '__e2e__/docs-examples/12-utility-functions/pc20.spec.ts',
  pc20Registry: '__e2e__/evm/pc20/pc20-registry.spec.ts',

  evmIn: '__e2e__/evm/inbound/uea-to-push.spec.ts',
  evmInFresh: '__e2e__/evm/inbound/route1-fresh-value-native-funds.spec.ts',
  evmR2: '__e2e__/evm/outbound/uea-to-cea.spec.ts',
  evmR3: '__e2e__/evm/outbound/cea-to-uea.spec.ts',
  evmR3Eoa: '__e2e__/evm/outbound/cea-to-eoa.spec.ts',

  svmIn: '__e2e__/svm/inbound/uea-to-push.spec.ts',
  svmR2: '__e2e__/svm/outbound/uea-to-cea.spec.ts',
  svmR3: '__e2e__/svm/outbound/cea-to-uea.spec.ts',

  pc20Export: '__e2e__/evm/pc20/pc20-export.spec.ts',
  pc20Inbound: '__e2e__/evm/pc20/pc20-inbound.spec.ts',
  pc20R3: '__e2e__/evm/pc20/pc20-r3.spec.ts',
  pc20Svm: '__e2e__/svm/pc20/pc20-svm.spec.ts',

  pushNative: '__e2e__/push/native.spec.ts',
  track: '__e2e__/push/track-transaction.spec.ts',

  multiChild: '__e2e__/cross-chain/multi-child-r3-sepolia.spec.ts',
  freshWallet: '__e2e__/cross-chain/fresh-wallet.spec.ts',
  pethBridge: '__e2e__/cross-chain/peth-bridge.spec.ts',
  cascade: '__e2e__/cross-chain/cascade-amm.spec.ts',
} as const;

export const SCENARIOS: Scenario[] = [
  // ---------------------------------------------------------------------------
  // smoke — read-only. No transactions, no funds. Runs first so a broken build or
  // a dead RPC fails in ~3 min instead of 90.
  // ---------------------------------------------------------------------------
  {
    id: 'smoke-uea-derive-evm',
    group: 'smoke',
    file: F.acEth,
    grep: 'should compute UEA for EVM origin account',
    needs: {},
  },
  {
    id: 'smoke-cea-derive-evm',
    group: 'smoke',
    file: F.acEth,
    grep: 'deriveExecutorAccount\\(\\) — CEA .*should return CEA for EVM origin on external chain',
    needs: {},
  },
  {
    id: 'smoke-roundtrip-evm',
    group: 'smoke',
    file: F.acEth,
    grep: 'EVM origin → CEA → resolve should return UEA \\+ origin',
    needs: {},
  },
  {
    id: 'smoke-roundtrip-svm',
    group: 'smoke',
    file: F.acSol,
    grep: 'Solana UEA → resolve should return original account',
    needs: {},
  },
  {
    id: 'smoke-cea-pda-svm',
    group: 'smoke',
    file: F.acUtil,
    grep: 'should return SVM CEA \\(PDA\\) for Solana target',
    needs: {},
    note: 'Guards the deriveSvmCeaPda seed layout every SVM route depends on.',
  },
  {
    id: 'smoke-gasfee-reads',
    group: 'smoke',
    file: F.pushUtils,
    grep: 'Read gasFee from UniversalCore should read gasFee for p',
    needs: {},
    note: 'Covers both the pSOL and pETH reads.',
  },
  {
    id: 'smoke-gas-sizer',
    group: 'smoke',
    file: F.pushUtils,
    grep: 'SDK 5\\.2 gas sizer — testnet smoke',
    needs: {},
    note: 'getPcUsdPrice + sizeOutboundGas — the $PC oracle path.',
  },
  // NOTE: the pETH gas-sizing guard lives in the `known-fail` group at the bottom
  // of this file — it is currently failing against a real regression.
  {
    id: 'smoke-pc20-registry',
    group: 'smoke',
    file: F.pc20Registry,
    grep: 'PC20 registry — (getPC20Address lists confirmed deployments only|rejections passes strict factory-identity)',
    needs: {},
  },
  {
    id: 'smoke-pc20-resolve',
    group: 'smoke',
    file: F.pc20Docs,
    grep: 'getPC20Address resolves the canonical Push token and its metadata',
    needs: {},
  },

  // ---------------------------------------------------------------------------
  // evm-r1 — Route 1 inbound, Sepolia UOA → Push UEA.
  // Paid by the EVM master on Sepolia (gas + fee-lock deposit).
  // ---------------------------------------------------------------------------
  {
    id: 'evm-r1-transfer',
    group: 'evm-r1',
    file: F.evmIn,
    grep: '\\b1\\. Transfer should send transfer to Push Chain address',
    needs: { sepoliaEth: '0.004' },
  },
  {
    id: 'evm-r1-funds-usdt',
    group: 'evm-r1',
    file: F.evmIn,
    grep: '\\b2\\. Funds — USDT should bridge USDT to self',
    needs: { sepoliaEth: '0.005', sepoliaUsdt: '0.02' },
  },
  {
    id: 'evm-r1-funds-native',
    group: 'evm-r1',
    file: F.evmIn,
    grep: '\\b3\\. Funds — Native should bridge native token to self',
    needs: { sepoliaEth: '0.006' },
  },
  {
    id: 'evm-r1-value-funds-data',
    group: 'evm-r1',
    file: F.evmIn,
    grep: '\\b4\\. Value \\+ Funds \\+ Data should send value \\+ funds \\+ data to counter contract',
    needs: { sepoliaEth: '0.006', sepoliaUsdt: '0.02' },
  },
  {
    id: 'evm-r1-bridge-multicall',
    group: 'evm-r1',
    file: F.evmIn,
    grep: '\\b5\\. Bridge \\+ Multicall should bridge USDT \\+ execute multicall array',
    needs: { sepoliaEth: '0.006', sepoliaUsdt: '0.02' },
  },
  {
    id: 'evm-r1-fresh-value-native',
    group: 'evm-r1',
    file: F.evmInFresh,
    grep: 'bridges Sepolia ETH as funds and parks requested PC value in the fresh UEA',
    needs: { sepoliaEth: '0.02' },
    note: 'Fresh-UEA value+funds regression; seeds a throwaway wallet from the master.',
  },

  // ---------------------------------------------------------------------------
  // evm-r2 — Route 2 outbound, Push UEA → Sepolia CEA. Burns UEA PC + PRC-20s.
  // ---------------------------------------------------------------------------
  {
    id: 'evm-r2-funds-erc20',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b1\\. Funds should transfer ERC-20 USDT',
    needs: { ueaPC: '2', ueaUsdtEth: '0.02' },
  },
  {
    id: 'evm-r2-payload',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b2\\. Payload \\(Data\\) should increment counter via payload',
    needs: { ueaPC: '2' },
  },
  {
    id: 'evm-r2-multicall',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b3\\. Multicall should double increment counter via multicall',
    needs: { ueaPC: '2' },
  },
  {
    id: 'evm-r2-funds-payload',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b4\\. Funds \\+ Payload should transfer ERC-20 USDT and increment counter',
    needs: { ueaPC: '2', ueaUsdtEth: '0.02' },
  },
  {
    id: 'evm-r2-native-funds',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b6\\. Native Funds should transfer native token',
    needs: { ueaPC: '2', ueaPETH: '0.0005' },
  },
  {
    id: 'evm-r2-native-funds-payload',
    group: 'evm-r2',
    file: F.evmR2,
    grep: '\\b7\\. Native Funds \\+ Payload should transfer native token and increment counter',
    needs: { ueaPC: '2', ueaPETH: '0.0005' },
  },

  // ---------------------------------------------------------------------------
  // evm-r3 — Route 3, Sepolia CEA → Push. The specs top the CEA up themselves over
  // Route 2, so the cost lands on the UEA, not on master Sepolia ETH.
  // ---------------------------------------------------------------------------
  {
    id: 'evm-r3-funds-erc20',
    group: 'evm-r3',
    file: F.evmR3,
    grep: '\\b1\\. Funds should bridge ERC20 USDT back from CEA to Push Chain',
    needs: { ueaPC: '3', ueaUsdtEth: '0.06' },
    note: 'ensureCeaErc20Balance funds the CEA with a 2x buffer before draining it.',
  },
  {
    id: 'evm-r3-payload',
    group: 'evm-r3',
    file: F.evmR3,
    grep: '\\b2\\. Payload \\(Data\\) should increment Push Chain counter via Route 3 payload',
    needs: { ueaPC: '2' },
  },
  {
    id: 'evm-r3-multicall',
    group: 'evm-r3',
    file: F.evmR3,
    grep: '\\b3\\. Multicall should execute multicall on Push Chain: increment counter \\+ approve',
    needs: { ueaPC: '2' },
  },
  {
    id: 'evm-r3-funds-payload',
    group: 'evm-r3',
    file: F.evmR3,
    grep: '\\b4\\. Funds \\+ Payload should bridge ERC20 USDT and increment Push Chain counter',
    needs: { ueaPC: '3', ueaUsdtEth: '0.06' },
  },
  {
    id: 'evm-r3-native-funds',
    group: 'evm-r3',
    file: F.evmR3,
    grep: '\\b6\\. Native Funds should transfer native token from CEA to Push Chain',
    needs: { ueaPC: '3', ueaPETH: '0.001' },
  },
  {
    id: 'evm-r3-eoa-native-funds',
    group: 'evm-r3',
    file: F.evmR3Eoa,
    grep: '\\b2\\. Native Funds should bridge native token back to Push Chain from EOA CEA',
    needs: { masterPC: '3', masterPETH: '0.001' },
    note: 'Push-native EOA origin — pays from the Push master, not the UEA.',
  },

  // ---------------------------------------------------------------------------
  // svm-r1 — Route 1 inbound, Solana UOA → Push UEA. Paid by the Solana master.
  // ---------------------------------------------------------------------------
  {
    id: 'svm-r1-transfer',
    group: 'svm-r1',
    file: F.svmIn,
    grep: '\\b1\\. Transfer should send transfer to Push Chain address',
    needs: { solanaSOL: '0.004' },
  },
  {
    id: 'svm-r1-funds-sol-self',
    group: 'svm-r1',
    file: F.svmIn,
    grep: '\\b3\\. Funds — SOL Bridge should bridge SOL to self',
    needs: { solanaSOL: '0.005' },
  },
  {
    id: 'svm-r1-value-self',
    group: 'svm-r1',
    file: F.svmIn,
    grep: '\\b5\\. Value to Self \\(UTX-01\\) should send value to own UEA address',
    needs: { solanaSOL: '0.004' },
  },
  {
    id: 'svm-r1-data-contract',
    group: 'svm-r1',
    file: F.svmIn,
    grep: '\\b6\\. Data to Contract \\(UTX-05\\) should send data-only to counter contract',
    needs: { solanaSOL: '0.004' },
  },
  {
    id: 'svm-r1-fresh-key-repro',
    group: 'svm-r1',
    file: F.svmIn,
    grep: '\\b22\\. Fresh-Key Repro .*should bridge 0\\.001 PC from a freshly generated Solana keypair',
    needs: { solanaSOL: '0.02' },
    note: 'The solana_basic regression target tracked in docs-examples/KNOWN_FAILURES.md.',
  },

  // ---------------------------------------------------------------------------
  // svm-r2r3 — Solana outbound (R2, burns UEA pSOL/pUSDT.sol) and Solana CEA
  // drain-back (R3, spends SOL/USDT that must already sit in the CEA PDA).
  // ---------------------------------------------------------------------------
  {
    id: 'svm-r2-funds-sol',
    group: 'svm-r2r3',
    file: F.svmR2,
    grep: '\\b1\\. Funds \\(SOL\\) should withdraw SOL to Solana Devnet recipient',
    needs: { ueaPC: '2', ueaPSOL: '0.0006' },
  },
  {
    id: 'svm-r2-funds-spl',
    group: 'svm-r2r3',
    file: F.svmR2,
    grep: '\\b2\\. Funds \\(SPL\\) should withdraw SPL token \\(pUSDT mapped\\) to Solana Devnet',
    needs: { ueaPC: '2', ueaUsdtSol: '0.02' },
  },
  {
    id: 'svm-r2-payload-cpi',
    group: 'svm-r2r3',
    file: F.svmR2,
    grep: '\\b3\\. Payload \\(CPI\\) should execute CPI on Solana program',
    needs: { ueaPC: '2', ueaPSOL: '0.0003' },
  },
  {
    id: 'svm-r2-sol-cpi',
    group: 'svm-r2r3',
    file: F.svmR2,
    grep: '\\b4\\. Funds \\+ Payload \\(SOL \\+ CPI\\) should withdraw SOL and execute CPI on Solana program in same tx',
    needs: { ueaPC: '2', ueaPSOL: '0.0006' },
  },
  {
    id: 'svm-r3-drain-sol',
    group: 'svm-r2r3',
    file: F.svmR3,
    grep: '\\b1\\. Funds \\(SOL\\) should drain SOL from Solana gateway back to UEA on Push Chain',
    needs: { ueaPC: '2', ceaSvmSOL: '0.006' },
    note: 'Drains 0.005 SOL that must already be in the CEA PDA — pre-flight seeds it.',
  },
  {
    id: 'svm-r3-drain-spl',
    group: 'svm-r2r3',
    file: F.svmR3,
    grep: '\\b2\\. Funds \\(SPL\\) should drain SPL token \\(USDT\\) from Solana gateway back to UEA',
    needs: { ueaPC: '2', ceaSvmSOL: '0.003', ceaSvmUsdt: '0.02' },
  },

  // ---------------------------------------------------------------------------
  // pc20 — the dynamic-mapping token flows. Recently fixed, high regression risk.
  // All PC20 specs sign with EVM_PRIVATE_KEY, so the tokens live on the UEA. Every
  // entry needs PC20_PUSH_TOKEN; wrapper-dependent ones self-skip loudly when
  // PC20_WRAPPER_SEPOLIA is unset (see shared/pc20-fixtures.ts).
  // ---------------------------------------------------------------------------
  {
    id: 'pc20-export-deployed-wrapper',
    group: 'pc20',
    file: F.pc20Export,
    grep: 'exports to an already-deployed wrapper and delivers to the recipient',
    needs: { ueaPC: '3', ueaPC20: '0.5' },
  },
  {
    id: 'pc20-export-predicts-wrapper',
    group: 'pc20',
    file: F.pc20Export,
    grep: 'predicts the wrapper address correctly on a first export',
    needs: { ueaPC: '1' },
  },
  {
    id: 'pc20-inbound-burn-unlock',
    group: 'pc20',
    file: F.pc20Inbound,
    grep: 'burns the wrapper and unlocks the Push-native token',
    needs: { sepoliaEth: '0.006', ueaPC: '1' },
    note: 'Burns the Sepolia wrapper directly from the master EOA.',
  },
  {
    id: 'pc20-r3-cea-burn',
    group: 'pc20',
    file: F.pc20R3,
    grep: 'burns wrapper from the CEA and unlocks to the UEA',
    needs: { ueaPC: '3', ueaPETH: '0.001' },
  },
  {
    id: 'pc20-svm-r1-direct-burn',
    group: 'pc20',
    file: F.pc20Svm,
    grep: 'R1 direct burn from the wallet unlocks on Push',
    needs: { solanaSOL: '0.01', ueaPC: '1' },
  },
  {
    id: 'pc20-svm-r3-cea-ata-burn',
    group: 'pc20',
    file: F.pc20Svm,
    grep: 'R3 burns the CEA ATA balance and unlocks on Push',
    needs: { ueaPC: '2', ceaSvmSOL: '0.005' },
  },

  // ---------------------------------------------------------------------------
  // push — Push-native origin, plus the tracking contracts the website and docs
  // depend on.
  // ---------------------------------------------------------------------------
  {
    id: 'push-send-transaction',
    group: 'push',
    file: F.pushNative,
    grep: 'Origin - Push should sendTransaction',
    needs: { masterPC: '1' },
  },
  {
    id: 'push-value-own-uea',
    group: 'push',
    file: F.pushNative,
    grep: 'Origin - Push should send value to own UEA \\(UTX-01\\)',
    needs: { masterPC: '1' },
  },
  {
    id: 'push-multicall-no-funds',
    group: 'push',
    file: F.pushNative,
    grep: 'Origin - Push should execute multicall without funds \\(UTX-21\\)',
    needs: { masterPC: '1' },
  },
  {
    id: 'push-track-r1-sepolia-parity',
    group: 'push',
    file: F.track,
    grep: 'B\\. Sepolia UOA funds-bridge path — three streams match spec',
    needs: { sepoliaEth: '0.008' },
    note: 'live vs tx.progressHook vs trackTransaction replay must agree.',
  },
  {
    id: 'push-track-r3-funds-roundtrip',
    group: 'push',
    file: F.track,
    grep: 'FUNDS success: live \\+ replay \\+ track-client streams complete full round-trip at 399-01',
    needs: { ueaPC: '3', ueaPETH: '0.001' },
  },
  {
    id: 'push-track-source-leg-hashes',
    group: 'push',
    file: F.track,
    grep: 'source-leg hash tracking .*(SVM origin: tracks a Solana-origin tx|EVM origin: tracks an Ethereum-Sepolia-origin tx)',
    needs: {},
    note: 'Read-only: tracks already-mined txs on both VMs.',
  },

  // ---------------------------------------------------------------------------
  // cross-chain — the expensive end. `xc-cascade-6hop` is the only scenario that
  // exercises Sepolia and Solana in a single flow.
  // ---------------------------------------------------------------------------
  {
    id: 'xc-multi-child-r3',
    group: 'cross-chain',
    file: F.multiChild,
    grep: 'chains two R3 hops from Sepolia and both Push-Chain side-effects land',
    needs: { sepoliaEth: '0.04', ueaPC: '2' },
  },
  {
    id: 'xc-fresh-wallet-r3',
    group: 'cross-chain',
    file: F.freshWallet,
    grep: 'should execute Route 3 from a fresh wallet \\(UEA auto-deploy\\)',
    needs: { sepoliaEth: '0.03', masterPC: '2' },
  },
  {
    id: 'xc-peth-bridge-back',
    group: 'cross-chain',
    file: F.pethBridge,
    grep: 'sends pETH from UEA back to Sepolia using getMoveableTokens\\(\\)\\[0\\]',
    needs: { ueaPC: '2', ueaPETH: '0.002' },
  },
  {
    id: 'xc-cascade-6hop',
    group: 'cross-chain',
    file: F.cascade,
    grep: 'executes Sepolia ETH -> pETH -> WPC -> pSOL -> Solana CEA',
    needs: { sepoliaEth: '0.05', ueaPC: '5', ueaPETH: '0.002' },
    env: { RUN_LIVE_SIX_HOP_CASCADE: '1' },
    note: 'Flagship: ~20 min, and the one scenario spanning both target chains.',
  },

  // ---------------------------------------------------------------------------
  // known-fail — scenarios that are failing against a *real* defect, not a flake.
  //
  // Excluded from `all` so the suite has a green baseline, but kept here so the
  // regression stays tracked and can be run deliberately with `--group known-fail`.
  // Move an entry back to its natural group the moment the underlying bug is fixed.
  // ---------------------------------------------------------------------------
  {
    id: 'knownfail-peth-gas-sizing',
    group: 'known-fail',
    file: F.pethGas,
    grep: 'pETH -> ETH gas sizing \\(STF repro, live pool\\)',
    needs: {},
    note:
      'FAILS as of 2026-08-06: estimateNativeValueForSwap returns 17 PC ' +
      '(balance - reserve, the pre-fix behaviour) where the test expects the full ' +
      '~20.9 PC requirement. Real regression in the Route 2 dead-zone gas sizer.',
  },
];

/**
 * Scenarios for a group. `all` means "everything that should pass" — it deliberately
 * excludes `known-fail`, which has to be asked for by name.
 */
export function scenariosFor(group: string | undefined): Scenario[] {
  if (!group || group === 'all') {
    return SCENARIOS.filter((s) => s.group !== 'known-fail');
  }
  if (!(GROUPS as readonly string[]).includes(group)) {
    throw new Error(
      `Unknown group "${group}". Expected one of: all, ${GROUPS.join(', ')}`
    );
  }
  return SCENARIOS.filter((s) => s.group === group);
}

/** Sums each scenario's `needs` into a single per-asset total. */
export function aggregateNeeds(
  scenarios: Scenario[]
): Partial<Record<Asset, number>> {
  const total: Partial<Record<Asset, number>> = {};
  for (const s of scenarios) {
    for (const [asset, amount] of Object.entries(s.needs) as [Asset, string][]) {
      total[asset] = (total[asset] ?? 0) + Number(amount);
    }
  }
  return total;
}

/** Merges the per-scenario `env` overrides for a selection. */
export function envFor(scenarios: Scenario[]): Record<string, string> {
  return scenarios.reduce<Record<string, string>>(
    (acc, s) => Object.assign(acc, s.env ?? {}),
    {}
  );
}
