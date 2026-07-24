# PC20 Backend and SDK Implementation Plan

**Status:** Ready for implementation  
**Prepared:** 2026-07-24  
**Primary repository:** `push-chain-sdk`  
**Target package:** `@pushchain/core`

## 1. Goal

Add first-class PC20 support to the universal transaction SDK so a caller can:

1. Burn a deployed PC20 wrapper on an external chain and receive the canonical
   Push-native PC20 on Push Chain.
2. Include optional Push Chain calldata in the same transaction.
3. Export a Push-native PC20 to a supported EVM or SVM chain.
4. Resolve an external PC20 wrapper to its canonical Push Chain token.
5. List the confirmed external deployments of a Push-native PC20.
6. Reject chain/address combinations that do not identify the same registered
   PC20 deployment.

The primary inbound API must support:

```ts
const txResponse = await pushChainClient.universal.sendTransaction({
  to: '0xRecipientAddress',
  data,
  funds: {
    amount: PushChain.utils.helpers.parseUnits('1', 6),
    token: {
      chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      address: '0xPC20WrapperAddress',
    },
  },
});
```

The same token-reference shape should support Push-to-external exports:

```ts
const txResponse = await pushChainClient.universal.sendTransaction({
  to: {
    chain: CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
    address: '0xRecipientAddress',
  },
  funds: {
    amount: PushChain.utils.helpers.parseUnits('1', 6),
    token: {
      chain: CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
      address: '0xPushNativePC20Address',
    },
  },
});
```

## 2. Reference implementations

Implementation must follow the behavior in these repository revisions:

| Repository | Reference | Relevant behavior |
| --- | --- | --- |
| `push-chain` | `29135ae9` (`feat/pc20` merge) | PC20 selectors, inbound/outbound routing, protobuf fields, EVM/SVM settlement |
| `push-chain-core-contracts` | `4e46a52` (`pc20-changes`) | UniversalCore PC20 registry, factory mapping, deployment-aware gas quote |
| `push-chain-gateway-contracts` | `origin/pc20-3rd-iteration` at `979dc5b` | Unified UGPC export, VaultPC20, EVM PC20 factory/wrapper, SVM PC20 generic gateway integration |

The checked-out gateway testnet branch is not a complete substitute for
`pc20-3rd-iteration`: it contains the external-chain wrapper/burn work but not
the complete Push-side unified export implementation.

### 2.1 Repository preparation state

The local reference repositories were aligned after this plan was written:

| Repository | Local branch | State |
| --- | --- | --- |
| `push-chain` | `testnet/donut` | Fast-forwarded to `origin/testnet/donut` at `71d3a569`; contains PC20 merge `29135ae9` |
| `push-chain-core-contracts` | `core-testnet-pc20-changes` | At `4e46a52`, tracking its remote |
| `push-chain-gateway-contracts` | `pc20-3rd-iteration` | At `979dc5b`, tracking `origin/pc20-3rd-iteration` |
| `push-chain-sdk` | `prc20-sdk-fixes` | Plan added; implementation not started |

The core-contract branch tracks both
`src/Interfaces/IUniversalCore.sol` and
`src/interfaces/IUniversalCore.sol` with different blobs. They collide on the
default case-insensitive macOS filesystem. The active lowercase PC20 interface
is preserved locally and the stale uppercase index entry is marked
`skip-worktree` so the checkout is clean.

`skip-worktree` is a local macOS workaround only. Linux CI checks out both
blobs and will compile the stale uppercase interface. Removing the obsolete
uppercase duplicate upstream is a **blocking prerequisite for PR 1**, not a
deferred cleanup.

### 2.2 Protocol selectors

| Route | ASCII | Hex |
| --- | --- | --- |
| PC20 | `PC20` | `0x50433230` |
| PRC20 | `PRC2` | `0x50524332` |

Inbound and outbound selector ownership differs:

- External-to-Push PC20: the external gateway prepends `PC20`; the SDK must not
  prepend it.
- Push-to-external PC20: the SDK must build the PC20-prefixed outbound payload
  passed to `sendUniversalTxOutbound`.

### 2.3 UniversalCore is authoritative

PC20 cannot be represented by a static SDK token map. UniversalCore contains
the live bidirectional registry:

```solidity
getPC20Wrapper(address sourceAsset, string destChain)
    returns (bytes32 wrapper, bool deployed);

getPC20Source(bytes32 wrapper, string destChain)
    returns (address sourceAsset, bool known);

pc20FactoryByChain(string chainNamespace)
    returns (bytes32 factory);

getPC20ExportGasAndFees(
    string destChainNamespace,
    uint256 gasLimit,
    address pc20Token
)
    returns (
        address gasToken,
        uint256 gasFee,
        uint256 protocolFee,
        uint256 gasPrice,
        string chainNamespace,
        uint256 gasLimitUsed,
        bool isFirstExport
    );
```

Registry address encoding is VM-specific:

- EVM: the 20-byte address is left-padded to `bytes32`.
- SVM: the raw 32-byte Solana public key is stored directly.

## 3. Public SDK API

### 3.1 Funds token type

Add a PC20 chain/address reference without breaking `MoveableToken`:

```ts
export type PC20TokenReference = {
  standard: 'pc20';
  chain: CHAIN;
  address: string;
};

export type FundsToken = MoveableToken | PC20TokenReference;
```

Update `ExecuteParams.funds`:

```ts
funds?: {
  amount: bigint;
  token?: FundsToken;
};
```

Existing `MoveableToken` objects continue through the PRC20/native path
unchanged.

#### Discrimination rule

The union must be discriminated by an explicit literal tag, not by structural
shape. `MoveableToken` (`lib/constants/tokens.ts`) currently requires `symbol`,
`decimals`, `address`, and `mechanism`, so a `{ chain, address }` object is
structurally distinguishable *today* — but that is incidental. Any future
optional field added to `MoveableToken` collapses the union silently.

Therefore:

- `PC20TokenReference` carries `standard: 'pc20'`.
- Exactly one runtime predicate exists, exported from the resolver:

```ts
const isPC20Reference = (t: FundsToken): t is PC20TokenReference =>
  (t as PC20TokenReference).standard === 'pc20';
```

- For one release, accept an untagged `{ chain, address }` as PC20 for developer
  ergonomics, but emit a deprecation warning and require the tag thereafter.
  No other module may re-derive the check by inspecting fields.

#### Push-chain address ambiguity

`{ chain: PUSH_TESTNET_DONUT, address }` is ambiguous: it can be a Push-native
PC20 **or** a synthetic PRC20 (which `PushChain.utils.tokens.getPRC20Address`
already accepts in `{ chain, address }` form — see `lib/utils.ts:767`).

Users will pass a PRC20 address here. The resolver must detect that case
specifically and throw `PC20ExpectedButPRC20Error`, naming the correct
`MoveableToken` API in the remediation hint. It must not surface a generic
"invalid PC20 metadata" failure, and it must not be lumped in with the
"ordinary ERC20" rejection in §5.4.

### 3.2 Resolve an external deployment to Push PC20

Add an asynchronous utility:

This resolves in both directions, so the result carries an explicit
`direction` field rather than leaving the caller to infer which case they hit.

```ts
const pc20 = await PushChain.utils.tokens.getPC20Address(
  {
    chain: CHAIN.ETHEREUM_SEPOLIA,
    address: '0xWrapperAddress',
  },
  {
    network: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls,
  }
);
```

Recommended result:

```ts
type PC20AddressResult = {
  /** 'wrapper' = external wrapper resolved to Push source.
   *  'push'    = a Push-native PC20 was supplied and validated. */
  direction: 'wrapper' | 'push';
  address: `0x${string}`;
  chain: CHAIN;
  name: string;
  symbol: string;
  decimals: number;
  network: PUSH_NETWORK;
  deployment?: {
    chain: CHAIN;
    chainNamespace: string;
    address: string;
    vm: VM;
  };
};
```

`deployment` is present only when `direction === 'wrapper'`.

Rules:

- This utility is asynchronous.
- A static utility call requires an explicit Push network.
- An internal transaction call uses the initialized client's Push network and
  configured Push RPC.
- The result comes from UniversalCore, not symbol matching or
  `MOVEABLE_TOKENS`.
- Passing a Push Chain PC20 address may return the same address after validating
  `pc20Metadata()`.

### 3.3 List confirmed wrapper deployments

Add:

```ts
const result = await PushChain.utils.tokens.getPC20Deployments(
  '0xPushNativePC20Address',
  {
    network: PUSH_NETWORK.TESTNET_DONUT,
    chains: [
      CHAIN.ETHEREUM_SEPOLIA,
      CHAIN.ARBITRUM_SEPOLIA,
      CHAIN.BASE_SEPOLIA,
      CHAIN.BNB_TESTNET,
      CHAIN.SOLANA_DEVNET,
    ],
    rpcUrls,
  }
);
```

Recommended result:

```ts
type PC20Deployment = {
  chain: CHAIN;
  chainNamespace: string;
  vm: VM;
  address: string;
  rawAddress: `0x${string}`;
};

type PC20DeploymentsResult = {
  pc20Address: `0x${string}`;
  network: PUSH_NETWORK;
  deployments: PC20Deployment[];
};
```

UniversalCore has no enumerable chain collection. The SDK must query
`getPC20Wrapper` for the requested chains, or all SDK-supported external chains
when `chains` is omitted.

Every one of those reads targets UniversalCore on Push Chain — a single
contract on a single RPC. They must therefore be issued as **one multicall**
against the Push RPC, not N parallel round trips. Omitting `chains` must not
scale round-trip count with chain count.

Only confirmed deployments are returned by default. The internal outbound
builder may separately calculate a predicted address for a first export.

## 4. Internal architecture

### 4.1 Central PC20 resolver

Create one registry/resolution module used by:

- `sendTransaction`
- `prepareTransaction`
- cascade construction
- `getPC20Address`
- `getPC20Deployments`
- outbound tracking fallback

Recommended internal shape:

```ts
type ResolvedFundsToken = {
  standard: 'native' | 'prc20' | 'pc20';
  direction: 'import' | 'export';
  originChain: CHAIN;
  originAddress: string;
  pushAddress: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  wrapperAddress?: string;
  chainNamespace?: string;
};
```

Resolve once before building payloads, allowances, gas quotes, progress events,
or response metadata. Pass this descriptor through the internal execution
path. Do not mutate the caller's token object into a fake `MoveableToken`.

Prepared transactions must revalidate critical registry and signer-chain state
at send time. Negative registry results must not be cached indefinitely because
the first successful export creates a new deployment mapping.

### 4.2 ABI additions

Extend `UNIVERSAL_CORE_EVM` with:

- `getPC20ExportGasAndFees`
- `pc20Deployed`
- `getPC20Wrapper`
- `getPC20Source`
- `pc20FactoryByChain`
- `pc20DeploymentGasOverhead`

Add minimal ABIs for:

- `IPC20.pc20Metadata`
- `PC20Factory.getWrapper`
- `PC20Factory.wrapperToSource`
- `PC20Factory.isPC20Wrapper`
- `PC20Factory.computeWrapperAddress`
- `PC20Wrapper.SOURCE_ASSET`
- `PC20Wrapper.factory`
- external gateway `pc20Factory`

The existing eight-field `sendUniversalTxOutbound` ABI remains valid.

### 4.3 Address codecs

Add tested helpers:

```ts
pc20AddressToBytes32(chain: CHAIN, address: string): `0x${string}`;
pc20Bytes32ToAddress(chain: CHAIN, value: `0x${string}`): string;
```

EVM rules:

- Require a valid 20-byte address.
- Reject the zero address.
- Convert to a checksummed address on output.
- Left-pad to 32 bytes for UniversalCore.

SVM rules:

- Accept base58 or a 32-byte `0x` hex value.
- Reject `PublicKey.default()`.
- Normalize to raw 32 bytes for UniversalCore.
- Return base58 on the public API.

### 4.4 Chain namespace mapping

`chainNamespace` is the key for every registry read (`getPC20Wrapper`,
`getPC20Source`, `pc20FactoryByChain`, `getPC20ExportGasAndFees`) and appears
in the public result types. It currently has no defined source of truth.

Add exactly one mapping helper and route every caller through it:

```ts
chainToNamespace(chain: CHAIN): string;
namespaceToChain(namespace: string): CHAIN | undefined;
```

Rules:

- The namespace format must match what UniversalCore is keyed on, verified
  against a deployed testnet registry entry, not assumed.
- `chainToNamespace` throws on an unsupported chain rather than returning a
  string that silently misses in the registry.
- The tracking fallback in §8 must convert `outbound.destinationChain` through
  `chainToNamespace`/`namespaceToChain` before querying. A format mismatch
  there returns a zero wrapper with `known == false`, which is
  indistinguishable from "not deployed" — so the resolver must throw
  `PC20UnknownChainNamespaceError` on an unmappable value instead of treating
  it as a negative result.
- Validation, deployment listing, gas quoting, and tracking must not each
  build the namespace string independently.

## 5. Validation model

PC20 validation must be address-and-chain based. Symbol matching is forbidden.

### 5.1 Common validation

- `funds.amount` must be greater than zero.
- `token.chain` must be a supported SDK chain.
- Address format must match the chain VM.
- Zero/default addresses must be rejected.
- The Push network must map to a configured Push Chain.
- Network and chain combinations must not silently cross mainnet/testnet.

### 5.2 Chain ownership validation

For direct external-to-Push:

```text
token.chain === universalSigner.account.chain
```

For explicit CEA-origin routes:

```text
token.chain === params.from.chain
```

For Push-to-external:

```text
token.chain === configured Push chain
```

The `to.chain` value is the destination and must not be mistaken for the
location of the funds token.

### 5.3 External wrapper validation

Given `{ chain, address }` on an external chain:

1. Convert the supplied address to the registry's `bytes32` form.
2. Query `getPC20Source(wrapper, chainNamespace)`.
3. Require `known == true` and a nonzero Push source.
4. Query `getPC20Wrapper(source, chainNamespace)`.
5. Require the returned wrapper to equal the supplied canonical address.

For EVM, additionally:

1. Read the live external gateway's configured `pc20Factory`.
2. Compare it with UniversalCore's `pc20FactoryByChain`.
3. Require `isPC20Wrapper(address) == true`.
4. Require `wrapperToSource(address)` and `SOURCE_ASSET()` to equal the Push
   source returned by UniversalCore.
5. Require deployed bytecode at the wrapper address.

These checks ensure that the same address copied onto the wrong chain cannot
pass validation and that the live gateway will take the PC20 burn path.

#### Read budget, tiering, and caching

The full set above is roughly eight contract reads plus metadata on every
send. That is not acceptable as unconditional sequential latency.

**Tier A — required on every send** (correctness-critical, cheap to batch):

1. `getPC20Source(wrapper, ns)` → `known == true`, nonzero source.
2. `getPC20Wrapper(source, ns)` → equals the supplied address.

Forward/reverse agreement already proves the address is registered for that
exact namespace, which is what defeats the wrong-chain copy-paste case.

**Tier B — factory identity** (steps 1–5 of the EVM list): largely redundant
once Tier A holds. Run it at `prepareTransaction` time, on first use of a given
`(chain, address)` in a session, and whenever a strict-validation option is
enabled. Do not run it on every repeat send of an already-verified pair.

Batching and caching rules:

- All Push-side reads (UniversalCore) must go through a single multicall.
- All external-chain reads (gateway `pc20Factory`, `isPC20Wrapper`,
  `wrapperToSource`, `SOURCE_ASSET`, `getCode`) must go through a single
  multicall on that chain.
- Positive Tier A/Tier B results are cacheable for the client's lifetime keyed
  by `(pushNetwork, chain, address)`. Registered mappings are immutable in
  practice; a factory reconfiguration is a redeploy-level event.
- Negative results must **not** be cached beyond a single call. The first
  successful export creates a mapping that did not previously exist.
- Budget: PC20 validation must add no more than **two sequential RPC
  round trips** to a send on the warm path, and no more than four cold. A
  test asserts the round-trip count.

For SVM:

1. Derive `pc20_state = PDA("pc20_state", pc20_mint)`.
2. Read and validate `Pc20State`.
3. Require its stored wrapped mint to equal the supplied mint.
4. Derive `pc20_mint = PDA("pc20_mint", source_asset_20)`.
5. Require the derived mint to equal the supplied mint.
6. Require the stored source to equal UniversalCore's source.

### 5.4 Push source validation

For a Push-native token:

1. Require deployed bytecode.
2. Call `pc20Metadata()`.
3. Require `originAddress == token.address`.
4. Require nonempty name and symbol.
5. Enforce the destination factory's UTF-8 byte limits for name and symbol.
   These limits must be read from (or asserted at build time against) the
   factory contract's own constants — currently 64 bytes for name and 32 for
   symbol. Do not hardcode the numbers in SDK logic where a factory change
   would silently desynchronize them; a unit test pins the SDK values to the
   reference contract revision.
6. Require a nonzero destination `pc20FactoryByChain`.
7. Reject an ordinary ERC20 that does not implement valid PC20 metadata with
   `InvalidPC20MetadataError`.
8. Detect a synthetic PRC20 specifically (see §3.1) and reject it with
   `PC20ExpectedButPRC20Error` pointing at the `MoveableToken` API. This is a
   distinct case from step 7 and must not share its message.

## 6. External-to-Push flow

### 6.1 EVM wrapper burn

For the requested API:

1. Resolve and validate the wrapper before any write.
2. Build the existing generic `UniversalTxRequest`.
3. Keep `req.token` equal to the external wrapper address.
4. Keep `req.amount` equal to `funds.amount`.
5. Build the Push UEA payload using the resolved Push source address.
6. Submit through the existing external gateway `sendUniversalTx`.

The SDK must not prepend `PC20`. The gateway performs:

```text
payload = "PC20" || req.payload
```

The SDK must not approve the wrapper. The configured `PC20Factory` directly
burns it:

```solidity
pc20Factory.burnFrom(sourceAsset, caller, amount);
```

If `payGasWith` is used, only the selected gas token requires approval.

### 6.2 Push UEA payload

The inbound PC20 is unlocked as the canonical Push-native token. Therefore the
automatic UEA multicall must use:

```text
ERC20(pushPC20Address).transfer(execute.to, funds.amount)
```

It must not call `getPRC20Address` for this token.

For funds plus a single `data` payload:

1. Transfer the resolved Push PC20 to `execute.to`.
2. Execute the provided calldata against `execute.to`.

For an explicit `MultiCall[]`, preserve the existing convention that the user
controls distribution, but expose the resolved token address to the internal
builder and documentation.

#### Allowance semantics of the funds-plus-data path

The tokens are transferred to `execute.to` **before** the call executes, and
the UEA grants `execute.to` no allowance. Calldata that attempts
`transferFrom(uea, ...)` — the common ERC20 deposit pattern — will therefore
revert.

This matches the existing PRC20 convention, but it is the most likely
integration mistake for PC20. It must be stated explicitly in the public
documentation and in the `sendTransaction` TSDoc, with the working pattern
(target contract reads its own received balance, or the caller supplies an
explicit `MultiCall[]` containing an approve) shown alongside.

### 6.3 Solana wrapper burn

Use the existing generic `send_universal_tx` instruction with:

```text
req.token = pc20_mint
req.amount > 0
user_token_account = caller's PC20 ATA
gateway_token_account = null
remaining_accounts = [pc20_state, pc20_mint]
```

A direct user burn pays the configured inbound fee. A CEA self-route does not
pay it again.

## 7. Push-to-external flow

### 7.1 PC20 payload

Read metadata from the Push token and encode:

```text
PC20_SELECTOR
|| abi.encode(destChainNamespace, name, symbol, decimals)
|| rawDestinationUserData
```

The outbound request continues using:

```solidity
sendUniversalTxOutbound(UniversalOutboundTxRequest req)
```

Required PC20 request behavior:

- `req.token` is the Push-native PC20.
- `req.amount > 0`.
- `req.payload` starts with `0x50433230`.
- `req.gasPrice` is zero.
- `req.revertRecipient` is nonzero.
- `req.maxPCForGas` retains existing semantics.

`revertRecipient` is set to the sender's UEA on Push Chain — the same account
that approved and whose balance was locked — so a failed export returns the
unlocked token to its origin. It is never the destination recipient, which may
not exist as a Push-side account. A zero or unresolvable UEA is a hard
validation failure before approval, not a silent fallback.

### 7.2 Gas quote

Do not call `getOutboundTxGasAndFees` for PC20. Call:

```solidity
getPC20ExportGasAndFees(
  destinationChainNamespace,
  gasLimit,
  pushPC20Address
)
```

The returned `gasLimitUsed` already includes `pc20DeploymentGasOverhead` when
`isFirstExport == true`.

The existing native-PC gas swap sizing can consume the returned gas token,
gas fee, protocol fee, and gas price. The request itself must not override
`gasPrice` on the PC20 path.

#### `isFirstExport` is time-of-check/time-of-use

The quote is read before the transaction is included. Between the two, the
deployment state can change:

- `true` at quote, deployed by another export before inclusion — the quote
  over-funds. Harmless.
- `false` at quote, wrapper absent at execution (registry rollback, factory
  reconfiguration, chain reorg) — the quote under-funds by
  `pc20DeploymentGasOverhead` and the transfer strands on the destination.

Mitigation: when sizing `maxPCForGas` on the PC20 export path, always add
`pc20DeploymentGasOverhead` on top of the returned `gasLimitUsed` regardless of
`isFirstExport`, so the ceiling covers a deployment that the quote did not
anticipate. `maxPCForGas` is a ceiling, not a charge — the unspent remainder is
not consumed, so the only cost of the margin is a higher required balance.
`gasLimitUsed` itself is passed through unchanged.

### 7.3 Approval and locking

Unlike inbound wrapper burn, Push export requires approval:

```text
approve(UGPC, 0)
approve(UGPC, amount)
sendUniversalTxOutbound(...)
```

UGPC transfers the Push token into `VaultPC20` and records the lock.

### 7.4 Destination wrapper resolution

For an existing deployment, use UniversalCore's registered wrapper.

For a first EVM export:

1. Read the registered destination factory.
2. Call `computeWrapperAddress(pushPC20Address)`.
3. Use the predicted wrapper in the destination CEA transfer payload.

For a first SVM export:

```text
pc20_mint = PDA("pc20_mint", source_asset_20)
```

The predicted address is required because destination settlement mints the
wrapper into the CEA before executing destination user data. To deliver funds
to the requested recipient, the SDK must build a wrapper `transfer()` call
using the existing or predicted wrapper address.

#### Prediction failure is a funds-at-risk path

By the time the predicted address is used, §7.3 has already approved and locked
the Push token into `VaultPC20`. A wrong prediction — factory redeployed, salt
scheme changed, wrapper implementation upgraded — produces a destination
transfer to an address with no wrapper, after the source side is committed.

Required handling:

1. Read `computeWrapperAddress` from the **live registered factory** obtained in
   the same batch as `pc20FactoryByChain`, never from a cached or
   SDK-hardcoded factory address.
2. Pin the prediction inputs: assert the live factory's wrapper implementation
   hash / init-code hash matches the revision the SDK derives against. A
   mismatch throws `PC20WrapperPredictionUnavailableError` **before** approval.
   Do not fall back to an unverified prediction.
3. Define the recovery path. A first export whose destination transfer fails
   must be recoverable through `revertRecipient` unlock, and the PC20 export
   path must be represented in `lib/orchestrator/internals/rescue.ts` — which
   this plan otherwise does not touch. Add `PC20ExportRevertedError` carrying
   the outbound tx id, the locked amount, and the revert recipient.

### 7.5 Destination execution

EVM:

- Build CEA user data that transfers the wrapper from the CEA to the requested
  recipient.
- Append caller-provided destination calldata when present.
- Use the resolved CEA as the outbound request recipient, consistent with the
  existing Route 2 execution model.

SVM:

- Validators use instruction id `5`.
- The SDK supplies the normal Push outbound request and PC20 metadata payload.
- The destination wrapper mint is the deterministic `pc20_mint` PDA.
- Optional destination execution must use the account order required by the
  signed SVM payload.

## 8. Tracking and response types

Sync the SDK's proto source with `push-chain@29135ae9` and regenerate types.
Required fields:

```text
Inbound.is_pc20                         field 14
OutboundObservation.pc20_wrapper_address field 6
OutboundTx.is_pc20                     field 22
OutboundTx.pc20_contract_address       field 23
```

Do not rely only on `external_asset_addr`:

- It is empty when a PC20 outbound is first created.
- It is normally backfilled when the destination wrapper is observed.
- A repeat export may not emit a newly deployed wrapper address.

Tracking fallback:

```text
if outbound.isPc20 && externalAssetAddr is empty:
    ns = chainToNamespace(resolveChain(outbound.destinationChain))
    wrapper = UniversalCore.getPC20Wrapper(
        outbound.pc20ContractAddress,
        ns
    )
```

`outbound.destinationChain` must be converted through the §4.4 mapping, not
passed to the registry verbatim. If the value cannot be mapped, throw
`PC20UnknownChainNamespaceError`. A wrong-format namespace returns a zero
wrapper with `known == false`, which is indistinguishable from "not yet
deployed" and would surface as a silently empty receipt field.

The final receipt should expose the chain-native wrapper address:

- checksummed EVM address
- base58 Solana mint

Existing PRC20 tracking behavior must remain unchanged.

## 9. SDK file-level work

Expected areas:

| Area | Planned work |
| --- | --- |
| `orchestrator.types.ts` | `PC20TokenReference`, `FundsToken`, public utility results, internal resolved token |
| `constants/abi` | UniversalCore PC20 functions, IPC20, PC20 factory/wrapper, gateway getter |
| new `internals/pc20-resolver.ts` | Registry reads, metadata, address codecs, factory/PDA validation |
| `utils.ts` | `getPC20Address`, `getPC20Deployments` |
| `orchestrator.ts` | Resolve before Route 1 execution; expose internal query entry points |
| `route-detector.ts` | Synchronous shape/chain checks; preserve PRC20 validation |
| `payload-builders.ts` | Resolved Push PC20 transfer and outbound selector/metadata encoder |
| `internals/payload-builder.ts` | Inbound request token versus Push execution token separation |
| `execute-funds-only.ts` | PC20 EVM/SVM burn branches and allowance behavior |
| `execute-funds-payload.ts` | PC20 funds-plus-payload branch and gas-token-only approval |
| `route-handlers.ts` | Push export resolution, PC20 quote, destination wrapper transfer |
| `cascade.ts` | Carry resolved PC20 state through prepared/composed transactions |
| `svm-bridge.ts` and SVM IDL | PC20 state/mint accounts and remaining-account order |
| generated `uexecutor` types | Regenerate PC20 protobuf fields |
| `outbound-sync.ts` | PC20 wrapper/address fallback during tracking |
| `internals/rescue.ts` | PC20 export revert/unlock recovery (§7.4) |
| new `internals/chain-namespace.ts` | Single `chainToNamespace`/`namespaceToChain` source of truth (§4.4) |
| `internals/gas-calculator.ts`, `max-pc-for-gas.ts` | PC20 deployment-overhead margin on `maxPCForGas` (§7.2) |

## 10. Delivery phases

Estimates are engineer-days for one engineer, excluding external blocker wait
time. Owners marked TBD must be assigned before Phase 1 starts.

### Phase 0: Repository and deployment alignment

**Blocking for Phases 1–3. Est. 2d of SDK work; wall-clock gated by external
owners.**

| Item | Type | Owner | Needed by | Fallback if unmet |
| --- | --- | --- | --- | --- |
| Gateway reference on `pc20-3rd-iteration` | internal | SDK (TBD) | Phase 1 start | none needed |
| Core contracts on `core-testnet-pc20-changes` | internal | SDK (TBD) | Phase 1 start | none needed |
| `push-chain` revision containing merge `29135ae9` | internal | SDK (TBD) | Phase 1 start | none needed |
| Remove duplicate `IUniversalCore.sol` upstream (§2.1) | external | core-contracts (TBD) | **PR 1 merge** | PR 1 cannot merge; Linux CI breaks |
| Donut UGPC deployed with `VaultPC20` + UniversalCore configured | external | protocol/devops (TBD) | Phase 2 E2E | Phase 2 unit work proceeds against forked-state fixtures; E2E slips |
| Each external gateway's live PC20 factory matches `pc20FactoryByChain` | external | protocol/devops (TBD) | Phase 2 E2E | as above |
| Canonical SVM IDL from the PC20 gateway revision | external | gateway (TBD) | **Phase 3 start** | Phase 3 is cut from the release (see below) |

Phase 2 unit and integration work must not block on the deployment items. Build
against recorded/forked chain state so Phases 1–2 can complete while the
environment is being provisioned.

**SVM gating decision.** Phase 3 depends on a deployed SVM PC20 program and a
canonical IDL that do not exist yet. Phase 3 is therefore **not** committed to
this release. If the IDL and a devnet deployment are not available at Phase 2
exit, ship Phases 1, 2, and 4 as EVM-only PC20 support, with SVM chains
rejected by `UnsupportedPC20DestinationError` and documented as unsupported.
This is a go/no-go decision made at Phase 2 exit, not a slip absorbed silently.

### Phase 1: Registry foundation and utilities

**Est. 6–8d. Owner: TBD. Ships as PR 1.**

- Public and internal types, including the §3.1 discriminant.
- ABI additions.
- Address codecs.
- Chain namespace mapping (§4.4).
- UniversalCore discovery with multicall batching and the §5.3 cache policy.
- `getPC20Address`.
- `getPC20Deployments`.
- Typed validation errors.
- Proto synchronization.

### Phase 2: EVM universal transaction support

**Est. 8–10d. Owner: TBD. Ships as PR 2. Unit/integration work must not block
on the Phase 0 deployment items.**

- External wrapper to Push, funds-only.
- External wrapper to Push with calldata.
- No wrapper approval.
- Push source transfer in the UEA payload.
- Push-to-EVM export.
- First-deployment wrapper prediction, including the implementation-hash pin
  and the pre-approval abort (§7.4).
- PC20 gas quoting, deployment-overhead margin, and source-token approval.
- Tracking fallback.
- Rescue path for a reverted export.

### Phase 3: SVM parity

**Est. 8–10d. Owner: TBD. Ships as PR 3. Conditional — see the Phase 0 SVM
gating decision.**

- Canonical IDL update.
- Solana mint/state resolution and validation.
- Direct Solana-to-Push PC20 burn.
- Push-to-Solana export.
- Optional destination execution.
- Base58 response normalization.

### Phase 4: Cascade and release hardening

**Est. 5d. Owner: TBD.**

- Prepared transaction revalidation.
- Cascade composition.
- Error decoding and progress metadata.
- Documentation and examples.
- Changeset/release notes.
- Full regression and cross-repository E2E runs.

## 11. Testing plan

### 11.1 Unit tests

Address and registry:

- EVM address to bytes32 and back.
- Solana base58 to bytes32 and back.
- Zero/default address rejection.
- Registered wrapper resolves to its Push source.
- Forward/reverse registry mismatch is rejected.
- Wrapper copied onto the wrong chain is rejected.
- Unknown wrapper is rejected.
- Ordinary ERC20 passed as chain/address-only PC20 is rejected.
- A synthetic PRC20 address on the Push chain is rejected with
  `PC20ExpectedButPRC20Error`, not a generic metadata error.
- Deployment listing returns only confirmed mappings.
- Deployment listing issues one multicall regardless of chain count.
- `chainToNamespace` round-trips for every supported chain and throws on an
  unsupported one.
- An unmappable `destinationChain` in tracking throws rather than yielding an
  empty wrapper.
- Warm-path PC20 validation stays within the §5.3 round-trip budget
  (asserted against a counting RPC transport).
- Positive registry results are cached; negative results are not.
- The `MoveableToken` / `PC20TokenReference` predicate discriminates correctly,
  including for an untagged `{ chain, address }` during the deprecation window.

Metadata:

- Valid `pc20Metadata()` succeeds.
- Missing `pc20Metadata()` fails.
- `originAddress` mismatch fails.
- Empty/oversized name or symbol fails.

Inbound EVM:

- Gateway request token is the external wrapper.
- Push UEA transfer token is the Push-native source.
- No wrapper approval call is produced.
- `payGasWith` approves only the gas token.
- Funds-only payload is correct.
- Funds-plus-data order is transfer then call.
- Calldata performing `transferFrom` against the UEA fails, and the failure is
  documented rather than silently produced.
- Chain mismatch fails before allowance or broadcast.
- Insufficient wrapper balance fails before broadcast (balance preflight runs
  in `internals/preflight.ts` alongside the existing checks).

Outbound EVM:

- Payload selector is exactly `0x50433230`.
- Metadata tuple and raw user data are byte-exact.
- PC20 gas quote method is selected.
- First-export deployment overhead is respected.
- Request `gasPrice` remains zero.
- Push source approval targets UGPC.
- Existing wrapper is used after deployment.
- Predicted wrapper is used before first deployment.
- A factory implementation-hash mismatch aborts before approval rather than
  using an unverified prediction.
- `maxPCForGas` includes the deployment-overhead margin even when
  `isFirstExport == false`.
- `revertRecipient` is the sender's UEA; an unresolvable UEA fails validation
  before approval.
- A reverted export is recoverable through the rescue path.
- `payGasWith` on the outbound path approves only the gas token in addition to
  the source-token approval to UGPC.
- Destination CEA wrapper transfer targets the final recipient.

SVM:

- `pc20_state` and `pc20_mint` derivations.
- State/source/mint mismatch rejection.
- Direct burn uses `gateway_token_account = null`.
- Remaining accounts are `[pc20_state, pc20_mint]`.
- Export uses instruction id `5` semantics.
- A missing recipient associated token account on the destination is created
  or reported, for both inbound burn and outbound export.

Tracking:

- Proto decoding includes all PC20 fields.
- First export resolves the observed wrapper.
- Repeat export resolves the wrapper through UniversalCore fallback.
- EVM and SVM wrapper addresses use chain-native display formats.

Regression:

- Existing PRC20/native route tests pass unchanged.
- Existing `MoveableToken` API remains source-compatible.
- Route 1, Route 2, Route 3, Route 4, and cascade PRC20 behavior remains intact.

### 11.2 End-to-end tests

1. Push PC20 to EVM first export:
   - token is locked in VaultPC20
   - wrapper is deployed
   - wrapper is minted and delivered
   - deployment utility returns the wrapper

2. Repeat Push-to-EVM export:
   - same wrapper is reused
   - no deployment overhead is charged
   - tracking returns the wrapper

3. EVM wrapper to Push, funds only:
   - wrapper supply decreases
   - Push source unlocks
   - requested Push recipient receives the token

4. EVM wrapper to Push with calldata:
   - source unlock succeeds
   - transfer and destination call both execute

5. Invalid chain/address:
   - transaction is rejected before any approval or gateway call

6. Full round trip:
   - exported amount equals wrapper mint
   - wrapper burn equals Push unlock
   - locked balance and wrapper supply remain consistent

7. Equivalent Solana scenarios once the PC20 SVM deployment and canonical IDL
   are available.

## 12. Typed errors

Add stable, actionable errors:

```text
InvalidPC20AddressError
PC20TokenChainMismatchError
PC20WrapperNotRegisteredError
PC20RegistryMismatchError
PC20FactoryMismatchError
InvalidPC20MetadataError
UnsupportedPC20DestinationError
InsufficientPC20BalanceError
PC20ExpectedButPRC20Error
PC20UnknownChainNamespaceError
PC20WrapperPredictionUnavailableError
PC20ExportRevertedError
```

Errors should include:

- supplied chain
- supplied address
- expected signer/source chain when relevant
- resolved chain namespace
- a concise remediation hint

Do not expose internal RPC payloads or classify by token symbol.

## 13. Suggested pull requests

### PR 1: `feat(core): add PC20 registry resolver and utilities`

- Types
- ABIs
- address codecs
- registry resolver
- `getPC20Address`
- `getPC20Deployments`
- validation errors
- protobuf synchronization

### PR 2: `feat(core): support EVM PC20 universal transactions`

- requested inbound API
- funds-only and funds-plus-payload
- approval behavior
- Push-to-EVM export
- PC20 gas quote
- predicted wrapper
- tracking fallback

### PR 3: `feat(core): add SVM PC20 parity and cascade support`

- SVM IDL and PDA validation
- inbound burn
- outbound export
- cascade integration
- final documentation and E2E coverage

## 14. Definition of done

- The requested `{ chain, address }` input compiles without requiring
  `symbol`, `decimals`, or `mechanism`.
- External wrapper identity is validated against both chain namespace and
  address before any write.
- External-to-Push PC20 works with and without calldata.
- The SDK never approves an EVM PC20 wrapper for inbound burn.
- Push-to-external PC20 approves and locks the canonical Push source.
- `getPC20Address` resolves a wrapper to the correct Push-native token.
- `getPC20Deployments` returns confirmed EVM and SVM deployments.
- First and repeat exports use correct gas and wrapper behavior.
- Tracking understands PC20 protobuf fields and does not require a nonempty
  initial `externalAssetAddr`.
- Existing PRC20/native public APIs and regression tests remain intact.
- EVM E2E round trip passes.
- SVM E2E round trip passes when the canonical deployed SVM environment is
  available; otherwise SVM is explicitly rejected and documented as
  unsupported per the Phase 0 gating decision.

Measurable thresholds:

- PC20 validation adds at most 2 sequential RPC round trips on the warm path
  and 4 cold, asserted by test.
- `getPC20Deployments` issues exactly 1 multicall regardless of chain count.
- Line coverage on new PC20 modules is at least 85%, with 100% branch coverage
  on the §5 validation paths and the address codecs.
- No funds-at-risk path (§7.4) is reachable without a preceding pre-approval
  abort.
