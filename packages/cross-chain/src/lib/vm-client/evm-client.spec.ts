import { EvmClient } from './evm-client';
import {
  createWalletClient,
  http,
  Hex,
  hexToBytes,
  parseTransaction,
  bytesToHex,
  defineChain,
  parseAbi,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { UniversalSigner } from '../universal/universal.types';
import { CHAIN } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { sepolia } from 'viem/chains';

const ABI = parseAbi([
  'function greet() view returns (string)',
  'function setGreeting(string _greeting)',
]);

const CONTRACT = '0x2ba5873eF818BEE57645B7d674149041C44F42c6';
const RPC_URL = sepolia.rpcUrls.default.http[0];
const chain = CHAIN.ETHEREUM_SEPOLIA;

// const CONTRACT = '0x87D792696Fa0810eBC5f6947F79ba50CbD267E72';
// const RPC_URL = 'https://evm.pn1.dev.push.org';
// const chain = CHAIN.PUSH_TESTNET;

describe('EvmClient', () => {
  let evmClient: EvmClient;
  let universalSigner: UniversalSigner;

  beforeAll(() => {
    evmClient = new EvmClient({ rpcUrl: RPC_URL });

    const PRIVATE_KEY =
      '0x730b326679b7b7ee74d0611d5b4c4cfc276957fe810deb8d013261f6331483f5';
    if (PRIVATE_KEY) {
      const account = privateKeyToAccount(PRIVATE_KEY);
      const walletClient = createWalletClient({
        account,
        chain: defineChain({
          id: parseInt(CHAIN_INFO[chain].chainId),
          name: chain,
          nativeCurrency: {
            decimals: 18,
            name: 'Ether',
            symbol: 'ETH',
          },
          rpcUrls: {
            default: {
              http: [RPC_URL],
            },
          },
        }),
        transport: http(),
      });
      universalSigner = {
        address: account.address,
        chain,
        signMessage: async (data: Uint8Array) => {
          const hexSig = await walletClient.signMessage({
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        },
        signTransaction: async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const txHash = await walletClient.signTransaction(tx as never);
          return hexToBytes(txHash);
        },
      };
    } else {
      throw new Error('No Private key set');
    }
  });

  describe('getBalance', () => {
    it('gets balance', async () => {
      const balance = await evmClient.getBalance(
        universalSigner.address as `0x${string}`
      );
      expect(typeof balance).toBe('bigint');
    });

    it('handles invalid address', async () => {
      await expect(
        evmClient.getBalance('0xInvalidAddress' as `0x${string}`)
      ).rejects.toThrow();
    });

    it('returns zero balance for new address', async () => {
      const newAddress = privateKeyToAccount(generatePrivateKey()).address;
      const balance = await evmClient.getBalance(newAddress);
      expect(balance).toBe(BigInt(0));
    });
  });

  describe('readContract', () => {
    it('reads contract value', async () => {
      const result = await evmClient.readContract<string>({
        abi: ABI,
        address: CONTRACT,
        functionName: 'greet',
      });
      console.log(`Current Greeting: ${result}`);
      expect(typeof result).toBe('string');
    });

    it('throws error for invalid contract address', async () => {
      await expect(
        evmClient.readContract({
          abi: ABI,
          address: '0xInvalidAddress' as `0x${string}`,
          functionName: 'greet',
        })
      ).rejects.toThrow();
    });

    it('throws error for non-existent function', async () => {
      await expect(
        evmClient.readContract({
          abi: ABI,
          address: CONTRACT,
          functionName: 'nonExistentFunction',
        })
      ).rejects.toThrow();
    });

    it('handles empty args array', async () => {
      const result = await evmClient.readContract<string>({
        abi: ABI,
        address: CONTRACT,
        functionName: 'greet',
        args: [],
      });
      expect(typeof result).toBe('string');
    });
  });

  it.skip('writes contract value', async () => {
    const balance = await evmClient.getBalance(
      universalSigner.address as `0x${string}`
    );
    if (balance === BigInt(0)) {
      console.warn('Skipping Test - Account has no balance');
      return;
    }

    const newGreeting = `Gm Gm ${Date.now()}`;

    const txHash = await evmClient.writeContract({
      abi: ABI,
      address: CONTRACT,
      functionName: 'setGreeting',
      args: [newGreeting],
      signer: universalSigner,
    });
    console.log('Tx Hash:', txHash);
    expect(txHash).toMatch(/^0x/);
  });

  describe('estimateGas', () => {
    it('estimates gas for a simple transfer', async () => {
      const gas = await evmClient.estimateGas({
        from: universalSigner.address as `0x${string}`,
        to: universalSigner.address as `0x${string}`,
        value: BigInt(0),
        data: '0x' as Hex,
      });
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });

    it('throws error for invalid from address', async () => {
      await expect(
        evmClient.estimateGas({
          from: '0xInvalidAddress' as `0x${string}`,
          to: universalSigner.address as `0x${string}`,
          value: BigInt(0),
        })
      ).rejects.toThrow();
    });

    it('handles missing data field', async () => {
      const gas = await evmClient.estimateGas({
        from: universalSigner.address as `0x${string}`,
        to: universalSigner.address as `0x${string}`,
        value: BigInt(0),
      });
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });
  });

  describe('getGasPrice', () => {
    it('gets the current gas price', async () => {
      const gasPrice = await evmClient.getGasPrice();
      expect(typeof gasPrice).toBe('bigint');
      expect(gasPrice).toBeGreaterThan(0);
    });
  });
});
