import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  BlockheightBasedTransactionConfirmationStrategy,
} from '@solana/web3.js';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { UniversalSigner } from '../universal/universal.types';

/**
 * Solana-compatible VM client for reading and writing SVM-based chains.
 */
export class SvmClient {
  private readonly connection: Connection;

  constructor({ rpcUrl }: ClientOptions) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Returns the balance (in lamports) of a Solana address.
   */
  async getBalance(address: string): Promise<bigint> {
    const pubkey = new PublicKey(address);
    const lamports = await this.connection.getBalance(pubkey);
    return BigInt(lamports);
  }

  /**
   * Reads a full program account using Anchor IDL.
   * `functionName` must match the account layout name in the IDL.
   */
  async readContract<T = unknown>({
    abi,
    address,
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      {
        preflightCommitment: 'confirmed',
      }
    );
    const program = new Program(abi, new PublicKey(address), provider);
    const pubkey = new PublicKey(args[0]);
    const account = await program.account[functionName].fetch(pubkey);
    return account as T;
  }

  /**
   * Sends a Solana transaction using a smart contract instruction.
   * Your `abi`, `functionName`, and `args` need to be compiled into instruction manually.
   */
  async writeContract({
    abi,
    address,
    signer,
    functionName,
    args = [],
  }: WriteContractParams & { solanaKeyPair: Keypair }): Promise<string> {
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(new Keypair()),
      {
        preflightCommitment: 'confirmed',
      }
    );
    const program = new Program(abi, new PublicKey(address), provider);

    let instruction: TransactionInstruction;
    if (args.length > 0) {
      instruction = await program.methods[functionName](...args)
        .accounts({
          newAccount: new Keypair().publicKey,
          signer: new PublicKey(signer.address),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    } else {
      instruction = await program.methods[functionName]()
        .accounts({
          newAccount: new Keypair().publicKey,
          signer: new PublicKey(signer.address),
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    }

    // (4) Send transaction via UniversalSigner
    return this.sendTransaction({
      instructions: [instruction],
      signer,
    });
  }

  /**
   * Sends a set of instructions as a manually-signed Solana transaction.
   */
  async sendTransaction({
    instructions,
    signer,
  }: {
    instructions: TransactionInstruction[];
    signer: UniversalSigner;
  }): Promise<string> {
    // (1) Build the Transaction
    const feePayerPubkey = new PublicKey(signer.address);
    const { blockhash } = await this.connection.getLatestBlockhash('finalized');

    const tx = new Transaction({
      feePayer: feePayerPubkey,
      recentBlockhash: blockhash,
    });

    // 📌 Tell it which pubkeys will sign.  (Only those keys get signature slots.)
    tx.setSigners(feePayerPubkey /*, ...anyOtherSignerPubkeys if needed */);

    tx.add(...instructions);

    // (2) Serialize the message for signing
    const message = tx.serializeMessage();

    // (3) Let your UniversalSigner produce the real ed25519 signature
    const sigUint8 = await signer.signTransaction(message);
    const sigBuffer = Buffer.from(sigUint8);

    // (4) Attach the signature in the correct slot
    tx.addSignature(feePayerPubkey, sigBuffer);
    // If you had other signers, repeat the above two lines for each

    // (5) Now serialize normally (will verify signatures client-side)
    const rawTx = tx.serialize();

    // (6) Send it
    const txid = await this.connection.sendRawTransaction(rawTx);
    return txid;
  }

  /**
   * Estimates the fee (in lamports) to send a transaction with the given instructions.
   */
  async estimateGas({
    instructions,
    signer,
  }: {
    instructions: TransactionInstruction[];
    signer: UniversalSigner;
  }): Promise<bigint> {
    const feePayer = new PublicKey(signer.address);
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer });
    if (instructions.length > 0) {
      tx.add(...instructions);
    }
    const message = tx.compileMessage();
    const feeResp = await this.connection.getFeeForMessage(message);
    if (!feeResp || feeResp.value == null) {
      throw new Error('Failed to estimate fee');
    }
    return BigInt(feeResp.value);
  }
}
