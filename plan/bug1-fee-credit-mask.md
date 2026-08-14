# Bug 1 — PC20 return (wrapper burn → unlock): fee credit fails, masked as a gas error

## Reproduction bookmark — verified 2026-08-12

Keep the normal checkout on the latest `main`; reproduce from an isolated detached
worktree at the last known pre-fix SDK commit:

- **Pre-fix commit:** `1daf4c76f68736d51f6eba164a9c5e6cfdcf3204`
  (`1daf4c7 fix(core): pc20 e2es and bug fixes`)
- **SDK fix commit:** `6fb6cc2b8f85b210c34a74b1aa8b213883312449`
  (`6fb6cc2 fix(core): pc20 bug fix`)
- **Focused E2E:** `packages/core/__e2e__/evm/pc20/pc20-inbound.spec.ts`
- **Focused test:** `PC20 inbound — EVM wrapper burn burns the wrapper and unlocks the Push-native token`

Safe replay procedure:

```bash
repro_dir=$(mktemp -d /tmp/push-bug1-repro.XXXXXX)
git worktree add --detach "$repro_dir" 1daf4c76f68736d51f6eba164a9c5e6cfdcf3204
ln -s "$PWD/packages/core/.env" "$repro_dir/packages/core/.env"
cd "$repro_dir"
yarn install --immutable
node ./node_modules/jest/bin/jest.js \
  packages/core/__e2e__/evm/pc20/pc20-inbound.spec.ts \
  -t '^PC20 inbound — EVM wrapper burn burns the wrapper and unlocks the Push-native token$' \
  --runInBand
```

RPC compatibility note: if the old commit attempts an unconfigured viem/dRPC
transport, temporarily change each `http(rpcUrl)` in
`packages/core/src/lib/orchestrator/cea-utils.ts` to
`http(rpcUrl ?? CHAIN_INFO[chain].defaultRPC[0])` inside the disposable worktree.
Do not commit that compatibility-only edit.

Expected result:

1. Sepolia gateway emits two `UniversalTx` logs.
2. The first log is the PC20 burn/unlock leg and its Push transactions succeed.
3. The second log is the native fee-credit `FUNDS` leg with recipient `0x0`; its
   PC transaction fails with `depositPRC20Token ... intrinsic gas too low`.
4. Jest still reports **PASS**, because `sendToleratingFeeCreditBug` catches this
   exact known failure. The failed second UTX—not Jest's exit code—is the proof.
5. The fee-credit amount is subsequently refunded to the originating EOA.

Derive each UTX ID with:

```text
0x + sha256("eip155:11155111:<sepolia-gateway-tx-hash>:<decimal-log-index>")
```

Latest reproduction evidence (2026-08-12):

- Sepolia gateway tx: `0x821cee3b7bf124949be64b930c1e2a934918b5a87919119b8bd3f588fa7ac13b`
- Burn/unlock log `688`, succeeded UTX:
  `0x6cf7cd606c8d4f2f21c333182cf17b9ce1d33770ec04f5814a9f1f183e050e0f`
- Fee-credit log `689`, failed UTX:
  `0xd64f155515d49e3f4d8b1a72c251d0774e3bc3485bda790a818374274426e7f5`
- Successful Sepolia refund tx:
  `0x58954e8e99c5db5439367507067b2302665be6c6970c2b5af7a54f090a5eb935`
- Refund outbound/sub-tx ID:
  `0x33de2ad557dbb0f75333e43c05bada9caefce49e6c648307a5db1b619fa97be7`

Cleanup after collecting evidence:

```bash
cd /path/to/push-chain-sdk
git worktree remove --force "$repro_dir"
git worktree prune
```

> ## Correction — 2026-07-31 (supersedes the root-cause section below)
>
> **Nilesh was right and my original root cause was wrong.** The second inbound fails because its `recipient` is the **zero address**, not because of a transient revert. Proven by eth_call from the ue module address on Donut:
>
> | call | result |
> |---|---|
> | `depositPRC20Token(pETH, 529361008326850, 0x0)` | **reverts** |
> | `depositPRC20Token(pETH, 529361008326850, UEA)` | **succeeds** |
>
> My "the identical call succeeds today, so the revert was transient" claim came from simulating with the **UEA** as recipient — an assumption I made instead of reading the recipient off the inbound record, which plainly says `recipient: 0x000…000`. That invalidated the conclusion.
>
> **Why it happens (gateway, `UniversalGateway.sol`).** `_routePC20Tx` forwards the post-fee native value as a **FUNDS** request while copying `req.recipient` verbatim (line 453-464). The ERC20 route does the opposite: it sends excess native value down the **GAS** path (line 529-530, `gasRecipient = fromCEA ? _req.recipient : address(0)`), where `address(0)` is the documented "attribute funds to the caller's UEA" sentinel. On the FUNDS path the chain deposits straight to `inbound.Recipient` (`execute_inbound_funds.go:24`), so zero is taken literally and the mint reverts. That asymmetry is why only PC20 hits this: it is the one route that sends a gas top-up as FUNDS.
>
> **What is still true from the original analysis:** the Gas:0 mask. The real revert reason was discarded and surfaced as "intrinsic gas too low", which is what made this hard to diagnose. That is a real diagnostics defect worth fixing on its own — but it is the *mask*, not the *cause*.
>
> **Fixed SDK-side, verified live.** A PC20 burn now names the UEA in `req.recipient` instead of the zero sentinel. Confirmed end to end on burn tx `0xf35f7a346354aab3db57ae8f03bb463cf3eba9ce5f5948bbc6707ebf2bb33b88`:
>
> | leg | `inbound.recipient` | txType | pcTx |
> |---|---|---|---|
> | PC20 burn (log 377) | `0x0` — chain zeroes it for non-CEA payload inbounds, so naming the UEA is a no-op here exactly as expected | 4 (FUNDS_AND_PAYLOAD) | **SUCCESS** |
> | fee credit (log 378) | `0x5C70C864…` (the UEA) | 3 (FUNDS) | **SUCCESS** — previously FAILED |
>
> No revert outbounds on either leg, and `sendTransaction()` no longer throws. The prepaid deposit is credited. E2E tolerance for this bug is now off by default.
>
> **Still worth fixing in the gateway:** `_routePC20Tx` should route the excess as `TX_TYPE.GAS` like the ERC20 path, so raw integrations that pass `address(0)` — the documented sentinel — don't silently lose the deposit.

**Status:** SDK-side fixed 2026-07-31; gateway hardening + the Gas:0 mask still open
**Reported:** 2026-07-29
**Severity:** High — every PC20 return misreports as failed and loses the prepaid gas deposit
**Evidence tx:** Sepolia `0xcdd2b0ce00bc0826604db52d040566ac7910750bfad01563a78cfb4e55b907b3`
**UTX ids** (derived `sha256("eip155:11155111:<txHash>:<logIndex>")`, formula cross-checked against a known record):
- Inbound #1 — PC20 burn, logIndex 749, **succeeded**: `0x9b9fdd595320ce1c21d4e46fdfc95700b3469eb7f1822607ff4f0583727e88f0`
- Inbound #2 — fee credit (FUNDS), logIndex 750, **the failing one**: `0x79c9302cf16c6efe78ff829eeba647ddefda4432865168d31e182a57a8aa84b5`

## What we're trying to do

The **return leg of a PC20 token**. A user holds a PC20 wrapper on Sepolia (previously exported from Push) and burns it to get the canonical Push-native token back:

```
user wallet (Sepolia)                    Push Chain
  sendUniversalTx(                        inbound #1: burn observed → VaultPC20.unlock
    token  = wrapper,                       → canonical token → recipient  ✅
    amount = 0.001,
    payload = UEA payload,                inbound #2: attached ETH → credited as pETH
    value  = ~0.0005 ETH  ──────────────    via UniversalCore.depositPRC20Token  ❌
  )        (prepaid Push gas — standard R1 flow)
```

One user tx → the gateway emits **two** inbounds: the PC20 burn, and a FUNDS inbound for the attached ETH (`_routePC20Tx → _sendTxWithFunds`).

## The SDK flow, step by step — and exactly where it fails

The developer-facing call that starts everything:

```ts
await pushChainClient.universal.sendTransaction({
  to: '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D',      // Push recipient (here: the UEA)
  funds: {
    amount: 1000000000000000n,                            // 0.001
    token: {
      chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,            // where the wrapper lives
      address: '0x81E05001A1f3fB574E18c1B0b2596163c68144ae',
    },
  },
});
```

| # | Stage | Actor | What happens | Status |
|---|---|---|---|---|
| 1 | **PC20 resolution** | SDK | `{chain, address}` resolved against UniversalCore: `getPC20Source(wrapper)` → RAIN, reverse-checked via `getPC20Wrapper(RAIN)`; `pc20Metadata()` read; signer chain must equal `token.chain` | ✅ |
| 2 | **Route detection** | SDK | Route 1 (UOA → Push), funds-only branch | ✅ |
| 3 | **UEA + nonce** | SDK | UEA `0x5C70C8…ab8d` resolved, nonce **58** (visible in the decoded payload) | ✅ |
| 4 | **Gas-deposit sizing** | SDK | Prepaid Push-gas deposit computed = **529361008326850 wei** (~$1 USD-floor sizing; hook `103-03-01 Adjusting Prepaid Deposit to be >$1` fired) — this becomes `msg.value` | ✅ |
| 5 | **Payload build** | SDK | `UniversalPayload{ nonce 58, vType 1, data: UEA_MULTICALL + [ RAIN.transfer(UEA, 0.001) ] }` — transfers the **resolved Push-native token**, never the wrapper; signed by the user's key | ✅ |
| 6 | **Approval** | SDK | **Deliberately none** — the gateway's PC20Factory burns via `burnFrom`, no allowance needed (verified: wrapper allowance to the gateway is 0 before and after) | ✅ |
| 7 | **Submission** | SDK → Sepolia | `sendUniversalTx(req{token=wrapper, amount, payload, revertInstruction}, value=deposit)` to gateway `0x05bD7a3D…281A`; 1 confirmation awaited | ✅ |
| 8 | **Gateway processing** | Sepolia gateway | Wrapper burned (`burnFrom`), `PC20` selector prepended, **two** `UniversalTx` events emitted: PC20 burn (676B payload) + FUNDS for the attached ETH (empty payload) | ✅ |
| 9 | **Inbound #1 (PC20 burn)** | Push chain | `isPc20=true` routing → `unlockPC20` → VaultPC20 −0.001 → recipient +0.001; our payload decoded and executed | ✅ |
| 10 | **Inbound #2 (fee credit)** | Push chain | `depositPRC20Token(pETH, 529361008326850, UEA)` — **reverts during gas estimation; the Gas=0 mask turns it into "intrinsic gas too low"; deposit never credited** | ❌ **← THE FAILURE** |
| 11 | **Status tracking** | SDK | ~~`queryUniversalTxStatusFromGatewayTx` finds the UTX carrying the FAILED pcTx from step 10 → SDK throws `PushChainExecutionError`~~ **Fixed SDK-side 2026-07-31** — the SDK now tracks the step-9 (PC20 burn) UTX instead of the step-10 fee-credit UTX, and reports the transfer's real status | ✅ (was ⚠️) |

**Where the SDK's responsibility ends:** everything through step 7 is SDK-constructed and verified byte-correct (payload decoded below). Steps 8–9 prove the chain consumed our bytes successfully. The failure at step 10 involves **no SDK input at all** — `depositPRC20Token`'s calldata is built by `x/uexecutor` from the event and token config.

**What the developer experiences — updated 2026-07-31.** Previously `sendTransaction()` threw with the masked error after ~45s even though the tokens had arrived. That half turned out to be **our bug, and it is now fixed**; an earlier version of this doc wrongly stated "there is no SDK-side mitigation possible."

The SDK selected which UTX to track with "use the last gateway log" (`response-builder.ts`). A PC20 return emits two gateway events — the PC20 burn (log 749) and then the fee-credit FUNDS leg (log 750) — so "last" picked the *fee-credit* leg, i.e. precisely the one this bug fails. Solana had the same defect from the other direction: its selector deliberately returns the *second* gateway event, which is likewise the gas/funds leg. Both now identify the PC20 leg by its `PC20` payload selector (position-independent, so a change in emission order cannot reintroduce it), and non-PC20 flows keep the previous behaviour.

**What remains chain-side:** the ~0.0005 ETH deposit is still silently uncredited. No SDK change can recover it — `depositPRC20Token`'s calldata is chain-constructed and the credit happens (or doesn't) entirely on Push. So the fix below is still needed; what changed is that the failure is no longer *also* misreported as a failed transfer.

## Exact payload the SDK sent (verbatim from the tx)

`req.payload` — 672 bytes, ABI-encoded `UniversalPayload` (no selector; the gateway prepends `PC20` itself):

```
0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000098968000000000000000000000000000000000000000000000000000000002540be4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003a00000000000000000000000000000000000000000000000000000002540be3ff000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001442cc2842d00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000014693f665ce282a451ba9a86f2ec04b43f931145000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000005c70c864cf1adfb04a0e107ffa248ba3600eab8d00000000000000000000000000000000000000000000000000038d7ea4c680000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

Decoded: `UniversalPayload{ to: 0x0 (multicall marker), value: 0, gasLimit: 0x989680 (10M), nonce: 0x3a (58), deadline: 0x2540be3ff, vType: 1, data: 0x2cc2842d (UEA_MULTICALL) + Multicall[1]{ to: 0x14693f…1145 (RAIN, Push-native ✓), calldata: a9059cbb = transfer(0x5c70c8…ab8d /*UEA*/, 0x038d7ea4c68000 /*0.001*/) } }`. The wrapper appears nowhere in the payload — correct by design.

Alongside it: `req.token = 0x81E05001…44ae` (wrapper), `req.amount = 1000000000000000`, `msg.value = 529361008326850` wei.

## What is working

Verified from the evidence tx:

- Gateway takes the PC20 burn path, burns the wrapper (no approval needed), prepends the `PC20` selector, emits both events correctly
- Chain routes inbound #1 as PC20 (`isPc20: true`) and **unlocks correctly**: VaultPC20 −0.001, recipient UEA +0.001 — conservation exact
- The 672-byte payload above decodes and executes on chain — inbound #1 fully succeeded

## What failed

Inbound #2 — crediting the attached ETH (event[1]: `token=0x0, amount=529361008326850, txType=FUNDS, payload=0x`). Its pcTx dies with:

```
contract call failed: method 'depositPRC20Token', contract '0x…C0': apply message: intrinsic gas too low
```

Consequences: the ~0.0005 ETH deposit is **never credited** (verified — UEA pETH balance doesn't reflect it). This hits **every** PC20 return with a prepaid deposit, i.e. all of them.

The secondary consequence — every tracker reporting the *whole transfer* as failed — was our own leg-selection bug and is fixed as of 2026-07-31 (see above). Any integrator that keys off "is there a FAILED pcTx anywhere under this gateway tx" will still see the failed fee-credit leg, so the explorer and any custom tracking need the same distinction.

## Root cause

The error is a **mask**. The failing internal call (byte-exact, chain-constructed — takes no input from the SDK payload):

```
from: 0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7  (ue module)
to:   0x…C0
data: 0x64f10e50 | pETH 0x2971824d…5809 | amount 0x1e17376dbf8c2 | UEA 0x5c70c864…ab8d
```

Path: `execute_inbound_funds.go:24 → handler.go:14 depositPRC20 → evm.go:333 DerivedEVMCall(gasLimit=nil)`. With nil gas, `DerivedEVMCallWithData` estimates first — and the call **reverted during estimation**, hitting this branch in the `pushchain/evm` fork:

```go
// x/vm/keeper/grpc_query.go (~446): revert-at-cap
return &EstimateGasResponse{Ret: result.Ret, VmError: result.VmError}, nil  // Gas=0, err=nil

// x/vm/keeper/call_evm.go: caller never checks VmError
gasCap = gasRes.Gas   // ← 0 → real call runs with GasLimit 0
// → state_transition.go:439: leftoverGas < intrinsicGas → "intrinsic gas too low"
```

The real revert reason was in `gasRes.Ret` and was discarded. **The identical eth_call from the module address succeeds today** (random EOA correctly gets `CallerIsNotUEModule` = `0x53e51723`), so the revert was transient to the processing context — note that `Internal`-type estimates run on the **raw cosmos ctx** (no CacheContext, unlike the RPC path), and this estimate ran immediately after the unlock's derived call in the same sequence.

**Where to look in node logs:** grep for `EVM call: depositPRC20Token` (`handler.go:40`) around the Donut blocks processing this tx (~block 20281350 era).

## Fix

In `DerivedEVMCallWithData`: after `EstimateGasInternal`, check `gasRes.VmError` and surface the revert with its `Ret` bytes instead of proceeding with `Gas: 0`. One conditional — it fixes the misreport for **all** internal derived calls (this isn't PC20-specific) *and* exposes the underlying transient revert for diagnosis.

## Repro

Any PC20 wrapper burn with nonzero attached ETH. 100% hit rate in our runs; SDK test suites currently pass only via an explicit known-bug tolerance flag (`TOLERATE_FEE_CREDIT_BUG` in `packages/core/__e2e__/shared/pc20-fixtures.ts`) which we will flip off when this ships.

## Version note

Code refs are from `pushchain/evm` at `v1.0.0-rc2.0.20260627105801` (the `push-chain` go.mod pin). If validators run a newer fork build, line numbers may shift, but the observed error string is produced by exactly this mechanism.
