# Bug 2 — PC20 CEA return with empty payload: inbound bricks, funds permanently stuck

**Status:** Open — chain-side fix required (gateway Solidity and/or `x/uexecutor` Go)
**Reported:** 2026-07-29
**Severity:** High — funds-loss class; 100% deterministic; no auto-revert
**Evidence tx:** Sepolia `0x6e4312cf856a7fab59541a98222ee2e1d0fc73bf30c6e33070f4dab530f23dc0`
**Stuck UTX (repro):** `0xcc4ade6504cc832fa38381680ba7901b5c6fa1169c63407cf8af34ed0a241269` — 0.001 rain (inbound child; gateway UniversalTx at logIndex 454)
**Outbound (relay) leg:** Push origin tx `0xd6e0abe1ed2630762b6d3bf682eb3ab9e08c727b28a995c4632297af248fe6fc` → outbound UTX `0x5e425c646a1a7fdd3b4d6f517a14ee623b2d240049068d45b10794945bb6ae4e` (tx_id `0x5fc879288a0dbe5f9a210c9fb38347d43b4a7d720adfa5c2a96200d8d3d84de6`, from the chain's own `outbound_created` event)

## What we're trying to do

**Route 3: returning wrapper tokens held by a CEA.** A user's CEA on Sepolia holds PC20 wrapper tokens (parked funds, DeFi proceeds, direct transfers). The CEA burns them so the canonical token unlocks on Push to the owner's UEA. Funds-only — no execution payload:

```
CEA (Sepolia)                                 Push Chain
  sendUniversalTxFromCEA(                      inbound: unlock canonical token
    token = wrapper, amount = 0.001,             → owner's UEA
    payload = ""  ← funds-only, same
  )               convention as PRC20 R3
```

## The SDK flow, step by step — and exactly where it fails

The developer-facing call (Route 3 — note `from.chain`, which selects the CEA-origin route):

```ts
await pushChainClient.universal.sendTransaction({
  from: { chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA },      // funds live in the CEA on this chain
  to: '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D',       // Push recipient (the owner's UEA)
  funds: {
    amount: 1000000000000000n,                             // 0.001
    token: {
      chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,             // the wrapper's chain (must equal from.chain)
      address: '0x81E05001A1f3fB574E18c1B0b2596163c68144ae',
    },
  },
});
```

Route 3 is a **relay-then-return**: the SDK first drives the CEA from Push (an outbound), the CEA then burns and emits a fresh inbound back to Push. Two chain hops, orchestrated by one SDK call:

| # | Stage | Actor | What happens | Status |
|---|---|---|---|---|
| 1 | **PC20 resolution** | SDK | Wrapper resolved via UniversalCore (forward + reverse registry check) → RAIN; chain-ownership check: `token.chain === from.chain` | ✅ |
| 2 | **Route detection** | SDK | `from.chain` present + `to` is a Push address → Route 3 (CEA → Push) | ✅ |
| 3 | **CEA resolution** | SDK | `CEAFactory.getCEAForPushAccount(UEA)` on Sepolia → CEA `0x275604E8…7f9` | ✅ |
| 4 | **CEA payload build** | SDK | The 420-byte multicall below: CEA self-call `sendUniversalTxToUEA(wrapper, 0.001, payload=0x, revertRecipient=UEA)`. **`payload=0x` is the pre-fix funds-only encoding — valid per protocol, identical to the PRC20 R3 convention** | ✅ (but see step 9) |
| 5 | **Outbound build + submit** | SDK → Push | `sendUniversalTxOutbound(recipient=CEA, token=pETH /*relay gas*/, amount=0, payload=<420B blob>)` — user signs; UEA executes on Push. Push tx `0xd6e0abe1ed2630762b6d3bf682eb3ab9e08c727b28a995c4632297af248fe6fc` | ✅ |
| 6 | **Relay to Sepolia** | TSS/relayer | `finalizeUniversalTx(..., data=<the same 420B, byte-identical>)` on the Vault → CEA executes the multicall — evidence tx `0x6e4312cf…3dc0` | ✅ |
| 7 | **Gateway burn** | Sepolia gateway | `sendUniversalTxFromCEA` → `_routePC20Tx(fromCEA=true)`: 0.001 wrapper **burned from the CEA** (supply decreased), `PC20` selector prepended to the (empty) payload, event emitted: `payload=0x50433230, txType=FUNDS_AND_PAYLOAD` | ✅ burn / ⚠️ classification |
| 8 | **Observation + vote** | validators | Inbound record created, all fields correct, `isPc20: true` | ✅ |
| 9 | **Inbound processing** | Push chain | `NormalizeForTxType`: selector stripped → `"0x"` → passes the `!= ""` guard → decode(nil) → **hard fail, no revert outbound. Wrapper already burned at step 7; unlock never runs. 0.001 permanently stuck** | ❌ **← THE FAILURE** |
| 10 | **Round-trip tracking** | SDK | `waitForInboundPushTx` finds the child UTX, sees the FAILED pcTx (`status 0, pcTx[0].txHash ''`), emits terminal hook `SEND-TX-399-02`, `wait()` throws | ⚠️ (correct SDK behavior, reporting the chain failure) |

**Where the SDK's responsibility ends:** the 420 bytes built at step 4 are on the wire verbatim at step 6 (extracted from the evidence tx and compared — identical), and step 7 proves the gateway executed them exactly as intended. The failure at step 9 is a chain-side representation bug (`"0x"` vs `""`) triggered by the *gateway's own* selector-prepending at step 7.

**The interplay that makes this nasty:** step 7's burn is irreversible the moment it lands; step 9's failure produces no compensating revert. Any flow reaching step 9 with a selector-only payload loses the funds — deterministically.

**SDK mitigation (shipped):** step 4 now *always* attaches a Push-side forward payload — `RAIN.transfer(to, amount)`, even as a self-transfer when `to` is the UEA. That makes the FUNDS_AND_PAYLOAD classification legitimate and the decode succeed; the same flow is verified green end-to-end on both EVM and Solana. This protects SDK traffic only — raw integrations still hit the bug.

## Exact payload the SDK sent (verbatim from the wire)

The SDK's artifact is the CEA multicall payload, built on Push inside the outbound the UEA submitted, and carried verbatim by the relayer to Sepolia in `finalizeUniversalTx(..., data)` — extracted from the evidence tx, byte-for-byte identical at both ends. 420 bytes:

```
0x2cc2842d000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000275604e8670654fe872e0215c0509664e13ba7f90000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a4e7c1e3fc00000000000000000000000081e05001a1f3fb574e18c1b0b2596163c68144ae00000000000000000000000000000000000000000000000000038d7ea4c6800000000000000000000000000000000000000000000000000000000000000000800000000000000000000000005c70c864cf1adfb04a0e107ffa248ba3600eab8d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

Decoded: `0x2cc2842d (UEA_MULTICALL) + Multicall[1]{ to: 0x275604E8…7f9 (the CEA, self-call), value: 0, calldata: 0xe7c1e3fc =`

```
sendUniversalTxToUEA(
  token           = 0x81E05001A1f3fB574E18c1B0b2596163c68144ae,  // wrapper
  amount          = 1000000000000000,                            // 0.001
  payload         = 0x,                                          // ← EMPTY — funds-only
  revertRecipient = 0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D   // UEA
)
```

`}`. The empty `payload` field is the crux: it is the correct, protocol-conformant encoding of "funds only" (identical to the PRC20 R3 convention). Everything after this point — the 4-byte `0x50433230` pseudo-payload and its FUNDS_AND_PAYLOAD classification — is manufactured by the gateway.

## What is working

Verified from the evidence tx:

- The whole delivery pipeline up to Push: outbound relay drives the CEA, CEA self-call executes, gateway burns 0.001 wrapper from the CEA (supply decreased on Sepolia)
- Event emitted with all fields correct — decoded: `sender=CEA(0x275604E8…), recipient=UEA(0x5C70C8…), fromCEA=true, token=wrapper, amount=0.001`
- Validators observe and vote; the inbound record is created with `isPc20: true` and all fields intact
- After the SDK-side mitigation (always attaching a forward payload), the same flow completes end to end — verified live on both EVM and Solana

## What failed

The chain hard-fails processing the inbound, and **no revert is created** — so the wrapper is burned on Sepolia, the unlock never runs, and 0.001 is permanently stuck. Failure point is `msg_vote_inbound.go:91` (`NormalizeForTxType` returns the error) → `handleFailedInboundValidation` at line 103, which skips the revert because `IsCEA` is true. Live record:

```json
"rawPayload": "0x50433230",  "txType": 4 (FUNDS_AND_PAYLOAD),  "isPc20": true,
"pcTx": [{ "status": "FAILED", "errorMsg": "raw_payload decoded to nil for payload tx type" }],
"outboundTx": []    ← no revert outbound
```

## Root cause — two halves, both chain-side, both confirmed from bytes

**Half 1 (gateway, Solidity):** the CEA sent an *empty* payload; the gateway prepends the PC20 selector and then classifies txType on the **prefixed** bytes. The decoded event proves it: `payload = 0x50433230` (exactly 4 bytes, length word `0x…04` in the raw log) with `txType = FUNDS_AND_PAYLOAD`. A bare burn should classify as FUNDS.

**Half 2 (node, Go):** the payload-type handler strips the selector and checks emptiness — against the wrong representation:

```go
// x/uexecutor/types/inbound.go:60-76
isPC20, userPayload := RouteInboundPayload(p.RawPayload)
// StripSelector("0x50433230") returns "0x" — NOT "" (pc20.go:53 → "0x" + p[8:])
if userPayload != "" {                      // "0x" slips through
    decoded, err := DecodeRawPayload(userPayload, ...)  // "0x" → (nil, nil): no error
    if decoded == nil {
        return fmt.Errorf("raw_payload decoded to nil for payload tx type")   // line 72 — hard fail
    }
}
```

**The decode did not fail — it succeeded and reported "empty".**

This is not inferred from reading the code. Running the node's own functions against the exact recorded inbound (`go test ./x/uexecutor/types/`, at commit `71d3a569`) produces:

```
step 1  RouteInboundPayload("0x50433230") -> isPC20=true  userPayload="0x"
        userPayload == ""   ? false
        userPayload == "0x" ? true          <- slips past the emptiness guard

step 2  DecodeRawPayload("0x")  -> decoded=<nil>, err=<nil>
        decoder SUCCEEDED and reported "no payload"; no parse was attempted

step 3  NormalizeForTxType()    -> "raw_payload decoded to nil for payload tx type"
        matches the on-chain error_msg exactly? true

control A  same inbound with RawPayload == ""      -> err = <nil>   (legal today)
control B  genuinely malformed payload "0xzz"      -> "hex decode: invalid byte 'z'"
control C  guard `!= "" && != "0x"` enters decode? -> false          (brick avoided)
```

**Control B is the direct refutation of "the payload encoding is not in proper structure as universal payload."** A structurally-bad payload produces a *different* error — `"failed to decode raw payload: hex decode: …"` from line 69. The recorded failure is the line-72 message, which is only reachable when the decoder returned **no error at all**. The bytes were never rejected as a structure; the decoder short-circuited on emptiness and the caller treated its success sentinel as fatal.

**Control A is the clincher:** the identical inbound with `RawPayload == ""` normalizes cleanly. A payload-typed inbound carrying no user payload is already a fully supported state — it fails only when that same emptiness is spelled `"0x"`.

The reproducing test is available on request; it is ~70 lines and needs no fixtures beyond the recorded fields.

The SDK payload is not a factor: empty is the *correct* encoding of funds-only, and the 4-byte payload on the wire was manufactured by the gateway.

**Update 2026-07-30 — the Solana gateway has the identical Half-1 flaw.** A simulated pure PC20 burn through `send_universal_tx` (devnet program with the optional-rate-limit fix, d5f6334) emits `payload = 0x50433230` (exactly 4 bytes) with `tx_type = FundsAndPayload` — the SVM gateway also prepends the selector and classifies on the prefixed bytes (`deposit.rs` `route_pc20_universal_tx` → `pc20_prefixed_payload`). Any payload-less PC20 burn from Solana walks into the same Half-2 brick on Push. Practical consequence for the fix: **the node-side one-liner (Half 2) covers both VMs at once**; fixing only the EVM gateway's classification leaves Solana bricking. The SDK now shields its own traffic on both VMs (R3 always-forward on both; Solana R1 imports are routed through the funds+payload path so the payload is never empty) — raw integrations on either VM still hit it.

## Impact

Funds-loss class: **any** payload-less PC20 CEA burn bricks, 100% deterministic, with no auto-revert. The SDK now always attaches a Push-side forward payload, so SDK traffic no longer triggers it — but any direct integration will, every time. One real casualty already: the 0.001 above, kept intact as a repro.

## Fix

**Correction (2026-07-31):** an earlier version of this doc said "either half alone prevents the brick" and offered the gateway-side classification change as an alternative. **That was wrong, and the gateway-only change would be a regression** — see "Why the gateway-side fix is not an option" below. The node-side guard is the only correct fix.

1. **One-liner (node) — the fix.** In `x/uexecutor/types/inbound.go:65`, honour the decoder's own contract. `DecodeUniversalPayloadEVM` deliberately returns `(nil, nil)` for an empty payload (`decode_payload.go:117-124`) — that is its "nothing to decode, this is fine" sentinel, not a failure. The caller then treats that success sentinel as fatal at line 71. Any of these fixes it:
   - `if userPayload != "" && userPayload != "0x"` at line 65, or
   - make `StripSelector` return `""` when no bytes remain (`pc20.go:53` currently returns `"0x" + ""`), or
   - at line 71, treat `decoded == nil && err == nil` as "no payload" instead of an error — closest to the decoder's stated contract.

   Precedent in the codebase: the validator already guards this exact representational hazard for a sibling field — `event_processor.go:308` reads `if eventData.VerificationData == "" || eventData.VerificationData == "0x"`. The payload path just never got the same treatment.

2. **Safety net (see the CEA note below):** a normalize/validate failure on a funds-bearing inbound currently produces no revert when `IsCEA` is true, so the failure mode is permanent funds loss rather than delay.

3. **The stuck inbound:** record is intact — replay after fix (1), or revert it; either recovers the 0.001.

## Why the gateway-side fix is not an option

Making the gateway classify a bare PC20 burn as `FUNDS` (instead of `FUNDS_AND_PAYLOAD`) does not fix the brick — it silently breaks the PC20 unlock, because **the unlock is only reachable from the payload route**. Two hard dependencies, both verified in the node source:

- `IsPc20` is set in exactly one place on the inbound side: `inbound.go:62`, inside the `FUNDS_AND_PAYLOAD / GAS_AND_PAYLOAD` branch of `NormalizeForTxType`. The `default:` branch (line 78-83) wipes `RawPayload` and never sets the flag. The universal validator does not set it either — `event_processor.go:287-298` builds the `Inbound` without an `IsPc20` field at all.
- `creditInboundFunds` — the only inbound caller of `unlockPC20` (`handler.go:106`) — is called exclusively from `execute_inbound_funds_and_payload.go`. The plain-FUNDS executor (`execute_inbound_funds.go:24`) calls `depositPRC20` unconditionally, with no PC20 branch.

So a PC20 burn classified as `FUNDS` would route to `depositPRC20(assetAddr = the wrapper address)` — a token with no PRC20 mapping — and the VaultPC20 unlock would never run. Same funds loss, but reached by a path that may not fail loudly. **Keep the gateway prepending the selector and keep the `FUNDS_AND_PAYLOAD` classification; fix the node-side guard.**

## Why no revert was created (confirmed)

`handle_failed_inbound_validation.go:41` gates revert creation on `if !inbound.IsCEA` — **CEA inbounds never get an `INBOUND_REVERT` outbound**, by explicit design (the comment cites consistency with `execute_inbound_funds_and_payload.go`, which likewise records a FAILED PCTx and no revert). That is exactly what the on-chain record shows: one FAILED `pc_tx`, empty `outboundTx`.

Worth a separate decision, because it is not PC20-specific: for any funds-bearing CEA inbound, the source-chain funds are already gone (burned or escrowed) *before* Push processes the inbound. Combined with "no revert for CEA", **any** normalize- or validate-stage failure on such an inbound is unrecoverable by design — this bug is one instance of a general class. A revert path for CEA inbounds (or an explicit quarantine/replay mechanism) would turn that class from funds-loss into delay.

## Reading note

Solidity `TX_TYPE` and chain-proto `TxType` number differently (Solidity FUNDS=2/F+P=3; proto FUNDS=3/F+P=4) — event `txType=3` and the record's `txType: 4` are the *same* classification, not a discrepancy.
