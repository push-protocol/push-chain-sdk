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
  hexToBytes,
} from 'viem';
import { CHAIN, PUSH_NETWORK, VM } from '../constants/enums';
import {
  UniversalAccount,
  UniversalSigner,
} from '../universal/universal.types';
import { ExecuteParams } from './orchestrator.types';
import { EvmClient } from '../vm-client/evm-client';
import { CHAIN_INFO, NETWORK_VM_UEA, VM_NAMESPACE } from '../constants/chain';
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
import {
  UniversalPayload,
  VerificationType,
  UniversalAccountId,
} from '../generated/v1/tx';
import { PriceFetch } from '../price-fetch/price-fetch';
import { utils } from '@coral-xyz/anchor';
import {
  PROGRESS_HOOK,
  ProgressEvent,
} from '../progress-hook/progress-hook.types';
import PROGRESS_HOOKS from '../progress-hook/progress-hook';
import { TxResponse } from '../vm-client/vm-client.types';
import { OrchestratorCache } from './cache';

export class Orchestrator {
  private pushClient: PushClient;
  private cache: OrchestratorCache;

  constructor(
    private readonly universalSigner: UniversalSigner,
    private pushNetwork: PUSH_NETWORK,
    private readonly rpcUrls: Partial<Record<CHAIN, string[]>> = {},
    private readonly printTraces = false,
    private progressHook?: (progress: ProgressEvent) => void
  ) {
    this.cache = new OrchestratorCache();
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
  async execute(execute: ExecuteParams): Promise<TxResponse> {
    try {
      const chain = this.universalSigner.account.chain;
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_01, chain);
      this.validateMainnetConnection(chain);
      /**
       * Push to Push Tx
       */
      if (this.isPushChain(chain)) {
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06);
        const tx = await this.sendPushTx(execute);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, [tx]);
        return tx;
      }
      /**
       * Fetch Gas details and estimate cost of execution
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_01);
      const gasEstimate = execute.gasLimit || BigInt(1e7);
      const gasPrice = await this.pushClient.getGasPrice();
      const requiredGasFee = gasEstimate * gasPrice;
      const requiredFunds = requiredGasFee + execute.value;
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_02_02, requiredFunds);
      /**
       * Fetch UEA Details
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_03_01);
      const UEA = this.computeUEAOffchain();
      const [code, funds] = await Promise.all([
        this.pushClient.publicClient.getCode({ address: UEA }),
        this.pushClient.getBalance(UEA),
      ]);
      const isUEADeployed = code !== undefined;
      const nonce = isUEADeployed ? await this.getUEANonce(UEA) : BigInt(0);
      this.executeProgressHook(
        PROGRESS_HOOK.SEND_TX_03_02,
        UEA,
        isUEADeployed,
        funds,
        nonce
      );
      /**
       * Compute Universal Payload Hash
       */
      let feeLockTxHash: string | undefined = execute.feeLockTxHash;
      if (feeLockTxHash && !feeLockTxHash.startsWith('0x')) {
        // decode svm base58
        feeLockTxHash = bytesToHex(utils.bytes.bs58.decode(feeLockTxHash));
      }
      const feeLockingRequired = funds < requiredFunds && !feeLockTxHash;
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
            vType: feeLockingRequired
              ? VerificationType.universalTxVerification
              : VerificationType.signedVerification,
          },
          this.bigintReplacer
        )
      ) as UniversalPayload;
      const executionHash = this.computeExecutionHash({
        verifyingContract: UEA,
        payload: universalPayload,
      });
      /**
       * Prepare verification data by either signature or fund locking
       */
      let verificationData: `0x${string}`;
      if (!feeLockingRequired) {
        /**
         * Sign Universal Payload
         */
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_01, executionHash);
        const signature = await this.signUniversalPayload(
          universalPayload,
          UEA
        );
        verificationData = bytesToHex(signature);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_04_02, verificationData);
      } else {
        /**
         * Fee Locking
         */
        const fundDifference = requiredFunds - funds;
        const fundDifferenceInUSD = this.pushClient.pushToUSDC(fundDifference); // ( USD with 8 decimal points )
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_05_01, fundDifference);
        const feeLockTxHashBytes = await this.lockFee(
          fundDifferenceInUSD,
          executionHash
        );
        feeLockTxHash = bytesToHex(feeLockTxHashBytes);
        verificationData = bytesToHex(feeLockTxHashBytes);
        /**
         * Waiting for Confirmations
         */
        const { vm } = CHAIN_INFO[chain];

        this.executeProgressHook(
          PROGRESS_HOOK.SEND_TX_05_02,
          vm === VM.SVM
            ? utils.bytes.bs58.encode(feeLockTxHashBytes)
            : feeLockTxHash,
          CHAIN_INFO[chain].confirmations
        );
        await this.waitForLockerFeeConfirmation(feeLockTxHashBytes);
        this.executeProgressHook(PROGRESS_HOOK.SEND_TX_05_03);
      }
      /**
       * Broadcasting Tx to PC
       */
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_06);
      const transactions = await this.sendUniversalTx(
        isUEADeployed,
        feeLockTxHash,
        universalPayload,
        verificationData
      );
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_01, transactions);
      return transactions[transactions.length - 1];
    } catch (err) {
      this.executeProgressHook(PROGRESS_HOOK.SEND_TX_99_02, err);
      throw err;
    }
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
  ): Promise<Uint8Array> {
    const chain = this.universalSigner.account.chain;
    const { lockerContract, vm, defaultRPC } = CHAIN_INFO[chain];

    if (!lockerContract) {
      throw new Error(`Locker contract not configured for chain: ${chain}`);
    }

    const rpcUrls: string[] = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        // Run price fetching and client creation in parallel
        const [nativeTokenUsdPrice, evmClient] = await Promise.all([
          new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
          Promise.resolve(new EvmClient({ rpcUrls })),
        ]);

        const nativeDecimals = 18; // ETH, MATIC, etc.
        const nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const txHash = await evmClient.writeContract({
          abi: FEE_LOCKER_EVM as Abi,
          address: lockerContract,
          functionName: 'addFunds',
          args: [executionHash],
          signer: this.universalSigner,
          value: nativeAmount,
        });
        return hexToBytes(txHash);
      }

      case VM.SVM: {
        // Run price fetching, client creation, and PDA computation in parallel
        const [nativeTokenUsdPrice, svmClient, [lockerPda]] = await Promise.all(
          [
            new PriceFetch(this.rpcUrls).getPrice(chain), // 8 decimals
            Promise.resolve(new SvmClient({ rpcUrls })),
            Promise.resolve(
              anchor.web3.PublicKey.findProgramAddressSync(
                [Buffer.from('locker')],
                new PublicKey(lockerContract)
              )
            ),
          ]
        );

        const nativeDecimals = 9; // SOL lamports
        const nativeAmount =
          (amount * BigInt(10 ** nativeDecimals)) / nativeTokenUsdPrice;

        const txHash = await svmClient.writeContract({
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
        return utils.bytes.bs58.decode(txHash);
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
    const { vm, chainId } = CHAIN_INFO[chain];

    switch (vm) {
      case VM.EVM: {
        if (!this.universalSigner.signTypedData) {
          throw new Error('signTypedData is not defined');
        }
        return this.universalSigner.signTypedData({
          domain: {
            version: version || '0.1.0',
            chainId: Number(chainId),
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
              { name: 'vType', type: 'uint8' },
            ],
          },
          primaryType: 'UniversalPayload',
          message: universalPayload,
        });
      }

      case VM.SVM: {
        const digest = this.computeExecutionHash({
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
  private async sendUniversalTx(
    isUEADeployed: boolean,
    feeLockTxHash?: string,
    universalPayload?: UniversalPayload,
    verificationData?: `0x${string}`
  ): Promise<TxResponse[]> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    const universalAccountId: UniversalAccountId = {
      chainNamespace: VM_NAMESPACE[vm],
      chainId: chainId,
      owner:
        vm === VM.EVM
          ? address
          : vm === VM.SVM
          ? bytesToHex(utils.bytes.bs58.decode(address))
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
          universalAccountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (feeLockTxHash) {
      msgs.push(
        this.pushClient.createMsgMintPC({
          signer,
          universalAccountId,
          txHash: feeLockTxHash,
        })
      );
    }

    if (universalPayload && verificationData) {
      msgs.push(
        this.pushClient.createMsgExecutePayload({
          signer,
          universalAccountId,
          universalPayload,
          verificationData,
        })
      );
    }

    const txBody = await this.pushClient.createCosmosTxBody(msgs);
    const txRaw = await this.pushClient.signCosmosTx(txBody);
    const tx = await this.pushClient.broadcastCosmosTx(txRaw);
    if (tx.code !== 0) {
      throw new Error(tx.rawLog);
    }

    const ethTxHashes: `0x${string}`[] =
      tx.events
        ?.filter((e: any) => e.type === 'ethereum_tx')
        .flatMap((e: any) =>
          e.attributes
            ?.filter((attr: any) => attr.key === 'ethereumTxHash')
            .map((attr: any) => attr.value as `0x${string}`)
        ) ?? [];

    if (ethTxHashes.length === 0) {
      throw new Error('No ethereumTxHash found in transaction events');
    }

    // 🔗 Fetch all corresponding EVM transactions in parallel
    const evmTxs = await Promise.all(
      ethTxHashes.map(async (hash) => {
        return await this.pushClient.getTransaction(hash);
      })
    );

    return evmTxs;
  }

  /**
   * Sends a EVM trx on Push Chain
   * @dev - Only to be used from universal signer is on Push chain
   * @param execute
   * @returns Cosmos Tx Response for a given Evm Tx
   */
  private async sendPushTx(execute: ExecuteParams): Promise<TxResponse> {
    const txHash = await this.pushClient.sendTransaction({
      to: execute.to,
      data: execute.data || '0x',
      value: execute.value,
      signer: this.universalSigner,
    });
    return this.pushClient.getTransaction(txHash);
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
    verifyingContract,
    payload,
    version = '0.1.0',
  }: {
    verifyingContract: `0x${string}`;
    version?: string;
    payload: UniversalPayload;
  }): `0x${string}` {
    const chain = this.universalSigner.account.chain;
    const { vm, chainId } = CHAIN_INFO[chain];

    // 1. Type hash
    const typeHash = keccak256(
      toBytes(
        'UniversalPayload(address to,uint256 value,bytes data,uint256 gasLimit,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,uint256 nonce,uint256 deadline,uint8 vType)'
      )
    );

    // 2. Domain separator
    const domainTypeHash = keccak256(
      toBytes(
        vm === VM.EVM
          ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract)'
          : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract)'
      )
    );

    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { name: 'typeHash', type: 'bytes32' },
          { name: 'version', type: 'bytes32' },
          { name: 'chainId', type: vm === VM.EVM ? 'uint256' : 'string' },
          { name: 'verifyingContract', type: 'address' },
        ],
        [
          domainTypeHash,
          keccak256(toBytes(version)),
          vm === VM.EVM ? BigInt(chainId) : chainId,
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
          { name: 'data', type: 'bytes32' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'maxFeePerGas', type: 'uint256' },
          { name: 'maxPriorityFeePerGas', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'vType', type: 'uint8' },
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
          payload.vType,
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
   * @dev - Don't use this fn in production - only used for testing
   * @returns UEA Address with Deployment Status
   */
  async computeUEA(): Promise<{
    address: `0x${string}`;
    deployed: boolean;
  }> {
    const { chain, address } = this.universalSigner.account;
    const { vm, chainId } = CHAIN_INFO[chain];

    if (this.isPushChain(chain)) {
      throw new Error('UEA cannot be computed for a Push Chain Address');
    }

    const computedAddress: `0x{string}` = await this.pushClient.readContract({
      address: this.pushClient.pushChainInfo.factoryAddress,
      abi: FACTORY_V1 as Abi,
      functionName: 'computeUEA',
      args: [
        {
          chainNamespace: VM_NAMESPACE[vm],
          chainId: chainId,
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
              ? bytesToHex(utils.bytes.bs58.decode(address))
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
    const { vm, chainId } = CHAIN_INFO[chain];

    // If already an on-chain Push EOA, just return it
    if (this.isPushChain(chain)) {
      return address as `0x${string}`;
    }

    // Try to get UEA address from cache first
    const cachedUEA = this.cache.getUEAAddress(
      chain,
      address,
      this.pushNetwork,
      vm
    );
    if (cachedUEA !== null) {
      return cachedUEA as `0x${string}`;
    }

    // 1) Figure out the external‐chain ownerKey bytes
    let ownerKey: `0x${string}`;
    if (CHAIN_INFO[chain].vm === VM.EVM) {
      ownerKey = address as `0x${string}`;
    } else if (CHAIN_INFO[chain].vm === VM.SVM) {
      ownerKey = bytesToHex(utils.bytes.bs58.decode(address));
    } else {
      throw new Error(`Unsupported VM type: ${CHAIN_INFO[chain].vm}`);
    }

    // Step 1: Recreate the salt: keccak256(abi.encode(UniversalAccount))
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

    // Step 2: Clone Minimal Proxy bytecode
    const minimalProxyRuntimeCode = ('0x3d602d80600a3d3981f3' +
      '363d3d373d3d3d363d73' +
      NETWORK_VM_UEA[this.pushNetwork][vm].toLowerCase().replace(/^0x/, '') +
      '5af43d82803e903d91602b57fd5bf3') as `0x${string}`;

    // Step 3: Get init code hash (used by CREATE2)
    const initCodeHash = keccak256(minimalProxyRuntimeCode);

    // Step 4: Predict the address using standard CREATE2 formula
    const ueaAddress = getCreate2Address({
      from: this.pushClient.pushChainInfo.factoryAddress,
      salt,
      bytecodeHash: initCodeHash,
    });

    // Cache the computed UEA address
    this.cache.setUEAAddress(chain, address, this.pushNetwork, vm, ueaAddress);

    return ueaAddress;
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

  private async waitForLockerFeeConfirmation(
    txHashBytes: Uint8Array
  ): Promise<void> {
    const chain = this.universalSigner.account.chain;
    const { vm, defaultRPC, confirmations, timeout } = CHAIN_INFO[chain];
    const rpcUrls = this.rpcUrls[chain] || defaultRPC;

    switch (vm) {
      case VM.EVM: {
        const evmClient = new EvmClient({ rpcUrls });
        await evmClient.waitForConfirmations({
          txHash: bytesToHex(txHashBytes),
          confirmations,
          timeoutMs: timeout,
        });
        return;
      }

      case VM.SVM: {
        const svmClient = new SvmClient({ rpcUrls });
        await svmClient.waitForConfirmations({
          txSignature: utils.bytes.bs58.encode(txHashBytes),
          confirmations,
          timeoutMs: timeout,
        });
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

  private executeProgressHook(hookId: string, ...args: any[]): void {
    const hookEntry = PROGRESS_HOOKS[hookId];
    const hookPayload: ProgressEvent = hookEntry(...args);
    this.printLog(hookPayload.message);
    if (!this.progressHook) return;
    // invoke the user-provided callback
    this.progressHook(hookPayload);
  }
}
