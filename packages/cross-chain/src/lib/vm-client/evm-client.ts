import { UniversalSigner } from '../universal/universal.types';
import {
  ClientOptions,
  ReadContractParams,
  WriteContractParams,
} from './vm-client.types';
import {
  bytesToHex,
  createPublicClient,
  encodeFunctionData,
  hexToBytes,
  http,
  parseEther,
  PublicClient,
  serializeTransaction,
  Hex,
  Abi,
} from 'viem';

/**
 * EVM client for reading and writing to Ethereum-compatible chains
 *
 * @example
 * // Initialize with an RPC URL
 * const evmClient = new EvmClient({
 *   rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/your-api-key'
 * });
 */
export class EvmClient {
  private publicClient: PublicClient;

  constructor({ rpcUrl }: ClientOptions) {
    this.publicClient = createPublicClient({
      transport: http(rpcUrl),
    });
  }

  /**
   * Returns the balance (in wei) of an EVM address.
   *
   * @param address - The EVM address to check balance for
   * @returns Balance as a bigint in wei
   *
   * @example
   * // Get balance of an address
   * const balance = await evmClient.getBalance('0x123...');
   * console.log(`Balance: ${balance} wei`);
   *
   * @example
   * // Check if an address has zero balance
   * const newAddress = privateKeyToAccount(generatePrivateKey()).address;
   * const balance = await evmClient.getBalance(newAddress);
   * if (balance === BigInt(0)) {
   *   console.log('Address has no funds');
   * }
   */
  async getBalance(address: `0x${string}`): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /**
   * Performs a read-only call to a smart contract.
   *
   * @param params - Parameters including ABI, contract address, function name, and args
   * @returns The result of the contract call with the specified type
   *
   * @example
   * // Read a greeting value from a contract
   * const greeting = await evmClient.readContract<string>({
   *   abi: parseAbi(['function greet() view returns (string)']),
   *   address: '0x2ba5873eF818BEE57645B7d674149041C44F42c6',
   *   functionName: 'greet',
   * });
   * console.log(`Current greeting: ${greeting}`);
   *
   * @example
   * // Reading with arguments
   * const balance = await evmClient.readContract<bigint>({
   *   abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
   *   address: '0xTokenAddress',
   *   functionName: 'balanceOf',
   *   args: ['0xUserAddress'],
   * });
   */
  async readContract<T = unknown>({
    abi,
    address,
    functionName,
    args = [],
  }: ReadContractParams): Promise<T> {
    return this.publicClient.readContract({
      abi: abi as Abi,
      address: address as `0x${string}`,
      functionName,
      args,
    }) as Promise<T>;
  }

  /**
   * Writes a transaction to a smart contract using a UniversalSigner.
   * This function handles contract interaction by encoding function data
   * and sending the transaction through sendTransaction.
   *
   * @param params - Parameters including ABI, contract address, function name, args, value and signer
   * @returns Transaction hash as a hex string
   *
   * @example
   * // Set a new greeting on a contract
   * const txHash = await evmClient.writeContract({
   *   abi: parseAbi(['function setGreeting(string _greeting)']),
   *   address: '0x2ba5873eF818BEE57645B7d674149041C44F42c6',
   *   functionName: 'setGreeting',
   *   args: ['Hello from Push SDK!'],
   *   signer: universalSigner,
   * });
   * console.log(`Transaction sent: ${txHash}`);
   *
   * @example
   * // Sending ether with a contract interaction
   * const txHash = await evmClient.writeContract({
   *   abi: parseAbi(['function deposit() payable']),
   *   address: '0xContractAddress',
   *   functionName: 'deposit',
   *   value: parseEther('0.1'), // Send 0.1 ETH
   *   signer: universalSigner,
   * });
   */
  async writeContract({
    abi,
    address,
    functionName,
    args = [],
    value = parseEther('0'),
    signer,
  }: WriteContractParams): Promise<Hex> {
    const data = encodeFunctionData({
      abi: abi as Abi,
      functionName,
      args,
    });

    return this.sendTransaction({
      to: address as `0x${string}`,
      data,
      value,
      signer,
    });
  }

  /**
   * Sends a raw EVM transaction using a UniversalSigner.
   * This handles the full transaction flow:
   * 1. Gets nonce, estimates gas, and gets current fee data
   * 2. Serializes and signs the transaction
   * 3. Broadcasts the signed transaction to the network
   *
   * @param params - Transaction parameters including destination, data, value and signer
   * @returns Transaction hash as a hex string
   *
   * @example
   * // Send a simple ETH transfer
   * const txHash = await evmClient.sendTransaction({
   *   to: '0xRecipientAddress',
   *   data: '0x', // empty data for a simple transfer
   *   value: parseEther('0.01'),
   *   signer: universalSigner,
   * });
   * console.log(`ETH transfer sent: ${txHash}`);
   */
  async sendTransaction({
    to,
    data,
    value = parseEther('0'),
    signer,
  }: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    signer: UniversalSigner;
  }): Promise<Hex> {
    const [nonce, gas, feePerGas] = await Promise.all([
      this.publicClient.getTransactionCount({
        address: signer.address as `0x${string}`,
      }),
      this.publicClient.estimateGas({
        account: signer.address as `0x${string}`,
        to,
        data,
        value,
      }),
      this.publicClient.estimateFeesPerGas(),
    ]);

    const chainId = await this.publicClient.getChainId();

    const unsignedTx = serializeTransaction({
      chainId,
      type: 'eip1559',
      to,
      data,
      gas,
      nonce,
      maxFeePerGas: feePerGas.maxFeePerGas,
      maxPriorityFeePerGas: feePerGas.maxPriorityFeePerGas,
      value,
    });

    if (!signer.signTransaction) {
      throw new Error('signer.signTransaction is undefined');
    }

    const signedTx = await signer.signTransaction(hexToBytes(unsignedTx));

    return this.publicClient.sendRawTransaction({
      serializedTransaction: bytesToHex(signedTx),
    });
  }

  /**
   * Estimates the gas required for a transaction.
   *
   * @param params - Parameters including from/to addresses, value and optional data
   * @returns Estimated gas as a bigint
   *
   * @example
   * // Estimate gas for a simple transfer
   * const gasEstimate = await evmClient.estimateGas({
   *   from: '0xSenderAddress',
   *   to: '0xRecipientAddress',
   *   value: parseEther('0.01'),
   * });
   * console.log(`Estimated gas: ${gasEstimate}`);
   *
   * @example
   * // Estimate gas for a contract interaction
   * const data = encodeFunctionData({
   *   abi: parseAbi(['function setGreeting(string)']),
   *   functionName: 'setGreeting',
   *   args: ['New greeting'],
   * });
   *
   * const gasEstimate = await evmClient.estimateGas({
   *   from: universalSigner.address as `0x${string}`,
   *   to: '0xContractAddress',
   *   data,
   *   value: BigInt(0),
   * });
   */
  async estimateGas({
    from,
    to,
    value,
    data,
  }: {
    from: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
  }): Promise<bigint> {
    return this.publicClient.estimateGas({
      account: from,
      to,
      value,
      data,
    });
  }

  /**
   * Gets the current gas price on the network.
   * This is primarily used for legacy transactions, but can be useful
   * for gas cost estimation in EIP-1559 transactions as well.
   *
   * @returns Current gas price in wei as a bigint
   *
   * @example
   * // Get current gas price for cost estimation
   * const gasPrice = await evmClient.getGasPrice();
   * console.log(`Current gas price: ${gasPrice} wei`);
   *
   * @example
   * // Calculate total cost of a transaction
   * const gasPrice = await evmClient.getGasPrice();
   * const gasEstimate = await evmClient.estimateGas({...});
   * const totalCost = gasPrice * gasEstimate;
   * console.log(`Estimated transaction cost: ${totalCost} wei`);
   */
  async getGasPrice(): Promise<bigint> {
    return this.publicClient.getGasPrice();
  }
}
