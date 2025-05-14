import { Abi, zeroHash, getContractAddress, toBytes, sha256 } from 'viem';
import { CHAIN, ENV, VM } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO } from '../constants/chain';
import { LOCKER_ABI } from '../constants/abi';
import { toChainAgnostic } from '../universal/account';

export class Orchestrator {
  constructor(
    private readonly universalSigner: UniversalSigner,
    private readonly pushNetwork: ENV,
    private readonly rpcUrl: Partial<Record<CHAIN, string>> = {},
    private readonly printTraces = false
  ) {}

  /**
   * Executes an interaction on Push Chain — either direct or gasless.
   * Handles NMSC derivation, fee checks, and optional fee-locking.
   * TODO: Look into gasLimits
   */
  async execute(execute: ExecuteParams): Promise<`0x${string}`> {
    const chain = this.universalSigner.chain;

    // TODO: add validation that if sepolia, or any origin testnet, you can only interact with Push testnet. Same for mainnet

    // 1. Block direct execution if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      throw new Error('UniversalSigner is already on Push Chain');
    }

    // 2. Derive NMSC address for this signer (on Push Chain)
    const nmscAddress = await this.deriveNMSCAddress();

    // 3. Estimate gas fee for this interaction
    const requiredFee = await this.estimateFee(execute);

    // 4. Check NMSC balance on Push Chain
    const funds = await this.checkPushBalance(nmscAddress); // 0

    const executionHash = this.sha256HashOfJson(execute);
    // 5. If not enough funds, lock required fee on source chain and send tx to Push chain
    if (funds < requiredFee) {
      // TODO: Lock difference
      const feeLockTxHash = await this.lockFee(
        requiredFee - funds,
        executionHash
      );
      return this.sendCrossChainPushTx(feeLockTxHash, execute);
    } else {
      // 6. If enough funds, sign execution data and send tx to Push chain
      // TODO: Look into chain specific signing
      const signature = await this.universalSigner.signMessage(
        toBytes(executionHash) // UTF-8 encode the hex string
      );
      return this.sendCrossChainPushTx(null, execute, signature);
    }
  }

  /**
   * Computes the CREATE2-derived smart wallet address on Push Chain.
   */
  private async deriveNMSCAddress(): Promise<`0x${string}`> {
    return getContractAddress({
      bytecode: '0x...', // To be deployed smart contract byteCode
      from: '0x', // factory contract on Push Chain
      opcode: 'CREATE2',
      salt: toBytes(toChainAgnostic(this.universalSigner)),
    });
  }

  /**
   * Estimates the gas fee needed for executing the user’s request on Push Chain.
   */
  private async estimateFee({
    target,
    value,
    data,
  }: ExecuteParams): Promise<bigint> {
    const pushChain =
      this.pushNetwork === ENV.MAINNET
        ? CHAIN.PUSH_MAINNET
        : CHAIN.PUSH_TESTNET;

    const pushChainRPC =
      this.rpcUrl[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    const evmClient = new EvmClient({ rpcUrl: pushChainRPC });

    // Simulate the tx to get estimated gas
    const gasEstimate = await evmClient.estimateGas({
      from: await this.deriveNMSCAddress(), // the NMSC smart wallet
      to: target as `0x${string}`,
      data,
      value,
    });

    // Fetch current gas price on Push Chain
    const gasPrice = await evmClient.getGasPrice();

    // Multiply to get total cost in wei
    return gasEstimate * gasPrice;
  }

  /**
   * Checks NMSC balance for a given account
   * In case NMSC is not deployed - balance would be 0
   */
  private async checkPushBalance(address: `0x${string}`): Promise<bigint> {
    const pushChain =
      this.pushNetwork === ENV.MAINNET
        ? CHAIN.PUSH_MAINNET
        : CHAIN.PUSH_TESTNET;
    const pushChainRPC =
      this.rpcUrl[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    const pushClient = new EvmClient({ rpcUrl: pushChainRPC });
    return pushClient.getBalance(address);
  }

  /**
   * Locks fee on origin chain by interacting with the fee-locker contract.
   * amount is in lowest asset representation of the chain ( wei for evm )
   */
  private async lockFee(
    amount: bigint,
    executionHash: string = zeroHash
  ): Promise<string> {
    const { lockerContract, vm, defaultRPC } =
      CHAIN_INFO[this.universalSigner.chain];

    switch (vm) {
      case VM.EVM: {
        if (!lockerContract) {
          throw new Error('Locker Contract Not Found');
        }
        const rpcUrl = this.rpcUrl[this.universalSigner.chain] || defaultRPC;
        const evmClient = new EvmClient({ rpcUrl });

        return await evmClient.writeContract({
          abi: LOCKER_ABI as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: amount,
        });
      }
      case VM.SVM: {
        throw new Error('Not Implemented');
      }
      default: {
        throw new Error('Unknown VM');
      }
    }
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  public async sendCrossChainPushTx(
    feeLockTxHash: string | null,
    execute?: ExecuteParams,
    signature?: Uint8Array
  ): Promise<`0x${string}`> {
    // TODO: build and broadcast custom Cosmos transaction (gasless meta tx)
    return '0xTxHash';
  }

  /**
   * Utility: checks if a chain belongs to the Push Chain group.
   */
  private isPushChain(chain: CHAIN): boolean {
    return chain === CHAIN.PUSH_MAINNET || chain === CHAIN.PUSH_TESTNET;
  }

  /**
   * Utility: create sha256Hash of a JSON
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sha256HashOfJson(obj: any): string {
    // Step 1: Deterministic stringify (stable key order)
    const jsonStr = JSON.stringify(obj, Object.keys(obj).sort());

    // Step 2: Hash with SHA-256 using viem
    return sha256(toBytes(jsonStr));
  }
}
