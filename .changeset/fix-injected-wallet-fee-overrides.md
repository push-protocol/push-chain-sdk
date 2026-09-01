---
'@pushchain/ui-kit': patch
---

Fix `-32003` "Transaction rejected" errors from injected/embedded wallets by no longer forwarding Core's pre-estimated `gas`, `maxFeePerGas`, and `maxPriorityFeePerGas` into `eth_sendTransaction`.

Every wallet adapter (`MetamaskProvider`, `RabbyProvider`, `ZerionProvider`, the WalletConnect adapter, the Phantom EVM adapter, and the WAAP embedded-wallet provider) parsed the unsigned transaction Core serialized and relayed its `gas`/`maxFeePerGas`/`maxPriorityFeePerGas` fields verbatim into `eth_sendTransaction`. Those values are estimated by Core against its own RPC, before the wallet-approval popup even opens; the wallet then broadcasts through its *own* configured RPC. If the two disagree, or the fee estimate goes stale during the approval wait, the broadcasting node can reject the transaction outright with JSON-RPC `-32003` — surfaced to users as a "Signature Failed" toast even though they'd already approved.

Adapters now send only `from`/`to`/`value`/`data` and let each wallet estimate gas and fees itself, against its own RPC, immediately before broadcast — eliminating the estimate-vs-broadcast mismatch. Core is unaffected: it still computes and serializes complete transactions (used as-is by local/raw signers), this change only touches what the injected-wallet adapters choose to forward.
