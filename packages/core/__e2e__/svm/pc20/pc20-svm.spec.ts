/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * PC20 on Solana, end to end — the four flows, self-seeding and serial:
 *
 *   1. R2 funds-only export  → mints into the sender's CEA ATA
 *   2. R2 delivery export    → TransferChecked CPI into the recipient ATA
 *   3. R3 CEA burn           → parks its own balance, then recovers it on Push
 *   4. R1 direct burn        → burns from the wallet ATA, unlocks on Push
 *                              (rate-limit unblocked by the optional
 *                              token_rate_limit account, gateway commit
 *                              d5f6334; tolerates the known fee-credit bug on
 *                              the deposit leg)
 *
 * R3 seeds its own CEA ATA balance because CI may select that scenario without
 * selecting R2. In a complete serial run, (2) still seeds the wallet ATA that
 * (4) burns — the full run conserves rain end to end.
 *
 * The wrapper mint needs no env var — it derives from PC20_PUSH_TOKEN
 * (predictSvmWrapperMint), which is the same derivation settlement uses.
 */

import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
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
import {
  getPC20Fixtures,
  announcePC20Skip,
  sendToleratingFeeCreditBug,
  pollUntil,
} from '@e2e/shared/pc20-fixtures';

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
    // not caller-chosen).
    const freshRecipient = Keypair.generate().publicKey;
    const before = { ceaAta: await ataBal(ceaAta), vault: await donutBal(VAULT_PC20) };

    const tx = await client.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: freshRecipient.toBase58() },
      funds: {
        amount: AMOUNT,
        token: {
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
    // This scenario is selected independently by the CI manifest. Seed exactly
    // what it will burn instead of relying on the R2 test having run first or
    // on residue from an earlier live run.
    const parkedBefore = await ataBal(ceaAta);
    const freshRecipient = Keypair.generate().publicKey;
    const seed = await client.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: freshRecipient.toBase58() },
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.PUSH_TESTNET_DONUT,
          address: fixtures!.pushToken,
        },
      },
    });
    await seed.wait();

    const parked = await pollUntil(() => ataBal(ceaAta), parkedBefore + AMOUNT);
    expect(parked - parkedBefore).toBe(AMOUNT);

    const before = { vault: await donutBal(VAULT_PC20), uea: await donutBal(ueaAddress) };
    const supplyBefore = BigInt((await devnet.getTokenSupply(mint)).value.amount);

    const tx = await client.universal.sendTransaction({
      from: { chain: CHAIN.SOLANA_DEVNET },
      to: ueaAddress,
      funds: {
        amount: AMOUNT,
        token: {
          chain: CHAIN.SOLANA_DEVNET,
          address: mint.toBase58(),
        },
      },
    });
    await tx.wait();

    const after = { vault: await donutBal(VAULT_PC20), uea: await donutBal(ueaAddress) };
    const supplyAfter = BigInt((await devnet.getTokenSupply(mint)).value.amount);

    expect(await ataBal(ceaAta)).toBe(parkedBefore);
    expect(supplyBefore - supplyAfter).toBe(AMOUNT);
    expect(before.vault - after.vault).toBe(AMOUNT);
    expect(after.uea - before.uea).toBe(AMOUNT);
  });

  // Unblocked by gateway commit d5f6334 (token_rate_limit is Optional; the
  // SDK routes SVM PC20 imports through the payload path, which carries a
  // forward payload — never the selector-only shape the chain bricks on —
  // and a native gas deposit, so the native-SOL rate-limit PDA is passed).
  // The deposit's fee-credit leg still hits the known Bug 1 mask on Push, so
  // the send is tolerance-wrapped; burn + unlock are asserted strictly.
  it('R1 direct burn from the wallet unlocks on Push', async () => {
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

    const walletAta = deriveAtaPubkey(recipient, mint);
    const before = {
      uea: await donutBal(solUea),
      walletAta: await ataBal(walletAta),
      vault: await donutBal(VAULT_PC20),
    };
    expect(before.walletAta).toBeGreaterThanOrEqual(AMOUNT); // seeded by test 2

    await sendToleratingFeeCreditBug(() =>
      solClient.universal.sendTransaction({
        to: solUea,
        funds: {
          amount: AMOUNT,
          token: { chain: CHAIN.SOLANA_DEVNET, address: mint.toBase58() },
        },
      })
    );

    // Unlock lands on the UEA; the forward payload self-transfers there.
    const ueaAfter = await pollUntil(() => donutBal(solUea), before.uea + AMOUNT);
    expect(ueaAfter - before.uea).toBe(AMOUNT);
    expect(before.walletAta - (await ataBal(walletAta))).toBe(AMOUNT);
    expect(before.vault - (await donutBal(VAULT_PC20))).toBe(AMOUNT);
  });
});
