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
import { buildPC20BurnAccounts } from './pc20/svm';
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

  // --- PC20 wrapper burn -------------------------------------------------
  // route_pc20_universal_tx (deposit.rs) differs from the SPL escrow route in
  // three program-enforced ways, each of which reverts if violated:
  //   1. req.recipient must be the NONZERO 20-byte Push recipient — the chain
  //      unlocks the source token directly to it (unlockPC20), unlike SPL
  //      where zeros are fine because the UEA payload moves funds.
  //   2. gateway_token_account must be ABSENT — the wrapper is burned via the
  //      mint authority, never escrowed.
  //   3. remaining_accounts must be exactly [pc20_state ro, pc20_mint w].
  // The SDK must NOT prepend the PC20 selector — the gateway does
  // (pc20_prefixed_payload), mirroring the EVM inbound.
  const pc20 = execute._pc20;
  if (pc20?.direction === 'import') {
    const mintPk = new PublicKey(execute.funds.token.address);
    const { remainingAccounts } = buildPC20BurnAccounts({
      programId,
      mint: mintPk,
    });
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
    const [tokenRateLimitPda] = PublicKey.findProgramAddressSync(
      [stringToBytes('rate_limit'), mintPk.toBuffer()],
      programId
    );

    const pushRecipient = (
      typeof execute.to === 'string' ? execute.to : ueaAddressSvm
    ) as `0x${string}`;

    const burnReq = buildSvmUniversalTxRequest({
      recipient: Array.from(Buffer.from(pushRecipient.slice(2), 'hex')),
      token: mintPk,
      amount: bridgeAmount,
      payload: Uint8Array.from(encodeUniversalPayloadSvm(universalPayload)),
      revertRecipient: userPk,
      signatureData: svmSignature,
    });

    return await svmClient.writeContract({
      abi: SVM_GATEWAY_IDL,
      address: programId.toBase58(),
      functionName: 'sendUniversalTx',
      args: [burnReq, nativeAmount + protocolFeeLamports],
      signer: ctx.universalSigner,
      accounts: {
        config: configPda,
        vault: vaultPda,
        feeVault: feeVaultPda,
        userTokenAccount: userAta,
        gatewayTokenAccount: null as never,
        user: userPk,
        priceUpdate: priceUpdatePk,
        tokenProgram: TOKEN_PROGRAM_ID,
        rateLimitConfig: rateLimitConfigPda,
        tokenRateLimit: tokenRateLimitPda,
        systemProgram: SystemProgram.programId,
      },
      remainingAccounts,
    });
  }

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
