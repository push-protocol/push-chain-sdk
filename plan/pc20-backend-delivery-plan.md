# PC20 Backend Delivery Plan

> **Scope of this document.** Phases, schedule, dependencies, risks, and
> acceptance only. The API surface, validation model, transaction flows, and
> testing detail live in
> [`pc20-backend-implementation-plan.md`](./pc20-backend-implementation-plan.md),
> which is the single source of truth. Do not restate specification detail
> here — the two documents previously overlapped and drifted.

## Objective

Add first-class PC20 support to the Push Chain SDK so applications can move
Push-native tokens between Push Chain and supported external chains through the
existing universal transaction API, without breaking the existing PRC20 and
native-token paths.

Delivered capabilities:

- External PC20 wrapper to Push Chain transfers, with and without calldata.
- Push-native PC20 exports to supported EVM and SVM chains.
- Resolution of an external wrapper to its canonical Push Chain token.
- Discovery of a Push-native PC20's confirmed deployments by chain.
- Strict validation that a supplied token address belongs to the supplied chain.

## Delivery phases

Estimates are engineer-days for one engineer, excluding external blocker wait
time. Owners marked TBD must be assigned before Phase 1 starts.

| Phase | Contents | Est. | Owner | PR |
| --- | --- | --- | --- | --- |
| 0 — Alignment | Repository and deployment prerequisites | 2d + external wait | TBD | — |
| 1 — Foundation | Types, ABIs, address codecs, namespace mapping, registry resolver, `getPC20Address`, `getPC20Deployments`, typed errors, proto sync | 6–8d | TBD | PR 1 |
| 2 — EVM | Inbound wrapper burn (funds-only and with calldata), Push-to-EVM export, wrapper prediction, PC20 gas quoting, tracking fallback, rescue path | 8–10d | TBD | PR 2 |
| 3 — SVM | Mint/state validation, Solana burn, Push-to-Solana export, base58 normalization | 8–10d | TBD | PR 3 |
| 4 — Hardening | Prepared transactions, cascade, error decoding, docs, changeset, full regression and E2E | 5d | TBD | — |

Phase 3 is **conditional**. See the gating decision below.

## Dependencies and blockers

| Dependency | Type | Owner | Needed by | Fallback if unmet |
| --- | --- | --- | --- | --- |
| Duplicate `IUniversalCore.sol` removed upstream | external | core-contracts (TBD) | PR 1 merge | PR 1 cannot merge; Linux CI compiles the stale interface |
| Donut UGPC deployed with `VaultPC20` + UniversalCore configured | external | protocol/devops (TBD) | Phase 2 E2E | Phase 2 unit/integration work proceeds against forked-state fixtures; E2E slips |
| Each external gateway's live PC20 factory matches `UniversalCore.pc20FactoryByChain` | external | protocol/devops (TBD) | Phase 2 E2E | as above |
| Node/API transaction schemas expose PC20 fields | external | node (TBD) | Phase 2 tracking | tracking falls back to UniversalCore resolution only |
| Canonical Solana PC20 IDL and deployed program | external | gateway (TBD) | Phase 3 start | Phase 3 cut from the release |

Phases 1 and 2 must be buildable against recorded or forked chain state so
engineering is not idle while the environment is provisioned.

### SVM gating decision

The SVM PC20 program and canonical IDL do not exist yet. Phase 3 is not
committed to this release. At Phase 2 exit, make an explicit go/no-go call:

- **Go** — IDL and a devnet deployment are available; Phase 3 proceeds.
- **No-go** — ship Phases 1, 2, and 4 as EVM-only PC20 support. SVM chains are
  rejected with `UnsupportedPC20DestinationError` and documented as
  unsupported. This is a decision that gets recorded, not a silent slip.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Chain/address mismatch routes a token through the wrong gateway path | Registry forward/reverse agreement is required on every send; factory identity is verified at prepare time and on first use per session |
| First export has no registered wrapper yet | Deterministic factory/PDA derivation, with the factory implementation hash pinned |
| A wrong wrapper prediction strands funds already locked in VaultPC20 | Abort before approval on an implementation-hash mismatch; represent PC20 in the rescue path so a reverted export is recoverable |
| `isFirstExport` changes between quote and inclusion | Always add `pc20DeploymentGasOverhead` to the `maxPCForGas` ceiling regardless of the quoted flag |
| PC20 is accidentally processed as PRC20 | Explicit `standard: 'pc20'` discriminant resolved once, carried through all builders; a PRC20 address on the Push chain gets its own typed error |
| Validation latency degrades every send | Tiered checks, multicall batching, positive-only caching, and an asserted round-trip budget |
| Chain namespace format mismatch silently reads as "not deployed" | Single namespace mapping helper; unmappable values throw instead of returning a negative result |
| Registry changes after transaction preparation | Revalidate critical registry state at send time; never cache negative results |
| Existing transaction flows regress | Keep the `MoveableToken` path unchanged and run the complete PRC20/native regression suite |
| Phase 3 blocks the release waiting on SVM infrastructure | Explicit go/no-go at Phase 2 exit |

## Acceptance criteria

Functional:

- The `{ standard: 'pc20', chain, address }` input works without requiring
  symbol, decimals, or approval mechanism.
- External wrapper identity is validated against its chain before any write.
- External-to-Push transfers work with and without calldata.
- The SDK does not approve EVM PC20 wrappers for inbound burns.
- Push-to-external export locks the canonical Push token and delivers the
  correct wrapper.
- `getPC20Address` returns the canonical Push token and reports its direction.
- `getPC20Deployments` returns confirmed EVM and SVM deployments.
- First and repeat exports use the correct wrapper and fee behavior.
- PC20 tracking returns chain-native wrapper addresses and does not require a
  nonempty initial `externalAssetAddr`.
- Existing PRC20 and native-token APIs remain backward compatible.
- EVM round-trip E2E passes; SVM round-trip passes or SVM is explicitly
  rejected per the gating decision.

Measurable:

- PC20 validation adds at most 2 sequential RPC round trips on the warm path
  and 4 cold, asserted by test.
- `getPC20Deployments` issues exactly 1 multicall regardless of chain count.
- At least 85% line coverage on new PC20 modules, 100% branch coverage on the
  validation paths and address codecs.
- No funds-at-risk path is reachable without a preceding pre-approval abort.
