
import { bytesToHex, Chain, hexToBytes, isHash, parseTransaction, toHex } from "viem";
import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';
import { waitForTxHashFromPendingTxId } from "./waapEvents";
import { chains } from "../walletProviders/ethereum/chains";
import { ChainType, ITypedData } from "../../../lib/types";
import {
  EIP_7702_UNSUPPORTED_ERROR,
  normalizeSignedAuthorization,
  signAuthorizationWithEthersSigner,
} from '../walletProviders/ethereum/signAuthorization';

export const getWaapProvider = () => {
  if (typeof window === 'undefined') return null;
  return (window as any).waap ?? null;
};

export const getWaapAddress = async (): Promise<`0x${string}`> => {
  const waap = getWaapProvider();
  const accounts: string[] = await waap.request({ method: "eth_accounts" });
  const addr = accounts?.[0];
  if (!addr) throw new Error("No WaaP account connected");
  return addr as `0x${string}`;
};

export const getWaapAccount = async (): Promise<`0x${string}`> => {
  const provider = getWaapProvider();
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error("No connected WaaP account");
  }

  return accounts[0] as `0x${string}`;
};

export const switchNetwork = async (chainName: ChainType) => {
	const network = chains[chainName] as Chain;
	const provider = getWaapProvider();

	const hexNetworkId = toHex(network.id);

	const currentChainId = await provider.request({
		method: "eth_chainId",
	});

	if (currentChainId === hexNetworkId) return;

	try {
		await provider.request({
			method: "wallet_switchEthereumChain",
			params: [{ chainId: hexNetworkId }]
		});
	} catch (err) {
		try {
			await provider.request({
				method: "wallet_addEthereumChain",
				params: [{
					chainId: hexNetworkId,
					chainName: network.name,
					rpcUrls: network.rpcUrls.default.http,
					nativeCurrency: network.nativeCurrency,
					blockExplorerUrls: [network.blockExplorers?.default.url]
				}]
			});
		} catch (addError) {
			console.error("Error switching network:", addError);
			throw addError
		}
	}
};

export const waapSignMessage = async (
  message: Uint8Array,
): Promise<Uint8Array> => {
  const provider = getWaapProvider();

  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];

  if (!accounts || accounts.length === 0) {
    throw new Error("No connected Rabby account");
  }

	const hexMessage = bytesToHex(message);

	const signature = await provider.request({
    method: "personal_sign",
    params: [hexMessage, accounts[0]],
  });

  return hexToBytes(signature as `0x${string}`);
};

export const waapSignTypedData = async (
  typedData: ITypedData,
): Promise<Uint8Array> => {
  const provider = getWaapProvider();

  const accounts = (await provider.request({
		method: "eth_accounts",
	})) as string[];

	if (!accounts || accounts.length === 0) {
		throw new Error("No connected Rabby account");
	}

	typedData.types = {
		EIP712Domain: [
			{ name: "version", type: "string" },
			{ name: "chainId", type: "uint256" },
			{ name: "verifyingContract", type: "address" },
		],
		UniversalPayload: typedData.types["UniversalPayload"],
	};

	const signature = await provider.request({
		method: "eth_signTypedData_v4",
		params: [accounts[0], JSON.stringify(typedData)],
	});

	return hexToBytes(signature as `0x${string}`);
};

export const waapSignAuthorization = async (
  params: SignAuthorizationParams
): Promise<SignedAuthorization> => {
  const provider = getWaapProvider() as {
    authorize?: Parameters<
      typeof signAuthorizationWithEthersSigner
    >[0]['authorize'];
    signAuthorization?: (
      params: SignAuthorizationParams
    ) => Promise<Parameters<typeof normalizeSignedAuthorization>[0]>;
  } | null;

  if (typeof provider?.signAuthorization === 'function') {
    const authorization = await provider.signAuthorization(params);
    return normalizeSignedAuthorization(authorization, params);
  }

  if (typeof provider?.authorize === 'function') {
    return signAuthorizationWithEthersSigner(provider, params);
  }

  throw new Error(EIP_7702_UNSUPPORTED_ERROR);
};

export const waapSignAndSendTransaction = async (
	txn: Uint8Array
): Promise<Uint8Array> => {
	const provider = getWaapProvider();

	const accounts = (await provider.request({
		method: "eth_accounts",
	})) as string[];

	if (!accounts || accounts.length === 0) {
		throw new Error("No connected Rabby account");
	}

	const hex = bytesToHex(txn);
	const parsed = parseTransaction(hex);

	// Deliberately omit gas / maxFeePerGas / maxPriorityFeePerGas: those were
	// estimated by Core against its own RPC, which can disagree with (or go
	// stale relative to) whatever RPC the WAAP provider itself broadcasts
	// through, causing spurious -32003 "Transaction rejected" errors after
	// the user has already approved. Letting the provider estimate gas/fees
	// itself, right before it broadcasts, avoids that estimate-vs-broadcast
	// mismatch entirely. (See the same fix applied to the injected-wallet
	// adapters in ../walletProviders/ethereum/.)
	const txParams = {
		from: accounts[0],
		to: parsed.to,
		value: parsed.value ? "0x" + parsed.value.toString(16) : undefined,
		data: parsed.data,
	};

	const res = await provider.request({
		method: "eth_sendTransaction",
		params: [txParams],
		async: true,
	});

	if (isHash(res)) return hexToBytes(res);

	const pendingTxId = (res as any)?.pendingTxId as string;

	const txHash = await waitForTxHashFromPendingTxId(provider, pendingTxId);

	return hexToBytes(txHash as `0x${string}`);
};
