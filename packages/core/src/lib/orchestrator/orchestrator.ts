import {
  Abi,
  zeroHash,
  toBytes,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  bytesToHex,
  stringToBytes,
  getCreate2Address,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO } from '../constants/chain';
import {
  FACTORY_V1,
  FEE_LOCKER_EVM,
  FEE_LOCKER_SVM,
  UEA_EVM,
  UEA_SVM,
} from '../constants/abi';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { UniversalPayload, SignatureType } from '../generated/v1/tx';
import { PriceFetch } from '../price-fetch/price-fetch';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { DeliverTxResponse } from '@cosmjs/stargate';

export class Orchestrator {
  private pushClient: PushClient;

  constructor(
    private readonly universalSigner: UniversalSigner,
    pushNetwork: PUSH_NETWORK,
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {},
    private readonly printTraces = false
  ) {
    let pushChain: CHAIN;
    if (pushNetwork === PUSH_NETWORK.MAINNET) {
      pushChain = CHAIN.PUSH_MAINNET;
    } else if (
      pushNetwork === PUSH_NETWORK.TESTNET_DONUT ||
      pushNetwork === PUSH_NETWORK.TESTNET
    ) {
      pushChain = CHAIN.PUSH_TESTNET_DONUT;
    } else {
      pushChain = CHAIN.PUSH_LOCALNET;
    }

    const pushChainRPCs: string[] =
      this.rpcUrls[pushChain] || CHAIN_INFO[pushChain].defaultRPC;

    this.pushClient = new PushClient({
      rpcUrls: pushChainRPCs,
      network: pushNetwork,
    });
  }

  /**
   * Executes an interaction on Push Chain
   */
  async execute(execute: ExecuteParams): Promise<DeliverTxResponse> {
    const chain = this.universalSigner.account.chain;

    this.validateMainnetConnection(chain);

    // 1. Execute direct tx if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      this.printLog('Push to Push Transaction Detected');
      const txHash = await this.pushClient.sendTransaction({
        to: execute.to,
        data: execute.data || '0x',
        value: execute.value,
        signer: this.universalSigner,
      });

      if (chain === CHAIN.PUSH_LOCALNET) {
        // @dev - Required for preventing cosmos fetching failures
        const delay = (ms: number): Promise<void> => {
          return new Promise((resolve) => setTimeout(resolve, ms));
        };
        await delay(3000);
      }
      return this.pushClient.getCosmosTx(txHash);
    }

    // 2. Get Push chain UEA address for this signer
    this.printLog('Fetching UEA for Connected Universal Account');
    const { address: UEA, deployed: isUEADeployed } = await this.computeUEA();
    this.printLog(`UEA: ${UEA}, Deployed: ${isUEADeployed}`);

    // 3. Estimate funds required for the execution
    this.printLog('Estimating Gas Limit for Execution');
    // const gasEstimate = await this.pushClient.estimateGas({
    //   to: execute.target,
    //   data: execute.data,
    //   // value: execute.value, @DEV - taking 0 as of now
    // });
    const gasEstimate = execute.gasLimit || BigInt(1e7);
    this.printLog(`GasEstimate: ${gasEstimate}`);

    // Fetch current gas price
    this.printLog('Fetching Gas Price');
    const gasPrice = await this.pushClient.getGasPrice();
    this.printLog(`Gas Price: ${gasPrice}`);

    const requiredGasFee = gasEstimate * gasPrice;
    this.printLog(`Required Gas Fee for Execution: ${requiredGasFee} upc`);

    const requiredFunds = requiredGasFee + execute.value;
    this.printLog(
      `Total Required Funds for Execution (fee + value): ${requiredFunds} upc`
    );

    // 4. Check UEA balance on Push Chain
    this.printLog('Checking UEA balance');
    const funds = await this.pushClient.getBalance(UEA);
    this.printLog(`Current balance: ${funds}`);

    // 5. Get UEA Nonce
    this.printLog('Fetching UEA nonce');
    const nonce = isUEADeployed ? await this.getUEANonce(UEA) : BigInt(0);
    this.printLog(`Current Nonce: ${nonce}`);

    // 6. Create execution hash ( execution data to be signed )
    const universalPayload = JSON.parse(
      JSON.stringify(
        {
          to: execute.to,
          value: execute.value,
          data: execute.data || '0x',
          gasLimit: execute.gasLimit || BigInt(1e7),
          maxFeePerGas: execute.maxFeePerGas || BigInt(1e10),
          maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(0),
          nonce,
          deadline: execute.deadline || BigInt(9999999999),
          sigType: SignatureType.signedVerification,
        },
        this.bigintReplacer
      )
    ) as UniversalPayload;
    const executionHash = this.computeExecutionHash({
      verifyingContract: UEA,
      payload: universalPayload,
    });
    this.printLog(`Universal Payload Hash: ${executionHash}`);

    // 7. If not enough funds, lock required fee on source chain and send tx to Push chain
    let feeLockTxHash: string | undefined = execute.feeLockTxHash;
    if (funds < requiredFunds && !feeLockTxHash) {
      const fundDifference = requiredFunds - funds;
      this.printLog(`Insufficient funds, locking funds ${fundDifference} upc`);

      const fundDifferenceInUSDC = this.pushClient.pushToUSDC(fundDifference); // ( USDC with 8 decimal points )
      feeLockTxHash = await this.lockFee(fundDifferenceInUSDC, executionHash);
      this.printLog(`Fee lock TxHash: ${feeLockTxHash}`);

      this.printLog(
        'Waiting for Block Confirmations of Fee lock Tx on Origin Chain'
      );
      await this.waitForLockerFeeConfirmation(feeLockTxHash);
      this.printLog('Enough Confirmations received');
    }

    // 8. Sign execution data
    this.printLog(`Signing Universal Payload`);
    const signature = await this.signUniversalPayload(universalPayload, UEA);
    this.printLog(`Signature: ${bytesToHex(signature)}`);

    // 9. Send Tx to Push chain
    this.printLog('Sending transaction to Push chain');
    // Serialize & parse in one go to convert all bigint → string
    const serializedPayload = JSON.parse(
      JSON.stringify(universalPayload, this.bigintReplacer)
    ) as UniversalPayload;

    const tx = await this.sendUniversalTx(
      isUEADeployed,
      feeLockTxHash,
      serializedPayload,
      signature
    );
    this.printLog(`Tx: ${JSON.stringify(tx, this.bigintReplacer, 2)}`);
    return tx;
  }

  /**
   * Locks a fee on the origin chain by interacting with the chain's fee-locker contract.
   *
   * @param amount - Fee amount in USDC (8 Decimals)
   * @param executionHash - Optional execution payload hash (default: zeroHash)
   * @returns Transaction hash of the locking transaction
   */
  private async lockFee(
    amount: bigint, // USD with 8 decimals
    executionHash: string = zeroHash
  ): Promise<string> {
    const chain = this.universalSigner.account.chain;
    const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;
    const priceFetcher = new PriceFetch(this.rpcUrls);
    const nativeTokenUsdPrice = await priceFetcher.getPrice(chain); // 8 decimals

    let nativeAmount: bigint;

    switch (vm) {
      case VM.EVM: {
        const nativeDecimals = 18; // ETH, MATIC, etc.
        nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const evmClient = new EvmClient({ rpcUrls });

        return await evmClient.writeContract({
          abi: FEE_LOCKER_EVM as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: nativeAmount,
        });
      }

      case VM.SVM: {
        const nativeDecimals = 9; // SOL lamports
        nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const svmClient = new SvmClient({ rpcUrls });

        const [lockerPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from('locker')],
          new PublicKey(lockerContract)
        );

        return await svmClient.writeContract({
          abi: FEE_LOCKER_SVM,
          address: lockerContract,
          functionName: 'addFunds',
          args: [nativeAmount, toBytes(executionHash)],
          signer: this.universalSigner,
          accounts: {
            locker: lockerPda,
            user: new PublicKey(this.universalSigner.account.address),
            priceUpdate: new PublicKey(
              '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
            ),
            systemProgram: SystemProgram.programId,
          },
        });
      }

      default:
        throw new Error(`Unsupported VM type: ${vm}`);
    }
  }

  private async signUniversalPayload(
    universalPayload: UniversalPayload,
    verifyingContract: `0x${string}`,
    version?: string
  ) {
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        if (!this.universalSigner.signTypedData) {
          throw new Error('signTypedData is not defined');
        }
        return this.universalSigner.signTypedData({
          domain: {
            version: version || '0.1.0',
            chainId: Number(this.pushClient.pushChainInfo.chainId),
            verifyingContract,
          },
          types: {
            UniversalPayload: [
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'sigType', type: 'uint8' },
            ],
          },
          primaryType: 'UniversalPayload',
          message: universalPayload,
        });
      }

      case VM.SVM: {
        const digest = this.computeExecutionHash({
          chainId: Number(this.pushClient.pushChainInfo.chainId),
          verifyingContract,
          payload: universalPayload,
          version: version || '0.1.0',
        });
        return this.universalSigner.signMessage(stringToBytes(digest));
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  /**
   * Sends a custom Cosmos tx to Push Chain (gasless) to execute user intent.
   */
  public async sendUniversalTx(
    isUEADeployed: boolean,
    feeLockTxHash?: string,
    universalPayload?: UniversalPayload,
    signature?: Uint8Array
  ): Promise<DeliverTxResponse> {
    const { chain, address } = this.universalSigner.account;
    const { vm } = CHAIN_INFO[chain];

    const universalAccount = {
      chain,
      owner:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(bs58.decode(address))
          : address,
    };

    const { cosmosAddress: signer } = this.pushClient.getSignerAddress();
    const msgs: Any[] = [];

    if (!isUEADeployed) {
      /**
       * @dev - fee should be locked for UEA deployment to avoid spamming
       */
      if (!feeLockTxHash) {
        throw new Error('UEA cannot be deployed without fee locking');
      }
      msgs.push(
        this.pushClient.createMsgDeployUEA({
          signer,
          universalAccount,
          txHash: feeLockTxHash,
        })
      );
    }

    if (feeLockTxHash) {
      msgs.push(
        this.pushClient.createMsgMintPC({
          signer,
          universalAccount,
          txHash: feeLockTxHash,
        })
      );
    }

    if (universalPayload && signature) {
      msgs.push(
        this.pushClient.createMsgExecutePayload({
          signer,
          universalAccount,
          universalPayload,
          signature: bytesToHex(signature),
        })
      );
    }

    const txBody = await this.pushClient.createCosmosTxBody(msgs);
    const txRaw = await this.pushClient.signCosmosTx(txBody);
    return this.pushClient.broadcastCosmosTx(txRaw);
  }

  /**
   * Computes the EIP-712 digest hash for the UniversalPayload structure.
   * This is the message that should be signed by the user's wallet (e.g., Solana signer).
   *
   * The resulting hash is equivalent to:
   * keccak256("\x19\x01" || domainSeparator || structHash)
   *
   * @param chainId - EVM chain ID of the destination chain (Push Chain)
   * @param verifyingContract - Address of the verifying contract (i.e., the user's UEA smart wallet)
   * @param version - Optional EIP-712 domain version (default: '0.1.0')
   * @param payload - Execution details encoded into the UniversalPayload struct
   * @returns keccak256 digest to be signed by the user
   */
  private computeExecutionHash({
    chainId = Number(this.pushClient.pushChainInfo.chainId),
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    chainId?: number;
    verifyingContract: `0x${string}`;
    version?: string;
    payload: UniversalPayload;
  }): `0x${string}` {
    // 1. Type hash
    const typeHash = keccak256(
      toBytes(
        'UniversalPayload(address to,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline,uint8 sigType)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          BigInt(chainId),
          verifyingContract,
        ]
      )
    );

    // 3. Struct hash
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'dataHash', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'sigType', type: 'uint8' },
        ],
        [
          typeHash,
          payload.to as `0x${string}`,
          BigInt(payload.value),
          keccak256(payload.data as `0x${string}`),
          BigInt(payload.gasLimit),
          BigInt(payload.maxFeePerGas),
          BigInt(payload.maxPriorityFeePerGas),
          BigInt(payload.nonce),
          BigInt(payload.deadline),
          payload.sigType,
        ]
      )
    );

    // 4. Final digest
    return keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );
  }

  /**
   * Computes UEA for given UniversalAccount
   * @dev - This fn calls a view fn of Factory Contract
   * @returns UEA Address with Deployment Status
   */
  async computeUEA(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    const { chain, address } = this.universalSigner.account;
    const { vm } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      throw new Error('UEA cannot be computed for a Push Chain Address');
    }

    const computedAddress: `0x{string}` = await this.pushClient.readContract({
      address: this.pushClient.pushChainInfo.factoryAddress,
      abi: FACTORY_V1 as Abi,
      functionName: 'computeUEA',
      args: [
        {
          chain,
          /**
           * @dev - Owner should be in bytes
           * for eth - convert hex to bytes
           * for sol - convert base64 to bytes
           * for others - not defined yet
           */
          owner:
            vm === VM.EVM
              ? address
              : vm === VM.SVM
              ? bytesToHex(bs58.decode(address))
              : address,
        },
      ],
    });

    const byteCode = await this.pushClient.publicClient.getCode({
      address: computedAddress,
    });
    return { address: computedAddress, deployed: byteCode !== undefined };
  }

  computeUEAOffchain(): `0x${string}` {
    const { chain, address } = this.universalSigner.account;
    const { implementationAddress } = CHAIN_INFO[chain];

    // If already an on-chain Push EOA, just return it
    if (this.isPushChain(chain)) {
      return address as `0x${string}`;
    }

    // 1) Figure out the external‐chain ownerKey bytes
    let ownerKey: `0x${string}`;
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      ownerKey = address as `0x${string}`;
    } else if (CHAIN_INFO[chain].vm === VM.SVM) {
      ownerKey = bytesToHex(bs58.decode(address));
    } else {
      throw new Error(`Unsupported VM type: ${CHAIN_INFO[chain].vm}`);
    }

    // Step 1: Recreate the salt: keccak256(abi.encode(UniversalAccount))
    const encodedAccountId = encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'chain', type: 'string' },
            { name: 'owner', type: 'bytes' },
          ],
        },
      ],
      [{ chain, owner: ownerKey }]
    );

    const salt = keccak256(encodedAccountId);

    // Step 2: Clone Minimal Proxy bytecode
    const minimalProxyRuntimeCode = ('0x3d602d80600a3d3981f3' +
      '363d3d373d3d3d363d73' +
      implementationAddress.toLowerCase().replace(/^0x/, '') +
      '5af43d82803e903d91602b57fd5bf3') as `0x${string}`;

    // Step 3: Get init code hash (used by CREATE2)
    const initCodeHash = keccak256(minimalProxyRuntimeCode);

    // Step 4: Predict the address using standard CREATE2 formula
    return getCreate2Address({
      from: this.pushClient.pushChainInfo.factoryAddress,
      salt,
      bytecodeHash: initCodeHash,
    });
  }

  /**
   * @dev - Although as of now nonce var is same in evm & svm so switch conditions does not matter
   * @param address UEA address
   * @returns UEA current nonce
   */
  private async getUEANonce(address: `0x${string}`): Promise<bigint> {
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_EVM as Abi,
          functionName: 'nonce',
        });
      }

      case VM.SVM: {
        return this.pushClient.readContract({
          address,
          abi: UEA_SVM as Abi,
          functionName: 'nonce',
        });
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

  // TODO: Fix this fn - It needs to get UOA for a given UEA
  getUOA(): UniversalAccount {
    return {
      chain: this.universalSigner.account.chain,
      address: this.universalSigner.account.address,
    };
  }

  private async waitForLockerFeeConfirmation(txHash: string): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const { vm, defaultRPC } = CHAIN_INFO[chain];
    const rpcUrls = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });
        await evmClient.waitForConfirmations({
          txHash: txHash as `0x${string}`,
        });
        return;
      }

      case VM.SVM: {
        const svmClient = new SvmClient({ rpcUrls });
        await svmClient.waitForConfirmations({ txSignature: txHash });
        return;
      }

      default:
        throw new Error(`Unsupported VM for tx confirmation: ${vm}`);
    }
  }

  /********************************** HELPER FUNCTIONS **************************************************/

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bigintReplacer(_key: string, value: any) {
    return typeof value === 'bigint'
      ? value.toString() // convert BigInt to string
      : value;
  }

  /**
   * Checks if the given chain belongs to the Push Chain ecosystem.
   * Used to differentiate logic for Push-native interactions vs external chains.
   *
   * @param chain - The chain identifier (e.g., PUSH_MAINNET, PUSH_TESTNET_DONUT)
   * @returns True if the chain is a Push chain, false otherwise.
   */
  private isPushChain(chain: CHAIN): boolean {
    return (
      chain === CHAIN.PUSH_MAINNET ||
      chain === CHAIN.PUSH_TESTNET_DONUT ||
      chain === CHAIN.PUSH_LOCALNET
    );
  }

  private validateMainnetConnection(chain: CHAIN) {
    const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
      chain
    );
    if (
      isMainnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
    ) {
      throw new Error('Mainnet chains can only interact with Push Mainnet');
    }
  }

  private printLog(log: string): void {
    if (this.printTraces) {
      console.log(`[${this.constructor.name}] ${log}`);
    }
  }
}
