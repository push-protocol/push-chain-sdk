/**
 * UEA (Universal Executor Account) lifecycle functions extracted from Orchestrator.
 * Covers: compute, nonce, version, deployment status.
 */

import { bs58 } from '../../internal/bs58';
import {
  Abi,
  bytesToHex,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
} from 'viem';
import { FACTORY_V1 } from '../../constants/abi/factoryV1';
import { UEA_SVM } from '../../constants/abi/uea.svm';
import { UEA_EVM } from '../../constants/abi/uea.evm';
import { CHAIN_INFO, UEA_PROXY, VM_NAMESPACE } from '../../constants/chain';
import { VM } from '../../constants/enums';
import type { OrchestratorContext } from './context';
import { isPushChain } from './helpers';

// ============================================================================
// Offline UEA Address Computation (CREATE2)
// ============================================================================

export function computeUEAOffchain(ctx: OrchestratorContext): `0x${string}` {
  const { chain, address } = ctx.universalSigner.account;
  const { vm, chainId } = CHAIN_INFO[chain];

  if (isPushChain(chain)) {
    return address as `0x${string}`;
  }

  let ownerKey: `0x${string}`;
  if (vm === VM.EVM) {
    ownerKey = address as `0x${string}`;
  } else if (vm === VM.SVM) {
    ownerKey = bytesToHex(new Uint8Array(bs58.decode(address)));
  } else {
    throw new Error(`Unsupported VM type: ${vm}`);
  }

  const encodedAccountId = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'chainNamespace', type: 'string' },
          { name: 'chainId', type: 'string' },
          { name: 'owner', type: 'bytes' },
        ],
      },
    ],
    [{ chainNamespace: VM_NAMESPACE[vm], chainId, owner: ownerKey }]
  );

  const salt = keccak256(encodedAccountId);

  const minimalProxyRuntimeCode = ('0x3d602d80600a3d3981f3' +
    '363d3d373d3d3d363d73' +
    UEA_PROXY[ctx.pushNetwork].toLowerCase().replace(/^0x/, '') +
    '5af43d82803e903d91602b57fd5bf3') as `0x${string}`;

  const initCodeHash = keccak256(minimalProxyRuntimeCode);

  return getCreate2Address({
    from: ctx.pushClient.pushChainInfo.factoryAddress,
    salt,
    bytecodeHash: initCodeHash,
  });
}

// ============================================================================
// On-chain UEA Computation
// ============================================================================

export async function computeUEA(ctx: OrchestratorContext): Promise<{
  address: `0x${string}`;
  deployed: boolean;
}> {
  const { chain, address } = ctx.universalSigner.account;
  const { vm, chainId } = CHAIN_INFO[chain];

  if (isPushChain(chain)) {
    throw new Error('UEA cannot be computed for a Push Chain Address');
  }

  const computedAddress: `0x${string}` = await ctx.pushClient.readContract({
    address: ctx.pushClient.pushChainInfo.factoryAddress,
    abi: FACTORY_V1 as Abi,
    functionName: 'computeUEA',
    args: [
      {
        chainNamespace: VM_NAMESPACE[vm],
        chainId,
        owner:
          vm === VM.EVM
            ? address
            : vm === VM.SVM
            ? bytesToHex(new Uint8Array(bs58.decode(address)))
            : address,
      },
    ],
  });

  const byteCode = await ctx.pushClient.publicClient.getCode({
    address: computedAddress,
  });
  return { address: computedAddress, deployed: byteCode !== undefined };
}

// ============================================================================
// UEA Nonce
// ============================================================================

export async function getUEANonce(
  ctx: OrchestratorContext,
  address: `0x${string}`
): Promise<bigint> {
  const chain = ctx.universalSigner.account.chain;

  // A Push-native signer is an EOA, even when EIP-7702 delegation makes
  // eth_getCode return a non-empty 0xef0100... designator. It uses the EVM
  // transaction nonce and must never be queried through the UEA ABI.
  if (isPushChain(chain)) {
    return BigInt(0);
  }

  const { vm } = CHAIN_INFO[chain];

  switch (vm) {
    case VM.EVM:
      return ctx.pushClient.readContract({
        address,
        abi: UEA_EVM as unknown as Abi,
        functionName: 'nonce',
      });

    case VM.SVM:
      return ctx.pushClient.readContract({
        address,
        abi: UEA_SVM as unknown as Abi,
        functionName: 'nonce',
      });

    default:
      throw new Error(`Unsupported VM type: ${vm}`);
  }
}

export async function getUeaNonceForExecution(
  ctx: OrchestratorContext
): Promise<bigint> {
  if (isPushChain(ctx.universalSigner.account.chain)) {
    return BigInt(0);
  }

  const UEA = computeUEAOffchain(ctx);
  const code = await ctx.pushClient.publicClient.getCode({ address: UEA });
  return code !== undefined ? await getUEANonce(ctx, UEA) : BigInt(0);
}

export async function getUeaStatusAndNonce(ctx: OrchestratorContext): Promise<{
  deployed: boolean;
  nonce: bigint;
}> {
  // Native Push accounts do not have a UEA. In particular, EIP-7702
  // delegation code must not be mistaken for a deployed UEA proxy.
  if (isPushChain(ctx.universalSigner.account.chain)) {
    return { deployed: false, nonce: BigInt(0) };
  }

  const UEA = computeUEAOffchain(ctx);
  const code = await ctx.pushClient.publicClient.getCode({ address: UEA });
  const deployed = code !== undefined;
  const nonce = deployed ? await getUEANonce(ctx, UEA) : BigInt(0);
  return { deployed, nonce };
}

// ============================================================================
// UEA Version
// ============================================================================

export async function fetchUEAVersion(ctx: OrchestratorContext): Promise<string> {
  if (ctx.ueaVersionCache) {
    return ctx.ueaVersionCache;
  }
  const chain = ctx.universalSigner.account.chain;
  const { vm } = CHAIN_INFO[chain];
  const abi: Abi =
    vm === VM.EVM ? (UEA_EVM as unknown as Abi) : (UEA_SVM as unknown as Abi);
  const predictedUEA = computeUEAOffchain(ctx);
  const code = await ctx.pushClient.publicClient.getCode({
    address: predictedUEA,
  });
  if (code === undefined) {
    ctx.ueaVersionCache = '0.1.0';
    return '0.1.0';
  }
  const version = await ctx.pushClient.readContract<string>({
    address: predictedUEA,
    abi,
    functionName: 'VERSION',
  });
  ctx.ueaVersionCache = version;
  return version;
}
