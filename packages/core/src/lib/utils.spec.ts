import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PushChain } from './push-chain/push-chain';
import { CHAIN } from './constants/enums';
import { MOVEABLE_TOKENS } from './constants/tokens';
import { SYNTHETIC_PUSH_ERC20 } from './constants/chain';
import { sepolia } from 'viem/chains';
import { UniversalSigner } from './universal/universal.types';
import { createWalletClient, http } from 'viem';

describe('Helpers Utils Namespace', () => {
  describe('getChainName', () => {
    it('should get chain name', () => {
      // Test Push chains
      expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_MAINNET)).toBe(
        'PUSH_MAINNET'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_TESTNET)).toBe(
        'PUSH_TESTNET_DONUT'
      );
      expect(
        PushChain.utils.chains.getChainName(CHAIN.PUSH_TESTNET_DONUT)
      ).toBe('PUSH_TESTNET_DONUT');
      expect(PushChain.utils.chains.getChainName(CHAIN.PUSH_LOCALNET)).toBe(
        'PUSH_LOCALNET'
      );
      // Test Ethereum chains
      expect(PushChain.utils.chains.getChainName(CHAIN.ETHEREUM_MAINNET)).toBe(
        'ETHEREUM_MAINNET'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.ETHEREUM_SEPOLIA)).toBe(
        'ETHEREUM_SEPOLIA'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.ARBITRUM_SEPOLIA)).toBe(
        'ARBITRUM_SEPOLIA'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.BASE_SEPOLIA)).toBe(
        'BASE_SEPOLIA'
      );
      // Test Solana chains
      expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_MAINNET)).toBe(
        'SOLANA_MAINNET'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_TESTNET)).toBe(
        'SOLANA_TESTNET'
      );
      expect(PushChain.utils.chains.getChainName(CHAIN.SOLANA_DEVNET)).toBe(
        'SOLANA_DEVNET'
      );
    });

    it('should handle chain values directly', () => {
      // Test with raw chain values
      expect(PushChain.utils.chains.getChainName('eip155:9')).toBe(
        'PUSH_MAINNET'
      );
      expect(PushChain.utils.chains.getChainName('eip155:42101')).toBe(
        'PUSH_TESTNET_DONUT'
      );
      expect(PushChain.utils.chains.getChainName('eip155:9001')).toBe(
        'PUSH_LOCALNET'
      );
      expect(PushChain.utils.chains.getChainName('eip155:1')).toBe(
        'ETHEREUM_MAINNET'
      );
      expect(PushChain.utils.chains.getChainName('eip155:11155111')).toBe(
        'ETHEREUM_SEPOLIA'
      );
      expect(PushChain.utils.chains.getChainName('eip155:421614')).toBe(
        'ARBITRUM_SEPOLIA'
      );
      expect(PushChain.utils.chains.getChainName('eip155:84532')).toBe(
        'BASE_SEPOLIA'
      );
      expect(
        PushChain.utils.chains.getChainName(
          'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
        )
      ).toBe('SOLANA_MAINNET');
      expect(
        PushChain.utils.chains.getChainName(
          'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
        )
      ).toBe('SOLANA_TESTNET');
      expect(
        PushChain.utils.chains.getChainName(
          'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
        )
      ).toBe('SOLANA_DEVNET');
    });

    it('should return undefined for invalid chain values', () => {
      // Test with invalid chain values
      expect(
        PushChain.utils.chains.getChainName('invalid-chain')
      ).toBeUndefined();
      expect(
        PushChain.utils.chains.getChainName('eip155:999999')
      ).toBeUndefined();
      expect(
        PushChain.utils.chains.getChainName('solana:invalid')
      ).toBeUndefined();
      expect(PushChain.utils.chains.getChainName('')).toBeUndefined();
    });

    it('should handle case sensitivity correctly (returns undefined)', () => {
      // Test that the function is case sensitive
      expect(PushChain.utils.chains.getChainName('EIP155:1')).toBeUndefined();
      expect(
        PushChain.utils.chains.getChainName(
          'SOLANA:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
        )
      ).toBeUndefined();
    });

    it('should handle whitespace correctly (returns undefined)', () => {
      // Test that whitespace is not ignored
      expect(PushChain.utils.chains.getChainName(' eip155:1')).toBeUndefined();
      expect(PushChain.utils.chains.getChainName('eip155:1 ')).toBeUndefined();
    });
  });

  describe('getChainNamespace', () => {
    it('should get chain namespace from enum key name', () => {
      expect(PushChain.utils.chains.getChainNamespace('ETHEREUM_SEPOLIA')).toBe(
        CHAIN.ETHEREUM_SEPOLIA
      );

      expect(PushChain.utils.chains.getChainNamespace('ETHEREUM_MAINNET')).toBe(
        CHAIN.ETHEREUM_MAINNET
      );

      expect(PushChain.utils.chains.getChainNamespace('ARBITRUM_SEPOLIA')).toBe(
        CHAIN.ARBITRUM_SEPOLIA
      );

      expect(PushChain.utils.chains.getChainNamespace('BASE_SEPOLIA')).toBe(
        CHAIN.BASE_SEPOLIA
      );

      expect(
        PushChain.utils.chains.getChainNamespace('PUSH_TESTNET_DONUT')
      ).toBe(CHAIN.PUSH_TESTNET_DONUT);

      expect(PushChain.utils.chains.getChainNamespace('SOLANA_DEVNET')).toBe(
        CHAIN.SOLANA_DEVNET
      );
    });

    it('should return input unchanged when already a namespace', () => {
      expect(
        PushChain.utils.chains.getChainNamespace(CHAIN.ETHEREUM_SEPOLIA)
      ).toBe(CHAIN.ETHEREUM_SEPOLIA);

      expect(
        PushChain.utils.chains.getChainNamespace(CHAIN.ARBITRUM_SEPOLIA)
      ).toBe(CHAIN.ARBITRUM_SEPOLIA);

      expect(PushChain.utils.chains.getChainNamespace(CHAIN.BASE_SEPOLIA)).toBe(
        CHAIN.BASE_SEPOLIA
      );

      expect(
        PushChain.utils.chains.getChainNamespace(CHAIN.PUSH_TESTNET_DONUT)
      ).toBe(CHAIN.PUSH_TESTNET_DONUT);
    });

    it('should return undefined for unsupported names', () => {
      expect(
        PushChain.utils.chains.getChainNamespace('UNKNOWN_CHAIN')
      ).toBeUndefined();
      expect(
        PushChain.utils.chains.getChainNamespace('ethereum_sepolia' as any)
      ).toBeUndefined();
      expect(PushChain.utils.chains.getChainNamespace('')).toBeUndefined();
    });
  });

  describe('getSupportedChains', () => {
    it('should return supported chains for TESTNET', () => {
      const res = PushChain.utils.chains.getSupportedChains(
        PushChain.CONSTANTS.PUSH_NETWORK.TESTNET
      );
      expect(res).toEqual({
        chains: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
      });
    });

    it('should return supported chains for TESTNET_DONUT', () => {
      const res = PushChain.utils.chains.getSupportedChains(
        PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT
      );
      expect(res).toEqual({
        chains: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
      });
    });

    it('should return supported chains for LOCALNET', () => {
      const res = PushChain.utils.chains.getSupportedChains(
        PushChain.CONSTANTS.PUSH_NETWORK.LOCALNET
      );
      expect(res).toEqual({
        chains: [
          CHAIN.PUSH_TESTNET_DONUT,
          CHAIN.ETHEREUM_SEPOLIA,
          CHAIN.ARBITRUM_SEPOLIA,
          CHAIN.BASE_SEPOLIA,
          CHAIN.BNB_TESTNET,
          CHAIN.SOLANA_DEVNET,
        ],
      });
    });

    it('should return empty list for MAINNET', () => {
      const res = PushChain.utils.chains.getSupportedChains(
        PushChain.CONSTANTS.PUSH_NETWORK.MAINNET
      );
      expect(res).toEqual({ chains: [] });
    });
  });

  describe('getSupportedChainsByName', () => {
    it('should return supported chain names for TESTNET', () => {
      const res = PushChain.utils.chains.getSupportedChainsByName(
        PushChain.CONSTANTS.PUSH_NETWORK.TESTNET
      );
      expect(res).toEqual({
        chains: [
          'PUSH_TESTNET_DONUT',
          'ETHEREUM_SEPOLIA',
          'ARBITRUM_SEPOLIA',
          'BASE_SEPOLIA',
          'BNB_TESTNET',
          'SOLANA_DEVNET',
        ],
      });
    });

    it('should return supported chain names for TESTNET_DONUT', () => {
      const res = PushChain.utils.chains.getSupportedChainsByName(
        PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT
      );
      expect(res).toEqual({
        chains: [
          'PUSH_TESTNET_DONUT',
          'ETHEREUM_SEPOLIA',
          'ARBITRUM_SEPOLIA',
          'BASE_SEPOLIA',
          'BNB_TESTNET',
          'SOLANA_DEVNET',
        ],
      });
    });

    it('should return supported chain names for LOCALNET', () => {
      const res = PushChain.utils.chains.getSupportedChainsByName(
        PushChain.CONSTANTS.PUSH_NETWORK.LOCALNET
      );
      expect(res).toEqual({
        chains: [
          'PUSH_TESTNET_DONUT',
          'ETHEREUM_SEPOLIA',
          'ARBITRUM_SEPOLIA',
          'BASE_SEPOLIA',
          'BNB_TESTNET',
          'SOLANA_DEVNET',
        ],
      });
    });

    it('should return empty list for MAINNET', () => {
      const res = PushChain.utils.chains.getSupportedChainsByName(
        PushChain.CONSTANTS.PUSH_NETWORK.MAINNET
      );
      expect(res).toEqual({ chains: [] });
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

    describe('Anchor IDL input (Solana)', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const testCounterIdl = require('./orchestrator/svm-idl/__fixtures__/test_counter.idl.json');

      it('produces discriminator + Borsh-encoded args for receive_sol amount=0', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testCounterIdl,
          functionName: 'receive_sol',
          args: [BigInt(0)],
        });
        // [121,244,250,3,8,229,225,1] + u64 LE 0
        expect(result).toBe('0x79f4fa0308e5e1010000000000000000');
      });

      it('accepts camelCase function name', () => {
        const result = PushChain.utils.helpers.encodeTxData({
          abi: testCounterIdl,
          functionName: 'receiveSol',
          args: [BigInt(42)],
        });
        expect(result).toBe('0x79f4fa0308e5e1012a00000000000000');
      });

      it('throws when args is not an array on IDL path', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testCounterIdl,
            functionName: 'receive_sol',
            args: 'bad' as any,
          })
        ).toThrow('Arguments must be an array');
      });

      it('throws when instruction is not in IDL', () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: testCounterIdl,
            functionName: 'nope',
            args: [],
          })
        ).toThrow(/not found in IDL/);
      });

      it('auto-registers the IDL in PushChain.utils.svm under idl.address', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { clearRegistry } = require('./orchestrator/svm-idl/registry');
        clearRegistry();
        expect(PushChain.utils.svm.getRegisteredIdls()).toHaveLength(0);

        PushChain.utils.helpers.encodeTxData({
          abi: testCounterIdl,
          functionName: 'receive_sol',
          args: [BigInt(0)],
        });

        const registered = PushChain.utils.svm.getRegisteredIdls();
        expect(registered).toHaveLength(1);
        expect(registered[0].idl).toBe(testCounterIdl);
      });

      describe("explicit 'idl' param", () => {
        it('produces identical bytes to passing the IDL as abi', () => {
          const viaIdl = PushChain.utils.helpers.encodeTxData({
            idl: testCounterIdl,
            functionName: 'receive_sol',
            args: [BigInt(0)],
          });
          const viaAbi = PushChain.utils.helpers.encodeTxData({
            abi: testCounterIdl,
            functionName: 'receive_sol',
            args: [BigInt(0)],
          });
          expect(viaIdl).toBe(viaAbi);
          expect(viaIdl).toBe('0x79f4fa0308e5e1010000000000000000');
        });

        it('auto-registers the IDL when passed via the idl param', () => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { clearRegistry } = require('./orchestrator/svm-idl/registry');
          clearRegistry();

          PushChain.utils.helpers.encodeTxData({
            idl: testCounterIdl,
            functionName: 'receive_sol',
            args: [BigInt(0)],
          });

          const registered = PushChain.utils.svm.getRegisteredIdls();
          expect(registered).toHaveLength(1);
          expect(registered[0].idl).toBe(testCounterIdl);
        });
      });
    });

    describe('param validation', () => {
      it("throws when both 'abi' and 'idl' are provided", () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const testCounterIdl = require('./orchestrator/svm-idl/__fixtures__/test_counter.idl.json');
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            abi: [],
            idl: testCounterIdl,
            functionName: 'receive_sol',
            args: [],
          })
        ).toThrow(/pass either 'abi' .* or 'idl'/);
      });

      it("throws when neither 'abi' nor 'idl' is provided", () => {
        expect(() =>
          PushChain.utils.helpers.encodeTxData({
            functionName: 'increment',
          } as any)
        ).toThrow(/either 'abi' .* or 'idl' .* must be provided/);
      });
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
      expect(() => PushChain.utils.helpers.parseUnits(123 as any, 18)).toThrow(
        'Value must be a string'
      );

      expect(() => PushChain.utils.helpers.parseUnits(null as any, 18)).toThrow(
        'Value must be a string'
      );

      expect(() =>
        PushChain.utils.helpers.parseUnits(undefined as any, 18)
      ).toThrow('Value must be a string');
    });

    it('should throw error for invalid exponent types', () => {
      expect(() =>
        PushChain.utils.helpers.parseUnits('1', '18' as any)
      ).toThrow(
        'Exponent must be a number or an object with decimals property'
      );

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', null as any)
      ).toThrow(
        'Exponent must be a number or an object with decimals property'
      );

      expect(() => PushChain.utils.helpers.parseUnits('1', 1.5)).toThrow(
        'Exponent must be an integer'
      );

      expect(() => PushChain.utils.helpers.parseUnits('1', -1)).toThrow(
        'Exponent must be non-negative'
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
      ).toThrow('Value has more decimal places (20) than exponent allows (18)');
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

    it('should handle object-based exponent input', () => {
      // Test basic integer parsing with object format
      const result1 = PushChain.utils.helpers.parseUnits('420', {
        decimals: 9,
      });
      expect(result1).toBe(BigInt('420000000000'));

      // Test ETH to wei conversion (18 decimals) with object format
      const result2 = PushChain.utils.helpers.parseUnits('1.5', {
        decimals: 18,
      });
      expect(result2).toBe(BigInt('1500000000000000000'));

      // Test smaller decimal values with object format
      const result3 = PushChain.utils.helpers.parseUnits('0.1', {
        decimals: 6,
      });
      expect(result3).toBe(BigInt('100000'));

      // Test fractional values with fewer decimals than exponent
      const result4 = PushChain.utils.helpers.parseUnits('1.23', {
        decimals: 6,
      });
      expect(result4).toBe(BigInt('1230000'));

      // Test zero values with object format
      const result5 = PushChain.utils.helpers.parseUnits('0', {
        decimals: 18,
      });
      expect(result5).toBe(BigInt('0'));

      const result6 = PushChain.utils.helpers.parseUnits('0.0', {
        decimals: 6,
      });
      expect(result6).toBe(BigInt('0'));

      // Test negative values with object format
      const result7 = PushChain.utils.helpers.parseUnits('-1', {
        decimals: 18,
      });
      expect(result7).toBe(BigInt('-1000000000000000000'));

      const result8 = PushChain.utils.helpers.parseUnits('-0.5', {
        decimals: 6,
      });
      expect(result8).toBe(BigInt('-500000'));

      // Test values without decimals with object format
      const result9 = PushChain.utils.helpers.parseUnits('100', {
        decimals: 0,
      });
      expect(result9).toBe(BigInt('100'));

      const result10 = PushChain.utils.helpers.parseUnits('1000', {
        decimals: 3,
      });
      expect(result10).toBe(BigInt('1000000'));

      // Test values with leading/trailing whitespace with object format
      const result11 = PushChain.utils.helpers.parseUnits(' 1.5 ', {
        decimals: 18,
      });
      expect(result11).toBe(BigInt('1500000000000000000'));

      const result12 = PushChain.utils.helpers.parseUnits('\t420\n', {
        decimals: 9,
      });
      expect(result12).toBe(BigInt('420000000000'));

      // Test values starting with decimal point with object format
      const result13 = PushChain.utils.helpers.parseUnits('.5', {
        decimals: 18,
      });
      expect(result13).toBe(BigInt('500000000000000000'));

      const result14 = PushChain.utils.helpers.parseUnits('.123', {
        decimals: 6,
      });
      expect(result14).toBe(BigInt('123000'));

      // Test exact decimal place matches with object format
      const result15 = PushChain.utils.helpers.parseUnits('1.123456', {
        decimals: 6,
      });
      expect(result15).toBe(BigInt('1123456'));

      // Test large numbers with object format
      const result16 = PushChain.utils.helpers.parseUnits(
        '999999999999999999',
        { decimals: 18 }
      );
      expect(result16).toBe(BigInt('999999999999999999000000000000000000'));

      const result17 = PushChain.utils.helpers.parseUnits('1000000', {
        decimals: 0,
      });
      expect(result17).toBe(BigInt('1000000'));

      // Test common token decimal scenarios with object format
      // ETH (18 decimals)
      const ethResult = PushChain.utils.helpers.parseUnits('1', {
        decimals: 18,
      });
      expect(ethResult).toBe(BigInt('1000000000000000000'));

      // USDC (6 decimals)
      const usdcResult = PushChain.utils.helpers.parseUnits('100', {
        decimals: 6,
      });
      expect(usdcResult).toBe(BigInt('100000000'));

      // BTC (8 decimals)
      const btcResult = PushChain.utils.helpers.parseUnits('0.00000001', {
        decimals: 8,
      });
      expect(btcResult).toBe(BigInt('1'));

      // Push token (18 decimals) - example amount
      const pushResult = PushChain.utils.helpers.parseUnits('1000.5', {
        decimals: 18,
      });
      expect(pushResult).toBe(BigInt('1000500000000000000000'));
    });

    it('should throw error for invalid object-based exponent types', () => {
      expect(() =>
        PushChain.utils.helpers.parseUnits('1', { decimals: '18' } as any)
      ).toThrow('Exponent must be a number');

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', { decimals: null } as any)
      ).toThrow('Exponent must be a number');

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', { decimals: 1.5 })
      ).toThrow('Exponent must be an integer');

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', { decimals: -1 })
      ).toThrow('Exponent must be non-negative');

      expect(() => PushChain.utils.helpers.parseUnits('1', {} as any)).toThrow(
        'Exponent must be a number or an object with decimals property'
      );

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', { invalid: 18 } as any)
      ).toThrow(
        'Exponent must be a number or an object with decimals property'
      );

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', null as any)
      ).toThrow(
        'Exponent must be a number or an object with decimals property'
      );

      expect(() =>
        PushChain.utils.helpers.parseUnits('1', undefined as any)
      ).toThrow(
        'Exponent must be a number or an object with decimals property'
      );
    });

    it('should throw error when decimal places exceed exponent with object format', () => {
      expect(() =>
        PushChain.utils.helpers.parseUnits('1.123456789', { decimals: 6 })
      ).toThrow('Value has more decimal places (9) than exponent allows (6)');

      expect(() =>
        PushChain.utils.helpers.parseUnits('0.12345678901234567890', {
          decimals: 18,
        })
      ).toThrow('Value has more decimal places (20) than exponent allows (18)');
    });

    it('should produce same results for number and object-based exponent formats', () => {
      const testCases = [
        { value: '420', decimals: 9 },
        { value: '1.5', decimals: 18 },
        { value: '0.1', decimals: 6 },
        { value: '1.23', decimals: 6 },
        { value: '0', decimals: 18 },
        { value: '0.0', decimals: 6 },
        { value: '-1', decimals: 18 },
        { value: '-0.5', decimals: 6 },
        { value: '100', decimals: 0 },
        { value: '1000', decimals: 3 },
        { value: ' 1.5 ', decimals: 18 },
        { value: '\t420\n', decimals: 9 },
        { value: '.5', decimals: 18 },
        { value: '.123', decimals: 6 },
        { value: '1.123456', decimals: 6 },
        { value: '999999999999999999', decimals: 18 },
        { value: '1000000', decimals: 0 },
        { value: '1', decimals: 18 },
        { value: '100', decimals: 6 },
        { value: '0.00000001', decimals: 8 },
        { value: '1000.5', decimals: 18 },
      ];

      testCases.forEach(({ value, decimals }) => {
        const numberResult = PushChain.utils.helpers.parseUnits(
          value,
          decimals
        );
        const objectResult = PushChain.utils.helpers.parseUnits(value, {
          decimals,
        });
        expect(numberResult).toBe(objectResult);
      });
    });
  });

  describe('formatUnits', () => {
    describe('EVM-style usage (number decimals)', () => {
      it('should format bigint values correctly', () => {
        const readable1 = PushChain.utils.helpers.formatUnits(
          BigInt('1500000000000000000'),
          18
        );
        console.log(readable1);
        const readable2 = PushChain.utils.helpers.formatUnits('1500000', {
          decimals: 6,
        });
        console.log(readable2);
        const readable3 = PushChain.utils.helpers.formatUnits('1234567', {
          decimals: 6,
          precision: 2,
        });
        console.log(readable3);

        // ETH (18 decimals)
        const result1 = PushChain.utils.helpers.formatUnits(
          BigInt('1500000000000000000'),
          18
        );
        expect(result1).toBe('1.5');

        // USDC (6 decimals)
        const result2 = PushChain.utils.helpers.formatUnits(
          BigInt('1500000'),
          6
        );
        expect(result2).toBe('1.5');

        // BTC (8 decimals)
        const result3 = PushChain.utils.helpers.formatUnits(
          BigInt('123456789'),
          8
        );
        expect(result3).toBe('1.23456789');

        // Zero value
        const result4 = PushChain.utils.helpers.formatUnits(BigInt('0'), 18);
        expect(result4).toBe('0.0');

        // Large value
        const result5 = PushChain.utils.helpers.formatUnits(
          BigInt('1000000000000000000000'),
          18
        );
        expect(result5).toBe('1000.0');
      });

      it('should format string values correctly', () => {
        // ETH (18 decimals)
        const result1 = PushChain.utils.helpers.formatUnits(
          '1500000000000000000',
          18
        );
        expect(result1).toBe('1.5');

        // USDC (6 decimals)
        const result2 = PushChain.utils.helpers.formatUnits('1500000', 6);
        expect(result2).toBe('1.5');

        // BTC (8 decimals)
        const result3 = PushChain.utils.helpers.formatUnits('123456789', 8);
        expect(result3).toBe('1.23456789');

        // Zero value
        const result4 = PushChain.utils.helpers.formatUnits('0', 18);
        expect(result4).toBe('0.0');

        // Large value
        const result5 = PushChain.utils.helpers.formatUnits(
          '1000000000000000000000',
          18
        );
        expect(result5).toBe('1000.0');
      });

      it('should handle different decimal scenarios', () => {
        // No decimals (0)
        const result1 = PushChain.utils.helpers.formatUnits(BigInt('100'), 0);
        expect(result1).toBe('100');

        // Single decimal (1)
        const result2 = PushChain.utils.helpers.formatUnits(BigInt('123'), 1);
        expect(result2).toBe('12.3');

        // Many decimals (30)
        const result3 = PushChain.utils.helpers.formatUnits(
          BigInt('123456789012345678901234567890'),
          30
        );
        expect(result3).toBe('0.12345678901234567890123456789');
      });
    });

    describe('Push-style usage (options object)', () => {
      it('should format with decimals option', () => {
        // ETH (18 decimals)
        const result1 = PushChain.utils.helpers.formatUnits(
          BigInt('1500000000000000000'),
          { decimals: 18 }
        );
        expect(result1).toBe('1.5');

        // USDC (6 decimals)
        const result2 = PushChain.utils.helpers.formatUnits('1500000', {
          decimals: 6,
        });
        expect(result2).toBe('1.5');

        // BTC (8 decimals)
        const result3 = PushChain.utils.helpers.formatUnits('123456789', {
          decimals: 8,
        });
        expect(result3).toBe('1.23456789');

        // Zero value
        const result4 = PushChain.utils.helpers.formatUnits('0', {
          decimals: 18,
        });
        expect(result4).toBe('0.0');

        // Large value
        const result5 = PushChain.utils.helpers.formatUnits(
          '1000000000000000000000',
          { decimals: 18 }
        );
        expect(result5).toBe('1000.0');
      });

      it('should format with precision option', () => {
        // Truncate to 2 decimal places
        const result1 = PushChain.utils.helpers.formatUnits('1234567', {
          decimals: 6,
          precision: 2,
        });
        expect(result1).toBe('1.23');

        // Truncate to 4 decimal places
        const result2 = PushChain.utils.helpers.formatUnits('123456789', {
          decimals: 8,
          precision: 4,
        });
        expect(result2).toBe('1.2345');

        // Truncate to 0 decimal places (integer)
        const result3 = PushChain.utils.helpers.formatUnits('1500000', {
          decimals: 6,
          precision: 0,
        });
        expect(result3).toBe('1');

        // Truncate to 1 decimal place
        const result4 = PushChain.utils.helpers.formatUnits(
          '1500000000000000000',
          { decimals: 18, precision: 1 }
        );
        expect(result4).toBe('1.5');

        // Precision larger than actual decimals
        const result5 = PushChain.utils.helpers.formatUnits('1500000', {
          decimals: 6,
          precision: 10,
        });
        expect(result5).toBe('1.5');

        // Large values should not lose precision through JS number conversion
        const result6 = PushChain.utils.helpers.formatUnits(
          '123456789012345678901234567890',
          { decimals: 18, precision: 6 }
        );
        expect(result6).toBe('123456789012.345678');
      });

      it('should handle edge cases with precision', () => {
        // Very small number with precision
        const result1 = PushChain.utils.helpers.formatUnits('1', {
          decimals: 18,
          precision: 2,
        });
        expect(result1).toBe('0');

        // Number that rounds down with precision
        const result2 = PushChain.utils.helpers.formatUnits('123456', {
          decimals: 6,
          precision: 1,
        });
        expect(result2).toBe('0.1');

        // Number that rounds down to zero
        const result3 = PushChain.utils.helpers.formatUnits('123456', {
          decimals: 6,
          precision: 0,
        });
        expect(result3).toBe('0');
      });
    });

    describe('Common token scenarios', () => {
      it('should handle ETH scenarios', () => {
        // 1 ETH
        const result1 = PushChain.utils.helpers.formatUnits(
          '1000000000000000000',
          18
        );
        expect(result1).toBe('1.0');

        // 0.5 ETH
        const result2 = PushChain.utils.helpers.formatUnits(
          '500000000000000000',
          18
        );
        expect(result2).toBe('0.5');

        // 0.001 ETH
        const result3 = PushChain.utils.helpers.formatUnits(
          '1000000000000000',
          18
        );
        expect(result3).toBe('0.001');
      });

      it('should handle USDC scenarios', () => {
        // 100 USDC
        const result1 = PushChain.utils.helpers.formatUnits('100000000', 6);
        expect(result1).toBe('100.0');

        // 0.01 USDC
        const result2 = PushChain.utils.helpers.formatUnits('10000', 6);
        expect(result2).toBe('0.01');

        // 0.000001 USDC (smallest unit)
        const result3 = PushChain.utils.helpers.formatUnits('1', 6);
        expect(result3).toBe('0.000001');
      });

      it('should handle BTC scenarios', () => {
        // 1 BTC
        const result1 = PushChain.utils.helpers.formatUnits('100000000', 8);
        expect(result1).toBe('1.0');

        // 0.5 BTC
        const result2 = PushChain.utils.helpers.formatUnits('50000000', 8);
        expect(result2).toBe('0.5');

        // 0.00000001 BTC (1 satoshi)
        const result3 = PushChain.utils.helpers.formatUnits('1', 8);
        expect(result3).toBe('0.00000001');
      });
    });

    describe('Error handling and validation', () => {
      it('should throw error for invalid value types', () => {
        expect(() =>
          PushChain.utils.helpers.formatUnits(123 as any, 18)
        ).toThrow('Value must be a bigint or string');

        expect(() =>
          PushChain.utils.helpers.formatUnits(null as any, 18)
        ).toThrow('Value must be a bigint or string');

        expect(() =>
          PushChain.utils.helpers.formatUnits(undefined as any, 18)
        ).toThrow('Value must be a bigint or string');

        expect(() =>
          PushChain.utils.helpers.formatUnits({} as any, 18)
        ).toThrow('Value must be a bigint or string');
      });

      it('should throw error for invalid decimals parameter', () => {
        expect(() =>
          PushChain.utils.helpers.formatUnits('100', '18' as any)
        ).toThrow(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.formatUnits('100', null as any)
        ).toThrow(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.formatUnits('100', undefined as any)
        ).toThrow(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );

        expect(() =>
          PushChain.utils.helpers.formatUnits('100', {} as any)
        ).toThrow(
          'Second parameter must be a number (decimals) or an object with decimals property'
        );
      });

      it('should throw error for invalid decimals values', () => {
        expect(() => PushChain.utils.helpers.formatUnits('100', 1.5)).toThrow(
          'Decimals must be an integer'
        );

        expect(() => PushChain.utils.helpers.formatUnits('100', -1)).toThrow(
          'Decimals must be non-negative'
        );

        expect(() => PushChain.utils.helpers.formatUnits('100', NaN)).toThrow(
          'Decimals must be an integer'
        );
      });

      it('should throw error for invalid precision values', () => {
        expect(() =>
          PushChain.utils.helpers.formatUnits('100', {
            decimals: 18,
            precision: 1.5,
          })
        ).toThrow('Precision must be an integer');

        expect(() =>
          PushChain.utils.helpers.formatUnits('100', {
            decimals: 18,
            precision: -1,
          })
        ).toThrow('Precision must be non-negative');

        expect(() =>
          PushChain.utils.helpers.formatUnits('100', {
            decimals: 18,
            precision: NaN,
          })
        ).toThrow('Precision must be an integer');
      });

      it('should throw error for invalid string values', () => {
        expect(() =>
          PushChain.utils.helpers.formatUnits('invalid', 18)
        ).toThrow('Failed to format units');
      });
    });

    describe('Edge cases', () => {
      it('should handle very large numbers', () => {
        const result1 = PushChain.utils.helpers.formatUnits(
          '999999999999999999999999999999999999999999',
          18
        );
        expect(result1).toBe('999999999999999999999999.999999999999999999');

        const result2 = PushChain.utils.helpers.formatUnits(
          '999999999999999999999999999999999999999999',
          { decimals: 18, precision: 2 }
        );
        expect(result2).toBe('1e+24');
      });

      it('should handle very small numbers', () => {
        const result1 = PushChain.utils.helpers.formatUnits('1', 30);
        expect(result1).toBe('0.000000000000000000000000000001');

        const result2 = PushChain.utils.helpers.formatUnits('1', {
          decimals: 30,
          precision: 10,
        });
        expect(result2).toBe('0');
      });

      it('should handle zero with different decimals', () => {
        const result1 = PushChain.utils.helpers.formatUnits('0', 0);
        expect(result1).toBe('0');

        const result2 = PushChain.utils.helpers.formatUnits('0', 18);
        expect(result2).toBe('0.0');

        const result3 = PushChain.utils.helpers.formatUnits('0', {
          decimals: 6,
          precision: 2,
        });
        expect(result3).toBe('0');
      });

      it('should handle negative numbers', () => {
        const result1 = PushChain.utils.helpers.formatUnits(
          '-1500000000000000000',
          18
        );
        expect(result1).toBe('-1.5');

        const result2 = PushChain.utils.helpers.formatUnits('-1500000', {
          decimals: 6,
          precision: 2,
        });
        expect(result2).toBe('-1.5');
      });
    });

    describe('Consistency between EVM-style and Push-style', () => {
      it('should produce same results for number and object-based formats', () => {
        const testCases = [
          { value: '1500000000000000000', decimals: 18 },
          { value: '1500000', decimals: 6 },
          { value: '123456789', decimals: 8 },
          { value: '0', decimals: 18 },
          { value: '1000000000000000000000', decimals: 18 },
          { value: '123456', decimals: 6 },
          { value: '999999999999999999', decimals: 18 },
          { value: '1', decimals: 30 },
        ];

        testCases.forEach(({ value, decimals }) => {
          const numberResult = PushChain.utils.helpers.formatUnits(
            value,
            decimals
          );
          const objectResult = PushChain.utils.helpers.formatUnits(value, {
            decimals,
          });
          expect(numberResult).toBe(objectResult);
        });
      });

      it('should handle bigint and string inputs consistently', () => {
        const testCases = [
          { value: '1500000000000000000', decimals: 18 },
          { value: '1500000', decimals: 6 },
          { value: '123456789', decimals: 8 },
          { value: '0', decimals: 18 },
          { value: '1000000000000000000000', decimals: 18 },
        ];

        testCases.forEach(({ value, decimals }) => {
          const stringResult = PushChain.utils.helpers.formatUnits(
            value,
            decimals
          );
          const bigintResult = PushChain.utils.helpers.formatUnits(
            BigInt(value),
            decimals
          );
          expect(stringResult).toBe(bigintResult);
        });
      });
    });
  });

  describe('slippageToMinAmount', () => {
    describe('basic functionality', () => {
      it('should calculate minimum amount out with 1% slippage', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount('100', {
          slippageBps: 100,
        });
        expect(result).toBe('99');
      });

      it('should calculate minimum amount out with 1% slippage for large amounts', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 100,
          }
        );
        expect(result).toBe('99000000');
      });

      it('should calculate minimum amount out with 0.5% slippage', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 50,
          }
        );
        expect(result).toBe('99500000');
      });

      it('should calculate minimum amount out with 2% slippage', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 200,
          }
        );
        expect(result).toBe('98000000');
      });

      it('should handle zero slippage', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 0,
          }
        );
        expect(result).toBe('100000000');
      });

      it('should handle maximum slippage (100%)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 10000,
          }
        );
        expect(result).toBe('0');
      });
    });

    describe('edge cases', () => {
      it('should handle very small amounts', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount('1', {
          slippageBps: 100,
        });
        expect(result).toBe('0');
      });

      it('should handle very large amounts', () => {
        const largeAmount = '999999999999999999999999999999';
        const result = PushChain.utils.conversion.slippageToMinAmount(
          largeAmount,
          {
            slippageBps: 100,
          }
        );
        // Should be 99% of the large amount
        const expected = (BigInt(largeAmount) * BigInt(9900)) / BigInt(10000);
        expect(result).toBe(expected.toString());
      });

      it('should handle fractional slippage calculations correctly', () => {
        // Test with amount that doesn't divide evenly by 10000
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000001',
          {
            slippageBps: 100,
          }
        );
        // 100000001 * 9900 / 10000 = 99000000.99, truncated to 99000000
        expect(result).toBe('99000000');
      });
    });

    describe('different slippage rates', () => {
      it('should handle 0.1% slippage (10 bps)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 10,
          }
        );
        expect(result).toBe('99900000');
      });

      it('should handle 0.25% slippage (25 bps)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 25,
          }
        );
        expect(result).toBe('99750000');
      });

      it('should handle 5% slippage (500 bps)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 500,
          }
        );
        expect(result).toBe('95000000');
      });

      it('should handle 10% slippage (1000 bps)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 1000,
          }
        );
        expect(result).toBe('90000000');
      });

      it('should handle 50% slippage (5000 bps)', () => {
        const result = PushChain.utils.conversion.slippageToMinAmount(
          '100000000',
          {
            slippageBps: 5000,
          }
        );
        expect(result).toBe('50000000');
      });
    });

    describe('error handling', () => {
      it('should throw error for non-string amount', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount(100 as any, {
            slippageBps: 100,
          });
        }).toThrow('Amount must be a string');
      });

      it('should throw error for non-number slippageBps', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('100', {
            slippageBps: '100' as any,
          });
        }).toThrow('slippageBps must be a number');
      });

      it('should throw error for non-integer slippageBps', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('100', {
            slippageBps: 100.5,
          });
        }).toThrow('slippageBps must be an integer');
      });

      it('should throw error for negative slippageBps', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('100', {
            slippageBps: -100,
          });
        }).toThrow('slippageBps must be non-negative');
      });

      it('should throw error for slippageBps exceeding 10000', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('100', {
            slippageBps: 10001,
          });
        }).toThrow('slippageBps cannot exceed 10000 (100%)');
      });

      it('should throw error for empty amount string', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('', {
            slippageBps: 100,
          });
        }).toThrow('Amount cannot be empty');
      });

      it('should throw error for whitespace-only amount string', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('   ', {
            slippageBps: 100,
          });
        }).toThrow('Amount cannot be empty');
      });

      it('should throw error for invalid amount format', () => {
        expect(() => {
          PushChain.utils.conversion.slippageToMinAmount('invalid', {
            slippageBps: 100,
          });
        }).toThrow('Failed to calculate slippage');
      });
    });

    describe('real-world scenarios', () => {
      it('should work with USDC amounts (6 decimals)', () => {
        // 1000 USDC with 0.3% slippage
        const usdcAmount = '1000000000'; // 1000 USDC in smallest units
        const result = PushChain.utils.conversion.slippageToMinAmount(
          usdcAmount,
          {
            slippageBps: 30, // 0.3%
          }
        );
        expect(result).toBe('997000000'); // 997 USDC
      });

      it('should work with ETH amounts (18 decimals)', () => {
        // 1 ETH with 0.5% slippage
        const ethAmount = '1000000000000000000'; // 1 ETH in wei
        const result = PushChain.utils.conversion.slippageToMinAmount(
          ethAmount,
          {
            slippageBps: 50, // 0.5%
          }
        );
        expect(result).toBe('995000000000000000'); // 0.995 ETH
      });

      it('should work with small token amounts', () => {
        // 0.001 tokens with 1% slippage
        const smallAmount = '1000';
        const result = PushChain.utils.conversion.slippageToMinAmount(
          smallAmount,
          {
            slippageBps: 100, // 1%
          }
        );
        expect(result).toBe('990');
      });
    });
  });

  describe('Tokens Utils', () => {
    let tokensClientEVM: PushChain;
    let tokensUniversalSignerEVM: UniversalSigner;

    beforeAll(async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(),
      });
      tokensUniversalSignerEVM =
        await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
          chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
          library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
        });
      tokensClientEVM = await PushChain.initialize(tokensUniversalSignerEVM, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
      });
    });
    it('should list all moveable tokens across all chains', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens();
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Sanity check for common tokens present in the registry
      const hasETH = tokens.some(
        (t) => t.symbol === 'ETH' && t.decimals === 18
      );
      const hasWETH = tokens.some(
        (t) => t.symbol === 'WETH' && t.decimals === 18
      );
      const hasUSDT = tokens.some(
        (t) => t.symbol === 'USDT' && t.decimals === 6
      );
      expect(hasETH).toBe(true);
      expect(hasWETH).toBe(true);
      expect(hasUSDT).toBe(true);
    });

    it('should list moveable tokens for a specific chain (Ethereum Sepolia)', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.ETHEREUM_SEPOLIA
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect ETH, WETH, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ETHEREUM_SEPOLIA &&
            t.symbol === 'ETH' &&
            t.decimals === 18
        )
      ).toBe(true);
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ETHEREUM_SEPOLIA &&
            t.symbol === 'WETH' &&
            t.decimals === 18
        )
      ).toBe(true);
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ETHEREUM_SEPOLIA &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should list moveable tokens for a specific chain (Arbitrum Sepolia)', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.ARBITRUM_SEPOLIA
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect ETH, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ARBITRUM_SEPOLIA &&
            t.symbol === 'ETH' &&
            t.decimals === 18
        )
      ).toBe(true);
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ARBITRUM_SEPOLIA &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should list moveable tokens for a specific chain (Base Sepolia)', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.BASE_SEPOLIA
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect ETH, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.BASE_SEPOLIA &&
            t.symbol === 'ETH' &&
            t.decimals === 18
        )
      ).toBe(true);
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.BASE_SEPOLIA &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should list moveable tokens for Push Chain (PRC-20 synthetics)', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.PUSH_TESTNET_DONUT
      );
      expect(Array.isArray(tokens)).toBe(true);

      // pETH/pETH_ARB/pETH_BASE/pBNB/pSOL + USDT × 5 + USDC × 5 + WETH + stETH + DAI = 18
      expect(tokens.length).toBe(18);

      // Every entry must be on Push Chain and use the approve mechanism
      for (const t of tokens) {
        expect(t.chain).toBe(CHAIN.PUSH_TESTNET_DONUT);
        expect(t.mechanism).toBe('approve');
        expect(t.address.startsWith('0x')).toBe(true);
      }

      const symbols = tokens.map((t) => t.symbol);
      expect(symbols).toContain('pETH');
      expect(symbols).toContain('pETH_ARB');
      expect(symbols).toContain('pETH_BASE');
      expect(symbols).toContain('pBNB');
      expect(symbols).toContain('pSOL');
      // USDT/USDC appear once per origin chain (5 each)
      expect(symbols.filter((s) => s === 'USDT').length).toBe(5);
      expect(symbols.filter((s) => s === 'USDC').length).toBe(5);

      // All addresses are unique (no duplicate entries)
      const addresses = tokens.map((t) => t.address.toLowerCase());
      expect(new Set(addresses).size).toBe(addresses.length);

      // Decimals match source-chain assets
      expect(tokens.find((t) => t.symbol === 'pETH')?.decimals).toBe(18);
      expect(tokens.find((t) => t.symbol === 'pSOL')?.decimals).toBe(9);
      expect(tokens.find((t) => t.symbol === 'USDT')?.decimals).toBe(6);
      expect(tokens.find((t) => t.symbol === 'USDC')?.decimals).toBe(6);
    });

    it('should include Push Chain PRC-20s in the all-chains moveable list', () => {
      const { tokens } = PushChain.utils.tokens.getMoveableTokens();
      const pushTokens = tokens.filter(
        (t) => t.chain === CHAIN.PUSH_TESTNET_DONUT
      );
      expect(pushTokens.length).toBe(18);
      expect(pushTokens.some((t) => t.symbol === 'pETH')).toBe(true);
      expect(pushTokens.some((t) => t.symbol === 'pSOL')).toBe(true);
    });

    it('should return Push Chain PRC-20s via MOVEABLE_TOKENS registry lookup', () => {
      const list = MOVEABLE_TOKENS[CHAIN.PUSH_TESTNET_DONUT];
      expect(list).toBeDefined();
      expect(list?.length).toBe(18);
    });

    it('should list all payable tokens across all chains', () => {
      const { tokens } = PushChain.utils.tokens.getPayableTokens();
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Sanity check for common tokens present in the registry
      const hasSOL = tokens.some((t) => t.symbol === 'SOL' && t.decimals === 9);
      const hasUSDT = tokens.some(
        (t) => t.symbol === 'USDT' && t.decimals === 6
      );
      expect(hasSOL).toBe(true);
      expect(hasUSDT).toBe(true);
    });

    it('should list payable tokens for a specific chain (Solana Devnet)', () => {
      const { tokens } = PushChain.utils.tokens.getPayableTokens(
        CHAIN.SOLANA_DEVNET
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect SOL, USDC, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.SOLANA_DEVNET &&
            t.symbol === 'SOL' &&
            t.decimals === 9
        )
      ).toBe(true);

      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.SOLANA_DEVNET &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should list payable tokens for a specific chain (Arbitrum Sepolia)', () => {
      const { tokens } = PushChain.utils.tokens.getPayableTokens(
        CHAIN.ARBITRUM_SEPOLIA
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect ETH, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ARBITRUM_SEPOLIA &&
            t.symbol === 'ETH' &&
            t.decimals === 18
        )
      ).toBe(true);

      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.ARBITRUM_SEPOLIA &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should list payable tokens for a specific chain (Base Sepolia)', () => {
      const { tokens } = PushChain.utils.tokens.getPayableTokens(
        CHAIN.BASE_SEPOLIA
      );
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBeGreaterThan(0);

      // Expect ETH, USDT per tokens registry
      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.BASE_SEPOLIA &&
            t.symbol === 'ETH' &&
            t.decimals === 18
        )
      ).toBe(true);

      expect(
        tokens.some(
          (t) =>
            t.chain === CHAIN.BASE_SEPOLIA &&
            t.symbol === 'USDT' &&
            t.decimals === 6
        )
      ).toBe(true);
    });

    it('should resolve chain via client instance for moveable tokens', () => {
      const clientTokens =
        PushChain.utils.tokens.getMoveableTokens(tokensClientEVM).tokens;
      const chainTokens = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.ETHEREUM_SEPOLIA
      ).tokens;

      // Compare by symbol presence and count (order not guaranteed by spec)
      const symbolsFromClient = new Set(
        clientTokens
          .filter((t) => t.chain === CHAIN.ETHEREUM_SEPOLIA)
          .map((t) => t.symbol)
      );
      const symbolsFromChain = new Set(
        chainTokens
          .filter((t) => t.chain === CHAIN.ETHEREUM_SEPOLIA)
          .map((t) => t.symbol)
      );
      expect(symbolsFromClient).toEqual(symbolsFromChain);
      expect(clientTokens.length).toBe(chainTokens.length);
    });

    it('should get PRC20 address from a MoveableToken', () => {
      const ethMoveable = MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA]?.find(
        (t) => t.symbol === 'ETH'
      );
      expect(ethMoveable).toBeDefined();

      if (!ethMoveable) {
        throw new Error('ETH moveable token not found');
      }

      const result = PushChain.utils.tokens.getPRC20Address(ethMoveable);

      expect(result.address).toBe(
        SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
          .pETH
      );
      expect(result.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(result.symbol).toBe('ETH');
      expect(result.decimals).toBe(ethMoveable.decimals);
      expect(result.network).toBe(
        PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT
      );
    });

    it('should get PRC20 address from a { chain, address } token input', () => {
      const ethMoveable = MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA]?.find(
        (t) => t.symbol === 'ETH'
      );
      expect(ethMoveable).toBeDefined();

      if (!ethMoveable) {
        throw new Error('ETH moveable token not found');
      }

      const result = PushChain.utils.tokens.getPRC20Address({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: ethMoveable.address,
      });

      expect(result.address).toBe(
        SYNTHETIC_PUSH_ERC20[PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT]
          .pETH
      );
      expect(result.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(result.symbol).toBe('ETH');
    });

    it('should throw when the PRC20 address is unresolved on the target network', () => {
      const ethMoveable = MOVEABLE_TOKENS[CHAIN.ETHEREUM_SEPOLIA]?.find(
        (t) => t.symbol === 'ETH'
      );
      if (!ethMoveable) throw new Error('ETH moveable token not found');

      expect(() =>
        PushChain.utils.tokens.getPRC20Address(ethMoveable, {
          network: PushChain.CONSTANTS.PUSH_NETWORK.MAINNET,
        })
      ).toThrow(/PRC20 address not available/);
    });
  });
});
