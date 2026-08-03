# Docs Examples — E2E

These tests are **1:1 mirrors** of the runnable code blocks in the website docs at
`push-chain-website/docs/chain/03-build/06-Send-Universal-Transaction.mdx`,
`07-Universal-Transaction-Scenarios.mdx`, `08-Send-Multichain-Transactions.mdx`,
and `12-Utility-Functions.mdx`.

## Intent

Each docs example uses `ethers.Wallet.createRandom()` plus a `readline` prompt that asks
the user to fund the new wallet at a specific address with specific amounts, e.g.

> Fund these accounts, then press Enter:
>   • UOA `0x…` on Sepolia — at least 0.005 ETH (gas to sign)
>   • UEA `0x…` on Push Chain — at least 1 PC + 0.002 pETH (burned to release ETH on Sepolia)

In CI / e2e we cannot stop and wait for a human to send funds. These tests therefore:

1. Generate the same fresh random wallet (matches the docs example)
2. **Auto-fund** that wallet from a pre-funded **master wallet** loaded from `.env`
   (`EVM_PRIVATE_KEY`, `PUSH_PRIVATE_KEY`, `BNB_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`)
   using the **exact amounts the prompt asks for** — no bumping, no buffering
3. Run the **exact code block** from the docs (every line under `// Code` in the MDX)
4. Add proper assertions on the response and on cross-chain receipt

Anything that drifts from the docs example is a bug — either in the test or in the docs.
The test files reference the docs slug (`customPropGTagEvent=…`) and line range so it's
trivial to keep them in sync.

## Layout

One spec file per docs page (or route family within a page). Inside each file, every
`it()` block mirrors one `customPropGTagEvent` slug from the docs and cites its MDX
line range in a leading comment.

```
docs-examples/
├── _helpers/
│   └── docs-fund.ts                                  # auto-fund a fresh wallet from master,
│                                                     # matching the prompt amounts verbatim
├── 06-send-universal-transaction/
│   └── send-universal-transaction.spec.ts            # mirrors 06-*.mdx
├── 07-transaction-scenarios/
│   ├── route1.spec.ts                                # all UOA_TO_PUSH slugs from 07-*.mdx
│   ├── route2.spec.ts                                # all UOA_TO_CEA slugs from 07-*.mdx
│   └── route3.spec.ts                                # all CEA_TO_PUSH slugs from 07-*.mdx
├── 08-multichain-transactions/
│   └── multichain-transactions.spec.ts               # mirrors 08-*.mdx
└── 12-utility-functions/
    └── pc20.spec.ts                                  # mirrors the "Get PC20 Address" section
                                                      # of 12-*.mdx — read-only, no signer
```

### PC20

PC20 examples appear in four places and are gated separately from the rest,
because PC20 mappings are dynamic and live on chain — there is no static table,
so every address comes from the environment (see `../shared/pc20-fixtures.ts`):

| Spec | Slug | Needs |
|---|---|---|
| `12-utility-functions/pc20.spec.ts` | `utility_get_pc20_address` | `PC20_PUSH_TOKEN` (read-only, no signer) |
| `07-.../route1.spec.ts` | `send_transaction_route1_pc20_import` | `+ EVM_PRIVATE_KEY`, `PC20_WRAPPER_SEPOLIA` |
| `07-.../route2.spec.ts` | `send_transaction_route2_pc20_export` | `+ EVM_PRIVATE_KEY`, `PUSH_PRIVATE_KEY` |
| `07-.../route3.spec.ts` | `send_transaction_route3_pc20_cea_burn` | `+ PUSH_PRIVATE_KEY`, `PC20_WRAPPER_SEPOLIA` |

`PC20_WRAPPER_SEPOLIA` is optional because the wrapper does not exist until a
first export creates it — `route2_pc20_export` is the test that creates one.
Cases needing it are registered as `it.skip` and say so, rather than returning
early from the body (which would report as PASSED while asserting nothing).

Each spec file's header comment cites the **slug** and **MDX line range** it mirrors so
that updating a docs example is a straightforward "find the matching `it()`, update both."

## Required env vars

`.env` (under `packages/core/`) must define:

| var | what it pays for |
|---|---|
| `EVM_PRIVATE_KEY` | Sepolia ETH (UOA signing gas), Sepolia ERC-20 USDT/USDC (bridged-in tests), and BNB Testnet BNB+USDT (Route 3 CEA funding — same hex private key, since BSC Testnet is EVM) |
| `PUSH_PRIVATE_KEY` | Push Chain native PC (sent to fresh UEA where the docs prompt asks for `… PC + … pETH`) and any PRC-20s the master holds (pETH, pUSDT(BNB)) for Route 2 burn tests |
| `SOLANA_PRIVATE_KEY` | Solana Devnet SOL (UOA signing gas for the SVM examples) |
| `PC20_PUSH_TOKEN` | The Push-native PC20 on Donut. Required by every PC20 example. |
| `PC20_WRAPPER_SEPOLIA` | Its deployed wrapper on Sepolia. Optional — see the PC20 note above. |

Tests `it.skip` themselves when the env var they need is missing, so partial setups still
run their applicable subset.

## Known prerequisites

Every funding helper pre-checks the master's balance and **throws a clear error** if the
master is short — the test fails hard so the missing balance can't be silently ignored in
CI. The error message points at the exact address + asset to top up.

A handful of Route 2 examples burn `pETH` or `pUSDT(BNB)` on the UEA, so the master Push
Chain wallet must hold a small amount of those PRC-20s. If you see
`[fund] master Push wallet … needs X units of pETH`, top up the master via a Route 1
funds-bridge (see `route1_funds_erc20` / `route1_move_funds_native_ethers` in the
`07-transaction-scenarios/route1.spec.ts`) and re-run.

### Pre-flight balance check

Before running the suite, use the dev script to verify all master wallets are funded:

```
cd packages/core
npx ts-node --transpile-only __e2e__/docs-examples/_helpers/check-balances.ts
```

It queries each master wallet on every chain, compares the balance to the aggregate
amount all funds-moving tests collectively need, and prints a table:

```
┌───────────────┬──────────────┬───────┬─────────┬────────┐
│     Chain     │    Asset     │ Need  │  Have   │ Status │
├───────────────┼──────────────┼───────┼─────────┼────────┤
│ Sepolia       │ ETH          │  0.14 │  0.8918 │   ✓    │
│ Sepolia       │ USDT         │  0.24 │ 9999.99 │   ✓    │
│ Sepolia       │ USDC         │     5 │       0 │   ✗    │
│ BNB Testnet   │ BNB          │  0.10 │  1.2434 │   ✓    │
│ BNB Testnet   │ USDT         │  0.04 │     500 │   ✓    │
│ Push Chain    │ PC           │    27 │ 4366.15 │   ✓    │
│ Push Chain    │ pETH         │ 0.004 │   0.271 │   ✓    │
│ Push Chain    │ pUSDT(BNB)   │  0.04 │   1.198 │   ✓    │
│ Solana Devnet │ SOL          │  0.02 │  0.0948 │   ✓    │
│ Push Chain    │ PC20         │     1 │  12.000 │   ✓    │
│ Sepolia       │ PC20 wrapper │     2 │   3.000 │   ✓    │
└───────────────┴──────────────┴───────┴─────────┴────────┘
```

The two PC20 rows only appear when `PC20_PUSH_TOKEN` / `PC20_WRAPPER_SEPOLIA` are
set — the matching specs skip when they are not, so demanding a balance for an
unconfigured token would fail the pre-flight for tests that were never going to run.

Exit code is **0** when every row is `✓`, **1** when one or more are short — so it's
safe to gate CI or a pre-test hook on it. Missing rows are re-listed below the table
with the top-up amount and asset so it's obvious what to fund.

## Running

Run through `jest.e2e.config.ts`, not the default Nx target — only the e2e config
carries the 5-minute timeout, the global setup, and the file reporter. Logs land in
`packages/core/e2e-logs/`.

```
# all docs-examples specs (from the repo root)
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core __e2e__/docs-examples --runInBand

# one file
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core \
  __e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts --runInBand

# one slug — use Jest's -t flag to match the it() title
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core \
  __e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts -t 'route2_funds' --runInBand

# Solana-origin/target slugs (requires EVM_PRIVATE_KEY + PUSH_PRIVATE_KEY or SOLANA_PRIVATE_KEY)
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core \
  __e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts -t 'route2_solana' --runInBand

# PC20 — the read-only registry example needs no signer and no funds
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core \
  __e2e__/docs-examples/12-utility-functions --runInBand

# PC20 funds-moving examples
npx jest -c packages/core/jest.e2e.config.ts --rootDir packages/core \
  __e2e__/docs-examples/07-transaction-scenarios -t 'pc20' --runInBand
```

**`--runInBand` is not optional for the funds-moving suites.** They broadcast real
transactions from a single key, so jest's default parallel workers race for the same
nonce. The observed symptom is a worker force-exited and its suite reported failed
with zero failed tests, while the same suite passes when run alone.
