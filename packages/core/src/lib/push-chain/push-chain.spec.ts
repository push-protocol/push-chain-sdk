import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { UniversalSigner } from '../universal/universal.types';
import { PushChain } from './push-chain';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  verifyMessage,
} from 'viem';
import { sepolia } from 'viem/chains';
import { CHAIN_INFO } from '../constants/chain';
import { CHAIN } from '../constants/enums';
import { Keypair, PublicKey } from '@solana/web3.js';
describe('PushChain', () => {
  describe('Universal Namesapce', () => {
    let pushClientEVM: PushChain;
    let pushChainPush: PushChain;
    let pushChainSVM: PushChain;
    let universalSignerEVM: UniversalSigner;
    let universalSignerPush: UniversalSigner;
    let universalSignerSVM: UniversalSigner;

    beforeAll(async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(),
      });
      universalSignerEVM = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      pushClientEVM = await PushChain.initialize(universalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const pushTestnet = defineChain({
        id: parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId),
        name: 'Push Testnet',
        nativeCurrency: {
          decimals: 18,
          name: 'PC',
          symbol: '$PC',
        },
        rpcUrls: {
          default: {
            http: [CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]],
          },
        },
        blockExplorers: {
          default: {
            name: 'Push Testnet Explorer',
            url: 'https://explorer.testnet.push.org/',
          },
        },
      });
      const accountPush = privateKeyToAccount(generatePrivateKey());
      const walletClientPush = createWalletClient({
        account: accountPush,
        chain: pushTestnet,
        transport: http(),
      });
      universalSignerPush = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClientPush,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      pushChainPush = await PushChain.initialize(universalSignerPush, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });
      const accountSVM = Keypair.generate();
      universalSignerSVM = await PushChain.utils.signer.toUniversalFromKeypair(
        accountSVM,
        {
          chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
          library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
        }
      );
      pushChainSVM = await PushChain.initialize(universalSignerSVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });
    });

    describe('signMessage', () => {
      it('should signMessage - EVM format', async () => {
        const testMessage = new TextEncoder().encode('Hello, Push Chain!');
        const signatureEVM = await pushClientEVM.universal.signMessage(
          testMessage
        );
        const signaturePush = await pushChainPush.universal.signMessage(
          testMessage
        );

        // Verify signature format (should be hex for EVM)
        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

        expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signaturePush.length).toBeGreaterThan(2); // At least 0x + some hex chars

        // Verify the signature is valid
        const isValidEVM = await verifyMessage({
          address: universalSignerEVM.account.address as `0x${string}`,
          message: { raw: testMessage },
          signature: signatureEVM as `0x${string}`,
        });

        expect(isValidEVM).toBe(true);

        const isValidPush = await verifyMessage({
          address: universalSignerPush.account.address as `0x${string}`,
          message: { raw: testMessage },
          signature: signaturePush as `0x${string}`,
        });

        expect(isValidPush).toBe(true);
      });

      it('should signMessage - binary data', async () => {
        const binaryData = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
        const signatureEVM = await pushClientEVM.universal.signMessage(
          binaryData
        );
        const signaturePush = await pushChainPush.universal.signMessage(
          binaryData
        );

        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2); // At least 0x + some hex chars

        // Verify the signature is valid
        const isValidEVM = await verifyMessage({
          address: universalSignerEVM.account.address as `0x${string}`,
          message: { raw: binaryData },
          signature: signatureEVM as `0x${string}`,
        });

        expect(isValidEVM).toBe(true);

        const isValidPush = await verifyMessage({
          address: universalSignerPush.account.address as `0x${string}`,
          message: { raw: binaryData },
          signature: signaturePush as `0x${string}`,
        });

        expect(isValidPush).toBe(true);
      });
    });
    describe('signTypedData', () => {
      it('should signTypedData - EIP-712 format', async () => {
        const domain = {
          name: 'Push Chain',
          version: '1',
          chainId: 42101, // Push testnet
          verifyingContract:
            '0x1234567890123456789012345678901234567890' as `0x${string}`,
        };

        const types = {
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
        };

        const message = {
          name: 'Alice',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' as `0x${string}`,
        };

        const signatureEVM = await pushClientEVM.universal.signTypedData({
          domain,
          types,
          primaryType: 'Person',
          message,
        });

        // Verify signature format (should be hex for EVM)
        expect(signatureEVM).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signatureEVM.length).toBeGreaterThan(2);

        expect(typeof signatureEVM).toBe('string');

        const signaturePush = await pushChainPush.universal.signTypedData({
          domain,
          types,
          primaryType: 'Person',
          message,
        });

        expect(signaturePush).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(signaturePush.length).toBeGreaterThan(2);

        expect(typeof signaturePush).toBe('string');
      });
    });
    describe('get account', () => {
      it('EVM', async () => {
        const address = pushClientEVM.universal.account;
        expect(isAddress(address)).toBeTruthy();
        expect(address).not.toBe(universalSignerEVM.account.address);
      });
      it('Push', async () => {
        const address = pushChainPush.universal.account;
        expect(address).toBeDefined();
        expect(address).toBe(universalSignerPush.account.address);
      });
      it('SVM', async () => {
        const address = pushChainSVM.universal.account;
        expect(isAddress(address)).toBeTruthy();
        expect(address).not.toBe(universalSignerSVM.account.address);
      });
    });
    describe('get origin', () => {
      it('EVM', async () => {
        const uoa = pushClientEVM.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerEVM.account.chain);
        expect(isAddress(uoa.address)).toBe(true);
      });
      it('Push', async () => {
        const uoa = pushChainPush.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerPush.account.chain);
        expect(isAddress(uoa.address)).toBe(true);
      });
      it('SVM', async () => {
        const uoa = pushChainSVM.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(universalSignerSVM.account.chain);

        let isValid = true;
        try {
          new PublicKey(uoa.address);
        } catch {
          isValid = false;
        }

        expect(isValid).toBe(true);
      });
    });
  });

  describe('Explorer Namespace', () => {
    it('should get transaction url', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const txHash = '0x123';
      const url = pushChainClient.explorer.getTransactionUrl(txHash);
      expect(url).toBe(`https://donut.push.network/tx/${txHash}`);
    });

    it('should list default block explorer URLs', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );
      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toContain('https://donut.push.network');
      expect(urls.length).toBeGreaterThan(0);
    });

    it('should list custom block explorer URLs when provided', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      const customBlockExplorers = {
        [CHAIN.PUSH_TESTNET_DONUT]: [
          'https://custom-explorer1.push.network',
          'https://custom-explorer2.push.network',
        ],
      };

      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        blockExplorers: customBlockExplorers,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toEqual([
        'https://custom-explorer1.push.network',
        'https://custom-explorer2.push.network',
      ]);
      expect(urls.length).toBe(2);
    });

    it('should handle multiple chains with different block explorer configurations', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        transport: http(
          CHAIN_INFO[PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]
        ),
      });
      const signer = await PushChain.utils.signer.toUniversalFromKeypair(
        walletClient,
        {
          chain: PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        }
      );

      const multiChainBlockExplorers = {
        [CHAIN.PUSH_TESTNET_DONUT]: ['https://donut-explorer.push.network'],
        [CHAIN.ETHEREUM_SEPOLIA]: ['https://sepolia.etherscan.io'],
        [CHAIN.SOLANA_DEVNET]: ['https://explorer.solana.com'],
      };

      const pushChainClient = await PushChain.initialize(signer, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
        blockExplorers: multiChainBlockExplorers,
      });

      const urls = pushChainClient.explorer.listUrls();
      expect(Array.isArray(urls)).toBe(true);
      expect(urls).toEqual(['https://donut-explorer.push.network']);
      expect(urls.length).toBe(1);
    });
  });

  describe('Helpers Utils Namespace', () => {
    describe('getChainName', () => {
      it('should get chain name', () => {
        // Test Push chains
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_MAINNET)).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_TESTNET)).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.PUSH_TESTNET_DONUT)
        ).toBe('PUSH_TESTNET_DONUT');
        expect(PushChain.utils.helpers.getChainName(CHAIN.PUSH_LOCALNET)).toBe(
          'PUSH_LOCALNET'
        );
        // Test Ethereum chains
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.ETHEREUM_MAINNET)
        ).toBe('ETHEREUM_MAINNET');
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.ETHEREUM_SEPOLIA)
        ).toBe('ETHEREUM_SEPOLIA');
        // Test Solana chains
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_MAINNET)).toBe(
          'SOLANA_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_TESTNET)).toBe(
          'SOLANA_TESTNET'
        );
        expect(PushChain.utils.helpers.getChainName(CHAIN.SOLANA_DEVNET)).toBe(
          'SOLANA_DEVNET'
        );
      });

      it('should handle chain values directly', () => {
        // Test with raw chain values
        expect(PushChain.utils.helpers.getChainName('eip155:9')).toBe(
          'PUSH_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:42101')).toBe(
          'PUSH_TESTNET_DONUT'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:9001')).toBe(
          'PUSH_LOCALNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:1')).toBe(
          'ETHEREUM_MAINNET'
        );
        expect(PushChain.utils.helpers.getChainName('eip155:11155111')).toBe(
          'ETHEREUM_SEPOLIA'
        );
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toBe('SOLANA_MAINNET');
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
          )
        ).toBe('SOLANA_TESTNET');
        expect(
          PushChain.utils.helpers.getChainName(
            'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
          )
        ).toBe('SOLANA_DEVNET');
      });

      it('should throw error for invalid chain values', () => {
        // Test with invalid chain values
        expect(() =>
          PushChain.utils.helpers.getChainName('invalid-chain')
        ).toThrow("Chain value 'invalid-chain' not found in CHAIN enum");
        expect(() =>
          PushChain.utils.helpers.getChainName('eip155:999999')
        ).toThrow("Chain value 'eip155:999999' not found in CHAIN enum");
        expect(() =>
          PushChain.utils.helpers.getChainName('solana:invalid')
        ).toThrow("Chain value 'solana:invalid' not found in CHAIN enum");
        expect(() => PushChain.utils.helpers.getChainName('')).toThrow(
          "Chain value '' not found in CHAIN enum"
        );
      });

      it('should handle case sensitivity correctly', () => {
        // Test that the function is case sensitive
        expect(() => PushChain.utils.helpers.getChainName('EIP155:1')).toThrow(
          "Chain value 'EIP155:1' not found in CHAIN enum"
        );
        expect(() =>
          PushChain.utils.helpers.getChainName(
            'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
          )
        ).toThrow(
          "Chain value 'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' not found in CHAIN enum"
        );
      });

      it('should handle whitespace correctly', () => {
        // Test that whitespace is not ignored
        expect(() => PushChain.utils.helpers.getChainName(' eip155:1')).toThrow(
          "Chain value ' eip155:1' not found in CHAIN enum"
        );
        expect(() => PushChain.utils.helpers.getChainName('eip155:1 ')).toThrow(
          "Chain value 'eip155:1 ' not found in CHAIN enum"
        );
      });
    });

    describe('encodeTxData', () => {
      const testAbi = [
        {
          inputs: [],
          stateMutability: 'nonpayable',
          type: 'constructor',
        },
        {
          anonymous: false,
          inputs: [
            {
              indexed: false,
              internalType: 'uint256',
              name: 'newCount',
              type: 'uint256',
            },
            {
              indexed: true,
              internalType: 'address',
              name: 'caller',
              type: 'address',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainNamespace',
              type: 'string',
            },
            {
              indexed: false,
              internalType: 'string',
              name: 'chainId',
              type: 'string',
            },
          ],
          name: 'CountIncremented',
          type: 'event',
        },
        {
          inputs: [],
          name: 'increment',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'reset',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countEth',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countPC',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'countSol',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
        {
          inputs: [],
          name: 'getCount',
          outputs: [
            {
              internalType: 'uint256',
              name: '',
              type: 'uint256',
            },
          ],
          stateMutability: 'view',
          type: 'function',
        },
      ];

      it('should encode function data correctly', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
        });
        expect(result).toBe('0xd09de08a');
      });

      it('should encode function data with arguments', () => {
        // Test with a function that has no arguments (reset)
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'reset',
        });
        expect(result).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(typeof result).toBe('string');
      });

      it('should throw error for invalid ABI', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: 'invalid' as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: null as any,
            functionName: 'increment',
          })
        ).toThrow('ABI must be an array');
      });

      it('should throw error for invalid arguments', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'increment',
            args: 'invalid' as any,
          })
        ).toThrow('Arguments must be an array');
      });

      it('should throw error for non-existent function', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testAbi,
            functionName: 'nonExistentFunction',
          })
        ).toThrow("Function 'nonExistentFunction' not found in ABI");
      });

      it('should handle empty args array', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testAbi,
          functionName: 'increment',
          args: [],
        });
        expect(result).toBe('0xd09de08a');
      });
    });

    describe('parseUnits', () => {
      it('should parse integer values correctly', () => {
        // Test basic integer parsing like the viem example
        const result = PushChain.utils.helpers.parseUnits('420', 9);
        expect(result).toBe(BigInt('420000000000'));
      });

      it('should parse decimal values correctly', () => {
        // Test ETH to wei conversion (18 decimals)
        const result1 = PushChain.utils.helpers.parseUnits('1.5', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        // Test smaller decimal values
        const result2 = PushChain.utils.helpers.parseUnits('0.1', 6);
        expect(result2).toBe(BigInt('100000'));

        // Test fractional values with fewer decimals than exponent
        const result3 = PushChain.utils.helpers.parseUnits('1.23', 6);
        expect(result3).toBe(BigInt('1230000'));
      });

      it('should handle zero values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('0', 18);
        expect(result1).toBe(BigInt('0'));

        const result2 = PushChain.utils.helpers.parseUnits('0.0', 6);
        expect(result2).toBe(BigInt('0'));

        const result3 = PushChain.utils.helpers.parseUnits('0.000', 18);
        expect(result3).toBe(BigInt('0'));
      });

      it('should handle negative values', () => {
        const result1 = PushChain.utils.helpers.parseUnits('-1', 18);
        expect(result1).toBe(BigInt('-1000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('-0.5', 6);
        expect(result2).toBe(BigInt('-500000'));
      });

      it('should handle values without decimals', () => {
        const result1 = PushChain.utils.helpers.parseUnits('100', 0);
        expect(result1).toBe(BigInt('100'));

        const result2 = PushChain.utils.helpers.parseUnits('1000', 3);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle values with leading/trailing whitespace', () => {
        const result1 = PushChain.utils.helpers.parseUnits(' 1.5 ', 18);
        expect(result1).toBe(BigInt('1500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('\t420\n', 9);
        expect(result2).toBe(BigInt('420000000000'));
      });

      it('should handle values starting with decimal point', () => {
        const result1 = PushChain.utils.helpers.parseUnits('.5', 18);
        expect(result1).toBe(BigInt('500000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('.123', 6);
        expect(result2).toBe(BigInt('123000'));
      });

      it('should handle exact decimal place matches', () => {
        // When decimal places exactly match the exponent
        const result = PushChain.utils.helpers.parseUnits('1.123456', 6);
        expect(result).toBe(BigInt('1123456'));
      });

      it('should throw error for invalid value types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits(123 as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(null as any, 18)
        ).toThrow('Value must be a string');

        expect(() =>
          PushChain.utils.helpers.parseUnits(undefined as any, 18)
        ).toThrow('Value must be a string');
      });

      it('should throw error for invalid exponent types', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1', '18' as any)
        ).toThrow('Exponent must be a non-negative integer');

        expect(() =>
          PushChain.utils.helpers.parseUnits('1', null as any)
        ).toThrow('Exponent must be a non-negative integer');

        expect(() => PushChain.utils.helpers.parseUnits('1', 1.5)).toThrow(
          'Exponent must be a non-negative integer'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1', -1)).toThrow(
          'Exponent must be a non-negative integer'
        );
      });

      it('should throw error for empty or invalid value strings', () => {
        expect(() => PushChain.utils.helpers.parseUnits('', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('   ', 18)).toThrow(
          'Value cannot be empty'
        );

        expect(() => PushChain.utils.helpers.parseUnits('.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('-.', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('abc', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1.2.3', 18)).toThrow(
          'Value must be a valid number string'
        );

        expect(() => PushChain.utils.helpers.parseUnits('1e5', 18)).toThrow(
          'Value must be a valid number string'
        );
      });

      it('should throw error when decimal places exceed exponent', () => {
        expect(() =>
          PushChain.utils.helpers.parseUnits('1.123456789', 6)
        ).toThrow('Value has more decimal places (9) than exponent allows (6)');

        expect(() =>
          PushChain.utils.helpers.parseUnits('0.12345678901234567890', 18)
        ).toThrow(
          'Value has more decimal places (20) than exponent allows (18)'
        );
      });

      it('should handle large numbers', () => {
        const result1 = PushChain.utils.helpers.parseUnits(
          '999999999999999999',
          18
        );
        expect(result1).toBe(BigInt('999999999999999999000000000000000000'));

        const result2 = PushChain.utils.helpers.parseUnits('1000000', 0);
        expect(result2).toBe(BigInt('1000000'));
      });

      it('should handle common token decimal scenarios', () => {
        // ETH (18 decimals)
        const ethResult = PushChain.utils.helpers.parseUnits('1', 18);
        expect(ethResult).toBe(BigInt('1000000000000000000'));

        // USDC (6 decimals)
        const usdcResult = PushChain.utils.helpers.parseUnits('100', 6);
        expect(usdcResult).toBe(BigInt('100000000'));

        // BTC (8 decimals)
        const btcResult = PushChain.utils.helpers.parseUnits('0.00000001', 8);
        expect(btcResult).toBe(BigInt('1'));

        // Push token (18 decimals) - example amount
        const pushResult = PushChain.utils.helpers.parseUnits('1000.5', 18);
        expect(pushResult).toBe(BigInt('1000500000000000000000'));
      });
    });
  });
});

describe('Deploy UEA on Push Testnet Edge Cases', () => {
  const pushTestnet = defineChain({
    id: 42101,
    name: 'Push Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'PC',
      symbol: '$PC',
    },
    rpcUrls: {
      default: {
        http: [
          'https://evm.rpc-testnet-donut-node1.push.org/',
          'https://evm.rpc-testnet-donut-node2.push.org/',
        ],
      },
    },
    blockExplorers: {
      default: {
        name: 'Push Testnet Explorer',
        url: 'https://explorer.testnet.push.org/',
      },
    },
  });
  it('Deploy UEA on Push Testnet to address that has Push Tokens', async () => {
    // Generate random private key
    const randomPrivateKey = generatePrivateKey();
    // From private key, calculate Account
    const randomAccount = privateKeyToAccount(randomPrivateKey);
    // Create WalletClient from Account
    const walletClient = createWalletClient({
      account: randomAccount,
      chain: sepolia,
      transport: http(),
    });
    // Create PushChain client from WalletClient
    const universalSigner = await PushChain.utils.signer.toUniversal(
      walletClient
    );
    const pushChainClient = await PushChain.initialize(universalSigner, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });
    // Calculate Universal.origin address.
    const universalOrigin =
      await PushChain.utils.account.convertOriginToExecutor({
        address: randomAccount.address,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

    // Check balance of Universal.account address
    const publicClientPush = createPublicClient({
      chain: pushTestnet,
      transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
    });
    const publicClientSepolia = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
    const balanceBeforePush = await publicClientPush.getBalance({
      address: pushChainClient.universal.account,
    });
    console.log('Balance before Push', balanceBeforePush);
    expect(balanceBeforePush).toBe(BigInt('0'));
    const balanceBeforeSepolia = await publicClientSepolia.getBalance({
      address: randomAccount.address,
    });
    expect(balanceBeforeSepolia).toBe(BigInt('0'));
    console.log('Balance before Sepolia', balanceBeforeSepolia);
    // Send 2 Push Token to Universal.account address
    const privateKeyWithPushTokens = '0x_YOUR_PRIVATE_KEY_HERE_PUSH_TOKENS';
    const privateKeyWithSepoliaEth = '0x_YOUR_PRIVATE_KEY_HERE_SEPOLIA_ETH';
    const accountWithPushTokens = privateKeyToAccount(privateKeyWithPushTokens);
    const accountWithSepoliaTokens = privateKeyToAccount(
      privateKeyWithSepoliaEth
    );
    const walletClientWithPushTokens = createWalletClient({
      account: accountWithPushTokens,
      chain: pushTestnet,
      transport: http('https://evm.rpc-testnet-donut-node1.push.org/'),
    });
    const walletClientSepoliaTokens = createWalletClient({
      account: accountWithSepoliaTokens,
      chain: sepolia,
      transport: http(),
    });
    // Try to send a transaction from that random address. Use walletClientWithPushTokens to send the 2 push tokens to Universal.account address
    const hashPushTokens = await walletClientWithPushTokens.sendTransaction({
      to: universalOrigin.address,
      value: PushChain.utils.helpers.parseUnits('2', 18),
    });
    // Wait for the transaction to be mined
    await publicClientPush.waitForTransactionReceipt({
      hash: hashPushTokens,
    });

    // Try to send Sepolia ETH to random generated address
    const hashSepoliaTokens = await walletClientSepoliaTokens.sendTransaction({
      to: randomAccount.address,
      value: PushChain.utils.helpers.parseUnits('0.07', 18),
    });
    // Wait for transaction to bbe mined
    await publicClientSepolia.waitForTransactionReceipt({
      hash: hashSepoliaTokens,
    });

    // Check balance of Universal.account address
    const balanceAfterPush = await publicClientPush.getBalance({
      address: pushChainClient.universal.account,
    });
    console.log('Balance after Push', balanceAfterPush);
    expect(balanceAfterPush).toBe(BigInt('2000000000000000000'));
    const balanceAfterSepolia = await publicClientSepolia.getBalance({
      address: randomAccount.address,
    });
    console.log('Balance after Sepolia', balanceAfterSepolia);
    expect(balanceAfterSepolia).toBe(BigInt('70000000000000000'));

    // Try to send a transaction from that random address. Use walletClientWithPushTokens to send the 2 push tokens to Universal.account address
    const tx = await pushChainClient.universal.sendTransaction({
      to: universalOrigin.address,
      value: PushChain.utils.helpers.parseUnits('0.05', 18),
    });
    expect(tx).toBeDefined();
  }, 60000);
});
