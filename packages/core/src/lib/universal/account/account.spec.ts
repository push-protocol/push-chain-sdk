import { CHAIN, LIBRARY, PUSH_NETWORK } from '../../constants/enums';
import { PushChain } from '../../push-chain/push-chain';
import { Orchestrator } from '../../orchestrator/orchestrator';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toUniversalFromKeypair } from '../signer';
import { createWalletClient, http } from 'viem';
import { CHAIN_INFO } from '../../constants/chain';
import { convertOriginToExecutor } from './account';

const EVM_ADDRESS = '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97';

describe('Universal Account Utilities', () => {
  describe('toChainAgnostic()', () => {
    it('converts an address and chain to a CAIP-10 string for EVM', () => {
      const caip = PushChain.utils.account.toChainAgnostic(EVM_ADDRESS, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });

      expect(caip).toBe(`eip155:11155111:${EVM_ADDRESS}`);
    });

    it('converts an address and chain to a CAIP-10 string for Solana', () => {
      const caip = PushChain.utils.account.toChainAgnostic('solanaAddress123', {
        chain: CHAIN.SOLANA_TESTNET,
      });

      expect(caip).toBe(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );
    });
  });

  describe('fromChainAgnostic()', () => {
    it('converts a CAIP-10 string to a UniversalAccount (EVM)', () => {
      const account = PushChain.utils.account.fromChainAgnostic(
        `eip155:11155111:${EVM_ADDRESS}`
      );

      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(account.address).toBe(EVM_ADDRESS);
    });

    it('converts a CAIP-10 string to a UniversalAccount (Solana)', () => {
      const account = PushChain.utils.account.fromChainAgnostic(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );

      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
      expect(account.address).toBe('solanaAddress123');
    });

    it('throws an error if the CAIP string is unsupported', () => {
      expect(() =>
        PushChain.utils.account.fromChainAgnostic('foo:999:bar')
      ).toThrow('Unsupported or unknown CAIP address: foo:999:bar');
    });
  });

  describe('convertOriginToExecutor() - Not Mocked', () => {
    it('should return same address and pushChainClient.universal.account', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account: account,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      const signer = await toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_VIEM,
      });

      const orchestrator = new Orchestrator(signer, PUSH_NETWORK.TESTNET_DONUT);
      const address = orchestrator.computeUEAOffchain();
      const address2 = await orchestrator.computeUEA();
      const result = await PushChain.utils.account.convertOriginToExecutor(
        signer.account,
        {
          onlyCompute: true,
        }
      );

      expect(address).toBe(result.address);
      expect(address2.address).toBe(result.address);

      const address3 = await PushChain.utils.account.convertOriginToExecutor(
        signer.account,
        {
          onlyCompute: true,
        }
      );
      expect(address3.address).toBe(address2.address);
    });
  });

  describe('convertOriginToExecutor() - Direct Tests', () => {
    it('should return same address for Push Chain with onlyCompute=true', async () => {
      const pushAccount = {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      };

      const result = await convertOriginToExecutor(pushAccount, {
        onlyCompute: true,
      });

      expect(result.address).toBe(pushAccount.address);
      expect(result.deployed).toBe(false);
    });

    it('should return address without deployed status for Push Chain with onlyCompute=false', async () => {
      const pushAccount = {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      };

      const result = await convertOriginToExecutor(pushAccount, {
        onlyCompute: false,
      });

      expect(result.address).toBe(pushAccount.address);
      expect(result.deployed).toBeUndefined();
    });

    it('should return address without deployed status for Push Chain with default options', async () => {
      const pushAccount = {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        address: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      };

      const result = await convertOriginToExecutor(pushAccount);

      expect(result.address).toBe(pushAccount.address);
      expect(result.deployed).toBe(false);
    });

    it('should compute and cache address for EVM chain', async () => {
      const evmAccount = {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: EVM_ADDRESS,
      };

      // First call should compute the address
      const result1 = await convertOriginToExecutor(evmAccount, {
        onlyCompute: true,
      });

      expect(result1.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(typeof result1.deployed).toBe('boolean');

      // Second call should use cached address
      const result2 = await convertOriginToExecutor(evmAccount, {
        onlyCompute: true,
      });

      expect(result2.address).toBe(result1.address);
      expect(result2.deployed).toBe(result1.deployed);
    });
  });

  describe('toUniversal()', () => {
    it('returns a checksummed address for EVM chains', () => {
      const account = PushChain.utils.account.toUniversal(
        EVM_ADDRESS.toLowerCase(),
        {
          chain: CHAIN.ETHEREUM_SEPOLIA,
        }
      );

      expect(account.address).toBe(EVM_ADDRESS);
      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    });

    it('returns the address as-is for non-EVM chains', () => {
      const account = PushChain.utils.account.toUniversal('solanaAddress123', {
        chain: CHAIN.SOLANA_TESTNET,
      });

      expect(account.address).toBe('solanaAddress123');
      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
    });

    it('throws an error on invalid EVM address format', () => {
      expect(() =>
        PushChain.utils.account.toUniversal('not-an-eth-address', {
          chain: CHAIN.ETHEREUM_SEPOLIA,
        })
      ).toThrow('Invalid EVM address format');
    });

    it('works with different EVM chains', () => {
      const account = PushChain.utils.account.toUniversal(EVM_ADDRESS, {
        chain: CHAIN.ETHEREUM_MAINNET,
      });

      expect(account.address).toBe(EVM_ADDRESS);
      expect(account.chain).toBe(CHAIN.ETHEREUM_MAINNET);
    });

    it('works with different Solana chains', () => {
      const solanaAddress = 'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1';
      const account = PushChain.utils.account.toUniversal(solanaAddress, {
        chain: CHAIN.SOLANA_DEVNET,
      });

      expect(account.address).toBe(solanaAddress);
      expect(account.chain).toBe(CHAIN.SOLANA_DEVNET);
    });
  });
});
