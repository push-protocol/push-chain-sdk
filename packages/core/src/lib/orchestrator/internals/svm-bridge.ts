/**
 * SVM (Solana) bridge transaction for funds+payload flow —
 * extracted from Orchestrator._sendSVMTxWithFunds.
 *
 * Handles both native SOL and SPL token bridging with universal payload signing.
 */

import { PublicKey, SystemProgram } from '@solana/web3.js';
import { stringToBytes } from 'viem';
import SVM_GATEWAY_IDL from '../../constants/abi/universalGatewayV0.json';
import { CHAIN_INFO, SVM_PYTH_PRICE_FEED } from '../../constants/chain';
import { CHAIN } from '../../constants/enums';
import type { UniversalPayload } from '../../generated/v1/tx';
import { SvmClient } from '../../vm-client/svm-client';
import type { LegacyExecuteParams, UniversalTxRequest } from '../orchestrator.types';
import type { OrchestratorContext } from './context';
import { buildSvmUniversalTxRequest, getSvmProtocolFee } from './svm-helpers';
import { signUniversalPayload, encodeUniversalPayloadSvm } from './signing';
import { computeUEAOffchain, fetchUEAVersion } from './uea-manager';

// ============================================================================
// sendSVMTxWithFunds
// ============================================================================

/**
 * Sends a Solana gateway transaction for the funds+payload bridge path.
 * Handles native SOL and SPL token mechanisms.
 */
export async function sendSVMTxWithFunds(
  ctx: OrchestratorContext,
  params: {
    execute: LegacyExecuteParams;
    mechanism: 'native' | 'approve' | 'permit2' | string;
    universalPayload: UniversalPayload;
    bridgeAmount: bigint;
    nativeAmount: bigint;
    req: UniversalTxRequest;
  }
): Promise<string> {
  const { execute, mechanism, universalPayload, bridgeAmount, nativeAmount, req } = params;

  const svmClient = new SvmClient({
    rpcUrls:
      ctx.rpcUrls[CHAIN.SOLANA_DEVNET] ||
      CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC,
  });
  const programId = new PublicKey(SVM_GATEWAY_IDL.address);
  const [configPda] = PublicKey.findProgramAddressSync(
    [stringToBytes('config')],
    programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [stringToBytes('vault')],
    programId
  );
  const userPk = new PublicKey(ctx.universalSigner.account.address);
  const priceUpdatePk = new PublicKey(SVM_PYTH_PRICE_FEED);
  const [rateLimitConfigPda] = PublicKey.findProgramAddressSync(
    [stringToBytes('rate_limit_config')],
    programId
  );

  if (execute.payGasWith !== undefined) {
    throw new Error('Pay-with token is not supported on Solana');
  }

  if (!execute.funds?.token?.address) {
    throw new Error('Token address is required for bridge path');
  }

  const isNative =
    mechanism === 'native' || execute.funds.token.symbol === 'SOL';
  const { feeVaultPda, protocolFeeLamports } =
    await getSvmProtocolFee(svmClient, programId);

  const ueaAddressSvm = computeUEAOffchain(ctx);
  const ueaVersion = await fetchUEAVersion(ctx);
  const svmSignature = await signUniversalPayload(
    ctx,
    universalPayload,
    ueaAddressSvm,
    ueaVersion
  );

  if (isNative) {
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), PublicKey.default.toBuffer()],
      programId
    );

    const nativeReq = buildSvmUniversalTxRequest({
      recipient: Array.from(Buffer.alloc(20, 0)),
      token: PublicKey.default,
      amount: bridgeAmount,
      payload: Uint8Array.from(
        encodeUniversalPayloadSvm(universalPayload)
      ),
      revertRecipient: userPk,
      signatureData: svmSignature,
    });

    return await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL,
      address: programId.toBase58(),
      functionName: 'sendUniversalTx',
      args: [nativeReq, nativeAmount + protocolFeeLamports],
      signer: ctx.universalSigner,
      accounts: {
        config: configPda,
        vault: vaultPda,
        feeVault: feeVaultPda,
        userTokenAccount: vaultPda,
        gatewayTokenAccount: vaultPda,
        user: userPk,
        priceUpdate: priceUpdatePk,
        tokenProgram: new PublicKey(
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        ),
        rateLimitConfig: rateLimitConfigPda,
        tokenRateLimit: tokenRateLimitPda,
        systemProgram: SystemProgram.programId,
      },
    });
  } else {
    // Token address already validated above (line 67)
    const mintPk = new PublicKey(execute.funds!.token!.address);
    const TOKEN_PROGRAM_ID = new PublicKey(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    );
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );
    const userAta = PublicKey.findProgramAddressSync(
      [userPk.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    const vaultAta = PublicKey.findProgramAddressSync(
      [vaultPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];

    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), mintPk.toBuffer()],
      programId
    );

    const splReq = buildSvmUniversalTxRequest({
      recipient: Array.from(Buffer.alloc(20, 0)),
      token: mintPk,
      amount: bridgeAmount,
      payload: Uint8Array.from(
        encodeUniversalPayloadSvm(universalPayload)
      ),
      revertRecipient: userPk,
      signatureData: svmSignature,
    });

    return await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL,
      address: programId.toBase58(),
      functionName: 'sendUniversalTx',
      args: [splReq, nativeAmount + protocolFeeLamports],
      signer: ctx.universalSigner,
      accounts: {
        config: configPda,
        vault: vaultPda,
        feeVault: feeVaultPda,
        userTokenAccount: userAta,
        gatewayTokenAccount: vaultAta,
        user: userPk,
        priceUpdate: priceUpdatePk,
        tokenProgram: TOKEN_PROGRAM_ID,
        rateLimitConfig: rateLimitConfigPda,
        tokenRateLimit: tokenRateLimitPda,
        systemProgram: SystemProgram.programId,
      },
    });
  }
}
