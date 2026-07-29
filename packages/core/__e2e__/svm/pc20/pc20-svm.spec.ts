/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 on Solana, end to end — the four flows, self-seeding and serial:
 *
 *   1. R2 funds-only export  → mints into the sender's CEA ATA
 *   2. R2 delivery export    → TransferChecked CPI into the recipient ATA
 *   3. R3 CEA burn           → recovers the CEA ATA balance, unlocks on Push
 *   4. R1 direct burn        → SKIPPED: blocked on admin `set_token_rate_limit`
 *                              (the outer send_universal_tx requires an
 *                              initialized per-mint rate limit; the R3 finalize
 *                              path explicitly does not)
 *
 * Order is load-bearing: (1) seeds the CEA ATA that (3) recovers, so the suite
 * leaves the CEA ATA empty. Each full run locks 0.001 rain net (the wrapper
 * delivered to the wallet in (2) can only return via the blocked R1 path).
 *
 * The wrapper mint needs no env var — it derives from PC20_PUSH_TOKEN
 * (predictSvmWrapperMint), which is the same derivation settlement uses.
 */

import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import { ERC20_EVM, SVM_GATEWAY_IDL } from '../../../src/lib/constants/abi';
import {
  deriveSvmCeaPda,
  deriveAtaPubkey,
} from '../../../src/lib/orchestrator/internals/svm-rent';
import { predictSvmWrapperMint } from '../../../src/lib/orchestrator/internals/pc20/svm';
import { getPC20Fixtures, announcePC20Skip } from '@e2e/shared/pc20-fixtures';

const fixtures = getPC20Fixtures();
const hasSolKey = Boolean(process.env['SOLANA_PRIVATE_KEY']);
const d = fixtures && hasSolKey ? describe : describe.skip;

announcePC20Skip('PC20 SVM');
if (!hasSolKey) console.log('[SKIP] PC20 SVM — SOLANA_PRIVATE_KEY not set');

const AMOUNT = parseEther('0.001');
const VAULT_PC20 = '0x00000000000000000000000000000000000000B1' as const;
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

jest.setTimeout(900_000);

d('PC20 SVM flows', () => {
  let client: Awaited<ReturnType<typeof PushChain.initialize>>;
  let devnet: Connection;
  let donut: ReturnType<typeof createPublicClient>;
  let mint: PublicKey;
  let ueaAddress: `0x${string}`;
  let ceaAta: PublicKey;
  let recipient: PublicKey;
  let solKeypair: Keypair;

  const donutBal = (who: `0x${string}`) =>
    donut.readContract({
      address: fixtures!.pushToken,
      abi: ERC20_EVM,
      functionName: 'balanceOf',
      args: [who],
    }) as Promise<bigint>;
  const ataBal = async (ata: PublicKey) =>
    BigInt((await devnet.getTokenAccountBalance(ata).catch(() => null))?.value.amount ?? '0');

  beforeAll(async () => {
    const account = privateKeyToAccount(process.env['EVM_PRIVATE_KEY'] as `0x${string}`);
    solKeypair = Keypair.fromSecretKey(bs58.decode(process.env['SOLANA_PRIVATE_KEY'] as string));
    recipient = solKeypair.publicKey;

    devnet = new Connection(
      CHAIN_INFO[CHAIN.SOLANA_DEVNET].defaultRPC[0] ?? 'https://api.devnet.solana.com',
      'confirmed'
    );
    donut = createPublicClient({
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });

    const programId = new PublicKey((SVM_GATEWAY_IDL as { address: string }).address);
    mint = predictSvmWrapperMint(programId, fixtures!.pushToken);

    const walletClient = createWalletClient({
      account,
      transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
    });
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });
    client = await PushChain.initialize(signer, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
    const uea = (await PushChain.utils.account.convertOriginToExecutor({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: account.address,
    })) as { address: `0x${string}` } | `0x${string}`;
    ueaAddress = typeof uea === 'string' ? uea : uea.address;
    ceaAta = deriveAtaPubkey(deriveSvmCeaPda(ueaAddress), mint);
  });

  it('export to an ATA-less recipient parks in the CEA ATA', async () => {
    // A FRESH recipient guarantees no ATA exists, so this deterministically
    // exercises the park-in-CEA fallback (delivery is ATA-existence-driven,
    // not caller-chosen). The parked balance seeds the R3 recovery test.
    const freshRecipient = Keypair.generate().publicKey;
    const before = { ceaAta: await ataBal(ceaAta), vault: await donutBal(VAULT_PC20) };

    const tx = await client.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: freshRecipient.toBase58() },
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await tx.wait();

    const after = { ceaAta: await ataBal(ceaAta), vault: await donutBal(VAULT_PC20) };
    expect(after.ceaAta - before.ceaAta).toBe(AMOUNT);
    expect(after.vault - before.vault).toBe(AMOUNT);
  });

  it('delivery export lands in the recipient ATA when it exists', async () => {
    const recipientAta = deriveAtaPubkey(recipient, mint);

    // Idempotent ATA create — the mint exists after test 1 (or any prior export).
    if (!(await devnet.getAccountInfo(recipientAta))) {
      const ix = new TransactionInstruction({
        programId: ATA_PROGRAM,
        keys: [
          { pubkey: recipient, isSigner: true, isWritable: true },
          { pubkey: recipientAta, isSigner: false, isWritable: true },
          { pubkey: recipient, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]), // CreateIdempotent
      });
      await sendAndConfirmTransaction(devnet, new Transaction().add(ix), [solKeypair]);
    }

    const before = {
      recipientAta: await ataBal(recipientAta),
      ceaAta: await ataBal(ceaAta),
      vault: await donutBal(VAULT_PC20),
    };

    const tx = await client.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: recipient.toBase58() },
      funds: {
        amount: AMOUNT,
        token: {
          standard: 'pc20',
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await tx.wait();

    const after = {
      recipientAta: await ataBal(recipientAta),
      ceaAta: await ataBal(ceaAta),
      vault: await donutBal(VAULT_PC20),
    };
    // The delivery CPI moves the fresh mint through the CEA ATA to the
    // recipient in a single settlement — CEA ATA must be a pure pass-through.
    expect(after.recipientAta - before.recipientAta).toBe(AMOUNT);
    expect(after.ceaAta).toBe(before.ceaAta);
    expect(after.vault - before.vault).toBe(AMOUNT);
  });

  it('R3 burns the CEA ATA balance and unlocks on Push', async () => {
    const parked = await ataBal(ceaAta);
    expect(parked).toBeGreaterThan(BigInt(0)); // seeded by test 1

    const before = { vault: await donutBal(VAULT_PC20), uea: await donutBal(ueaAddress) };
    const supplyBefore = BigInt((await devnet.getTokenSupply(mint)).value.amount);

    const tx = await client.universal.sendTransaction({
      from: { chain: CHAIN.SOLANA_DEVNET },
      to: ueaAddress,
      funds: {
        amount: parked,
        token: {
          standard: 'pc20',
          chain: CHAIN.SOLANA_DEVNET,
          address: mint.toBase58(),
        },
      },
    });
    await tx.wait();

    const after = { vault: await donutBal(VAULT_PC20), uea: await donutBal(ueaAddress) };
    const supplyAfter = BigInt((await devnet.getTokenSupply(mint)).value.amount);

    expect(await ataBal(ceaAta)).toBe(BigInt(0));
    expect(supplyBefore - supplyAfter).toBe(parked);
    expect(before.vault - after.vault).toBe(parked);
    expect(after.uea - before.uea).toBe(parked);
  });

  // Blocked on chain ops: the outer send_universal_tx requires an initialized
  // per-mint token_rate_limit (admin-gated set_token_rate_limit); until the
  // wrapper mint is whitelisted, the direct burn fails simulation with
  // AccountNotInitialized. Un-skip once the admin action lands.
  it.skip('R1 direct burn from the wallet unlocks on Push (rate-limit gated)', async () => {
    const solSigner = await PushChain.utils.signer.toUniversalFromKeypair(solKeypair, {
      chain: CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });
    const solClient = await PushChain.initialize(solSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
    const solUeaRaw = (await PushChain.utils.account.convertOriginToExecutor({
      chain: CHAIN.SOLANA_DEVNET,
      address: recipient.toBase58(),
    })) as { address: `0x${string}` } | `0x${string}`;
    const solUea = typeof solUeaRaw === 'string' ? solUeaRaw : solUeaRaw.address;

    const before = await donutBal(solUea);
    const tx = await solClient.universal.sendTransaction({
      to: solUea,
      funds: {
        amount: AMOUNT,
        token: { standard: 'pc20', chain: CHAIN.SOLANA_DEVNET, address: mint.toBase58() },
      },
    });
    await tx.wait();
    expect((await donutBal(solUea)) - before).toBe(AMOUNT);
  });
});
