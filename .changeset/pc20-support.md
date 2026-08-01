---
'@pushchain/core': minor
---

Add PC20 support to the universal transaction API.

PC20 tokens are identified by chain and address alone, resolved against
UniversalCore's on-chain registry rather than the SDK's static token tables:

```ts
await pushChainClient.universal.sendTransaction({
  to: '0xRecipient',
  funds: {
    amount: PushChain.utils.helpers.parseUnits('1', 6),
    token: {
      chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      address: '0xPC20Wrapper',
    },
  },
});
```

The same shape exports a Push-native PC20 by naming the Push chain in
`funds.token.chain` and the destination in `to.chain`.

**New utility**

`PushChain.utils.tokens.getPC20Address(address, options)` — resolve a PC20 from
either end of the mapping and list every confirmed address it has across chains.

```ts
const token = await PushChain.utils.tokens.getPC20Address('0xWrapper', {
  chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA, // optional — omit to auto-discover
  network: CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
});
token.address;  // canonical Push-native PC20
token.registry; // [{ address, chain, chainName }, …] — wrappers, then Push last
```

Lookup is lenient (auto-discovery); spending is not — `funds.token` requires
`chain`, and a send whose chain disagrees with where the funds actually are is
rejected before any approval.

**Route coverage**

- R1 (external → Push wrapper burn): EVM and Solana. The Solana burn needs no
  per-mint rate-limit whitelisting (the gateway's `token_rate_limit` account is
  optional for PC20 burns; the SDK passes `null`, or the native-SOL rate-limit
  PDA when the call carries a native gas deposit). Solana PC20 imports always
  route through the funds+payload path with an explicit forward payload.
- R2 (Push → external export): EVM and Solana, including first-export wrapper
  prediction and Solana recipient-ATA delivery (falls back to the sender's CEA
  ATA when the recipient has no token account — an ATA cannot exist before its
  mint does on a first export).
- R3 (CEA → Push): EVM and Solana. CEA-held wrappers burn back and unlock the
  canonical token to the UEA; funds-only burns always carry an explicit
  Push-side forward payload.
- R4 (CEA → CEA): not yet supported for PC20.

**Behavior worth knowing**

- Inbound wrappers are never approved (the gateway's PC20Factory burns via
  `burnFrom`); exports approve and lock the canonical Push token into VaultPC20
  and quote gas through `getPC20ExportGasAndFees`.
- With funds plus a single `data` payload, tokens are transferred to
  `execute.to` and then the call runs — no allowance is granted to the target,
  so calldata using `transferFrom` will revert.

**Typed errors**

`PC20Error` and thirteen subclasses (`PC20WrapperNotRegisteredError`,
`PC20RegistryMismatchError`, `PC20TokenChainMismatchError`,
`PC20ExpectedButPRC20Error`, `PC20AmbiguousAddressError`, and others), each
carrying the supplied chain and address, the expected chain where relevant, and
a remediation hint.

**Fixes**

- `Inbound` protobuf field numbering realigned with the chain (was misnumbered
  from field 7 onward); `logIndex`, `isCea`, `rawPayload`, `isPc20` added.
- `SvmClient.writeContract` supports `remainingAccounts`.
- A PC20 return emits two gateway events — the wrapper burn and a separate
  funds leg for the attached gas deposit — and status tracking followed the
  wrong one (the last event on EVM, the second on Solana), so a failure
  crediting the gas deposit was reported as the whole transfer failing even
  though the tokens had arrived. Tracking now follows the burn leg on both
  VMs, identified by its payload selector rather than its position. Non-PC20
  flows are unchanged.
- A PC20 burn now names the sender's executor account in the gateway request
  instead of the zero-address sentinel. The gateway forwards a burn's excess
  native value as a *funds* request carrying that recipient verbatim, and a
  funds inbound credits it directly — so the zero made the chain mint the
  prepaid gas to the zero address and revert, silently losing the deposit.
  Other flows keep the sentinel, which the protocol resolves for them.

Existing `MoveableToken` PRC20 and native-token flows are unchanged.
