import {
  Abi,
  zeroHash,
  toBytes,
  keccak256,
  encodeAbiParameters,
  encodePacked,
  bytesToHex,
  stringToBytes,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO, VM_NAMESPACE } from '../constants/chain';
import {
  FACTORY_V1,
  FEE_LOCKER_EVM,
  FEE_LOCKER_SVM,
  SMART_ACCOUNT_EVM,
  SMART_ACCOUNT_SVM,
} from '../constants/abi';
import { PushClient } from '../push-client/push-client';
import { SvmClient } from '../vm-client/svm-client';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Any } from 'cosmjs-types/google/protobuf/any';
import { AccountId, CrossChainPayload, vmType } from '../generated/v1/tx';
import { PriceFetch } from '../price-fetch/price-fetch';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { AbiCoder, ethers } from 'ethers';

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
  async execute(execute: ExecuteParams): Promise<string> {
    const chain = this.universalSigner.account.chain;

    if (!execute.data) {
      execute.data = '0x';
    }

    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Starting cross-chain execution from chain: ${chain}`
      );
    }

    // Add validation that if sepolia, or any origin testnet, you can only interact with Push testnet. Same for mainnet
    const isTestnet = [
      CHAIN.ETHEREUM_SEPOLIA,
      CHAIN.SOLANA_TESTNET,
      CHAIN.SOLANA_DEVNET,
    ].includes(chain);

    const isMainnet = [CHAIN.ETHEREUM_MAINNET, CHAIN.SOLANA_MAINNET].includes(
      chain
    );

    if (
      isTestnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_LOCALNET].chainId
    ) {
      throw new Error(
        'Testnet chains can only interact with Push Testnet or Localnet'
      );
    }

    if (
      isMainnet &&
      this.pushClient.pushChainInfo.chainId !==
        CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId
    ) {
      throw new Error('Mainnet chains can only interact with Push Mainnet');
    }

    // 1. Execute direct tx if signer is already on Push Chain
    if (this.isPushChain(chain)) {
      return this.pushClient.sendTransaction({
        to: execute.target,
        data: execute.data,
        value: execute.value,
        signer: this.universalSigner,
      });
    }

    // 2. Get Push chain NMSC address for this signer
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Fetching NMSC address for UniversalSigner`
      );
    }
    const { address: nmscAddress, deployed: isNMSCDeployed } =
      await this.getNMSCAddress();

    if (this.printTraces) {
      console.log(`[${this.constructor.name}] NMSC Address: ${nmscAddress}`);
      console.log(`[${this.constructor.name}] Deployed: ${isNMSCDeployed}`);
    }

    // 3. Estimate funds required for the execution
    if (this.printTraces) {
      console.log(`[${this.constructor.name}] Estimating cost of execution`);
    }

    const gasEstimate = await this.pushClient.estimateGas({
      to: execute.target,
      data: execute.data,
      // value: execute.value, @DEV - taking 0 as of now
    });

    if (this.printTraces) {
      console.log(`[${this.constructor.name}] GasEstimate: ${gasEstimate}`);
    }

    // Fetch current gas price
    if (this.printTraces) {
      console.log(`[${this.constructor.name}] Fetching Gas Price`);
    }
    const gasPrice = await this.pushClient.getGasPrice();

    if (this.printTraces) {
      console.log(`[${this.constructor.name}] Gas Price: ${gasPrice}`);
    }

    // Add 10% buffer as integer math
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Calculating estimated gas fee for execution`
      );
    }
    const requiredGasFee = (gasEstimate * gasPrice * BigInt(110)) / BigInt(100);
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Required Gas Fee: ${requiredGasFee}`
      );
    }
    // Total funds = gas fee + value being sent
    const requiredFunds = requiredGasFee + execute.value;

    // 4. Check NMSC balance on Push Chain ( in nPUSH )
    if (this.printTraces) {
      console.log(`${this.constructor.name}]  Checking NMSC balance...`);
    }
    const funds = await this.pushClient.getBalance(nmscAddress);
    if (this.printTraces) {
      console.log(`[${this.constructor.name}]  Current balance: ${funds}`);
    }

    // 5. Get NMSC Nonce
    const nonce = isNMSCDeployed
      ? await this.getNMSCNonce(nmscAddress)
      : BigInt(0);

    // 6. Create execution hash ( execution data to be signed )
    const crosschainPayload = {
      target: execute.target,
      value: execute.value,
      data: execute.data,
      gasLimit: execute.gasLimit || BigInt(21000000),
      maxFeePerGas: execute.maxFeePerGas || BigInt(10000000000000000),
      maxPriorityFeePerGas: execute.maxPriorityFeePerGas || BigInt(2),
      nonce,
      deadline: execute.deadline || BigInt(9999999999),
    };
    const executionHash = this.computeExecutionHash({
      verifyingContract: nmscAddress,
      payload: crosschainPayload,
    });
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Execution hash: ${executionHash}`
      );
    }

    // 7. If not enough funds, lock required fee on source chain and send tx to Push chain
    let feeLockTxHash: string | undefined = execute.feeLockTxHash;
    if (funds < requiredFunds && !feeLockTxHash) {
      if (this.printTraces) {
        console.log(
          `[${this.constructor.name}] Insufficient funds, locking additional fees...`
        );
      }
      const fundDifference = requiredFunds - funds;
      const fundDifferenceInUSDC = this.pushClient.pushToUSDC(fundDifference); // ( USDC with 8 decimal points )
      feeLockTxHash = await this.lockFee(fundDifferenceInUSDC, executionHash);

      if (this.printTraces) {
        console.log(
          `[${this.constructor.name}] Fee lock transaction hash: ${feeLockTxHash}`
        );
      }

      if (this.printTraces) {
        console.log(
          `[${this.constructor.name}] Waiting for Block Confirmations..`
        );
      }
      await this.waitForLockerFeeConfirmation(feeLockTxHash);

      if (this.printTraces) {
        console.log(
          `[${this.constructor.name}] Enough Origin Chain Block confirmations received`
        );
      }
    }

    if (this.printTraces) {
      console.log(`[${this.constructor.name}] Signing execution data...`);
    }

    // 8. Sign execution data
    const signature = await this.signCrossChainPayload(
      crosschainPayload,
      nmscAddress
    );
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Execution data signed successfully`
      );
    }

    // 8. Send Tx to Push chain
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Sending transaction to Push chain...`
      );
    }
    const txHash = await this.sendCrossChainPushTx(
      isNMSCDeployed,
      feeLockTxHash,
      {
        ...crosschainPayload,
        value: crosschainPayload.value.toString(),
        gasLimit: crosschainPayload.gasLimit.toString(),
        maxFeePerGas: crosschainPayload.maxFeePerGas.toString(),
        maxPriorityFeePerGas: crosschainPayload.maxPriorityFeePerGas.toString(),
        nonce: crosschainPayload.nonce.toString(),
        deadline: crosschainPayload.deadline.toString(),
      },
      signature
    );
    if (this.printTraces) {
      console.log(
        `[${this.constructor.name}] Transaction sent successfully. Hash: ${txHash}`
      );
    }

    return txHash;
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

        const [lockerPda, lockerBump] =
          anchor.web3.PublicKey.findProgramAddressSync(
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

  private async signCrossChainPayload(
    crosschainPayload: {
      target: `0x${string}`;
      value: bigint;
      data: `0x${string}`;
      gasLimit: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      nonce: bigint;
      deadline: bigint;
    },
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
            CrossChainPayload: [
              { name: 'target', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'data', type: 'bytes' },
              { name: 'gasLimit', type: 'uint256' },
              { name: 'maxFeePerGas', type: 'uint256' },
              { name: 'maxPriorityFeePerGas', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
            ],
          },
          primaryType: 'CrossChainPayload',
          message: crosschainPayload,
        });
      }

      case VM.SVM: {
        const digest = this.computeExecutionHash({
          chainId: Number(this.pushClient.pushChainInfo.chainId),
          verifyingContract,
          payload: crosschainPayload,
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
  public async sendCrossChainPushTx(
    isNMSCDeployed: boolean,
    feeLockTxHash?: string,
    crosschainPayload?: CrossChainPayload,
    signature?: Uint8Array
  ): Promise<string> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    const accountId: AccountId = {
      namespace: VM_NAMESPACE[vm],
      chainId,
      ownerKey:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(bs58.decode(address))
          : address,
      vmType: vmType[vm],
    };

    const { cosmosAddress: signer } = this.pushClient.getSignerAddress();
    const msgs: Any[] = [];

    if (!isNMSCDeployed) {
      /**
       * @dev - fee should be locked for NMSC deployment to avoid spamming
       */
      if (!feeLockTxHash) {
        throw new Error('NMSC cannot be deployed without fee locking');
      }
      msgs.push(
        this.pushClient.createMsgDeployNMSC({
          signer,
          accountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (feeLockTxHash) {
      msgs.push(
        this.pushClient.createMsgMintPush({
          signer,
          accountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (crosschainPayload && signature) {
      msgs.push(
        this.pushClient.createMsgExecutePayload({
          signer,
          accountId,
          crosschainPayload,
          signature: bytesToHex(signature),
        })
      );
    }

    const txBody = await this.pushClient.createCosmosTxBody(msgs);
    const txRaw = await this.pushClient.signCosmosTx(txBody);
    const txresponse = await this.pushClient.broadcastCosmosTx(txRaw);

    if (txresponse.code === 0) {
      return txresponse.transactionHash;
    } else {
      throw new Error(txresponse.rawLog);
    }
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

  /**
   * Computes the EIP-712 digest hash for the CrossChainPayload structure.
   * This is the message that should be signed by the user's wallet (e.g., Solana signer).
   *
   * The resulting hash is equivalent to:
   * keccak256("\x19\x01" || domainSeparator || structHash)
   *
   * @param chainId - EVM chain ID of the destination chain (Push Chain)
   * @param verifyingContract - Address of the verifying contract (i.e., the user's NMSC smart wallet)
   * @param version - Optional EIP-712 domain version (default: '0.1.0')
   * @param payload - Execution details encoded into the CrossChainPayload struct
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
    payload: {
      target: `0x${string}`;
      value: bigint;
      data: `0x${string}`;
      gasLimit: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      nonce: bigint;
      deadline: bigint;
    };
  }): `0x${string}` {
    // 1. Hash the type signature
    const typeHash = keccak256(
      toBytes(
        'CrossChainPayload(address target,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline)'
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
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'dataHash', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
        [
          typeHash,
          payload.target,
          payload.value,
          keccak256(payload.data),
          payload.gasLimit,
          payload.maxFeePerGas,
          payload.maxPriorityFeePerGas,
          payload.nonce,
          payload.deadline,
        ]
      )
    );

    // 4. Final digest: keccak256("\x19\x01" || domainSeparator || structHash)
    const digest = keccak256(
      encodePacked(
        ['string', 'bytes32', 'bytes32'],
        ['\x19\x01', domainSeparator, structHash]
      )
    );

    return digest;
  }

  /**
   * Computes the smart wallet (NMSC) on Push Chain.
   */
  // TODO: DON'T CALL THIS FUNCTION FOR .ADDRESS. MAKE FUNCTION SYNC.
  // TODO: CREATE ANOTHER FUNCTION TO CHECK IF NMSC IS DEPLOYED.
  async getNMSCAddress(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      throw new Error(
        'NMSC address cannot be computed for a Push Chain Address'
      );
    }

    const computedAddress: `0x{string}` = await this.pushClient.readContract({
      address: this.pushClient.pushChainInfo.factoryAddress,
      abi: FACTORY_V1 as Abi,
      functionName: 'computeSmartAccountAddress',
      args: [
        {
          namespace: VM_NAMESPACE[vm],
          chainId,
          /**
           * @dev - OwnerKey should be in bytes
           * for eth - convert hex to bytes
           * for sol - convert base64 to bytes
           * for others - not defined yet
           */
          ownerKey:
            vm === VM.EVM
              ? address
              : vm === VM.SVM
              ? bytesToHex(bs58.decode(address))
              : address,
          /**
           * @dev
           * 0 -> evm
           * 1 -> svm
           * Rest are not defined
           */
          vmType: vm === VM.EVM ? 0 : vm === VM.SVM ? 1 : 2,
        },
      ],
    });

    const byteCode = await this.pushClient.publicClient.getCode({
      address: computedAddress,
    });
    return { address: computedAddress, deployed: byteCode !== undefined };
  }

  // TODO: Convert to viem
  calculateUEAOffchain(): `0x${string}` {
    const { chain, address } = this.universalSigner.account;
    const { vm, implementationAddress, chainId } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      return address as `0x${string}`;
    }

    let ownerKey: `0x${string}`;
    if (vm === VM.EVM) {
      ownerKey = address as `0x${string}`;
    } else if (vm === VM.SVM) {
      ownerKey = bytesToHex(bs58.decode(address));
    } else {
      throw new Error(`Unsupported VM type: ${vm}`);
    }

    const accountId = {
      namespace: VM_NAMESPACE[vm],
      chainId,
      ownerKey,
      vmType: vm === VM.EVM ? 0 : vm === VM.SVM ? 1 : 2,
    };

    // Step 1: Recreate the salt: keccak256(abi.encode(AccountId))
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encodedAccountId = abiCoder.encode(
      ['tuple(string namespace,string chainId,bytes ownerKey,uint8 vmType)'],
      [
        [
          accountId.namespace,
          accountId.chainId,
          accountId.ownerKey,
          accountId.vmType,
        ],
      ]
    );

    const salt = ethers.keccak256(encodedAccountId);

    // Step 2: Clone Minimal Proxy bytecode
    const minimalProxyRuntimeCode =
      '0x3d602d80600a3d3981f3' +
      '363d3d373d3d3d363d73' +
      implementationAddress.toLowerCase().replace(/^0x/, '') +
      '5af43d82803e903d91602b57fd5bf3';

    // Step 3: Get init code hash (used by CREATE2)
    const initCodeHash = ethers.keccak256(minimalProxyRuntimeCode);

    // Step 4: Predict the address using standard CREATE2 formula
    const predictedAddress = ethers.getCreate2Address(
      this.pushClient.pushChainInfo.factoryAddress,
      salt,
      initCodeHash
    );

    return predictedAddress as `0x${string}`;
  }

  /**
   * @dev - Although as of now nonce var is same in evm & svm so switch conditions does not matter
   * @param address NMSC address
   * @returns NMSC current nonce
   */
  private async getNMSCNonce(address: `0x${string}`): Promise<bigint> {
    const chain = this.universalSigner.account.chain;
    const { vm } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        return this.pushClient.readContract({
          address,
          abi: SMART_ACCOUNT_EVM as Abi,
          functionName: 'nonce',
        });
      }

      case VM.SVM: {
        return this.pushClient.readContract({
          address,
          abi: SMART_ACCOUNT_SVM as Abi,
          functionName: 'nonce',
        });
      }

      default: {
        throw new Error(`Unsupported VM type: ${vm}`);
      }
    }
  }

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
}
