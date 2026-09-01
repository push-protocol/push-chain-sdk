---
'@pushchain/core': patch
---

Fix EVM PC20 wrapper burns destroying the wrapper without unlocking the
canonical token.

An EVM PC20 import with no `data` was routed down the funds-only path, which
submits an empty payload. The gateway prepends the PC20 selector, and on the
chain side `NormalizeForTxType` strips it back off, is left holding `'0x'` —
which slips past its empty-payload check — and then fails decoding it at
ballot finalization. No inbound handler ever runs: no UEA deploy, no credit,
no revert outbound. The wrapper is already burned at that point, so the
canonical token stayed locked in VaultPC20 permanently. Observed on Donut:
wrapper burned on Sepolia, nothing unlocked on Push.

The always-forward mitigation that routes PC20 imports through the payload
path — whose real forward payload classifies and decodes legitimately — was
gated on the source chain being Solana, which is what left EVM exposed.

- PC20 imports now take the payload path on **both** VMs, not just Solana.
- `executeFundsOnly` fails closed with `PC20UnsafeEmptyPayloadError` if a
  PC20 import ever reaches it again, instead of broadcasting a burn that
  destroys value. The guard existed but was never wired into this path.

Verified on Donut: the previously-failing wrapper burn from a fresh account
now deploys the UEA and credits the canonical token (`route1_pc20_import`
e2e passes). PRC20 and native funds-only flows are unchanged — a funds-only
inbound is a balance credit to the recipient address and needs no deployed
UEA, so only the PC20 selector shape was affected.
