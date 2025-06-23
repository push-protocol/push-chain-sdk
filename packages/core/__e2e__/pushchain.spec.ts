import {
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { createWalletClient, Hex, http, isAddress } from 'viem';
import { Keypair, PublicKey } from '@solana/web3.js';
import { PushChain } from '../src';
import { UniversalSigner } from '../src/lib/universal/universal.types';
import { ethers, Wallet } from 'ethers';
import { CHAIN_INFO } from '../src/lib/constants/chain';

/** CLI COMMANDS
 
TO GENERATE UNSIGNED TX
  pchaind tx bank send acc1 push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv 1000npush \
  --generate-only --output json > unsigned.json

TO SIGN THE TX & GENERATE SIGNED TX ( VIA ACC 1 )
  pchaind tx sign unsigned.json \
  --from acc1 --chain-id localchain_9000-1 \
  --keyring-backend test \
  --output-document signed.json

TO ENCODE TX
  pchaind tx encode signed.json

TO DECODE TX
  pchaind tx decode base64EncodedString

 */
describe('PushChain (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.TESTNET_DONUT;
  let universalSigner: UniversalSigner;

  describe('EVM signer', () => {
    describe(`ORIGIN CHAIN: ${CHAIN.ETHEREUM_SEPOLIA}`, () => {
      const originChain = CHAIN.ETHEREUM_SEPOLIA;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

        const account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
          account,
          transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
        });

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          walletClient,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          }
        );

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should computeUEA', async () => {
        const result = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );

        expect(isAddress(result.address)).toBe(true);
        expect(typeof result.deployed).toBe('boolean');

        const universalSignerSolana =
          await PushChain.utils.signer.toUniversalFromKeypair(new Keypair(), {
            chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
            library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
          });

        const resultSolana =
          await PushChain.utils.account.convertOriginToExecutor(
            universalSignerSolana.account,
            {
              status: true,
            }
          );
        expect(isAddress(resultSolana.address)).toBe(true);
        expect(typeof resultSolana.deployed).toBe('boolean');
      });

      it('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);
        expect(isAddress(uoa.address)).toBe(true);
      });
      it('should sendTransaction - Transfer Call', async () => {
        const tx = await pushClient.universal.sendTransaction({
          to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(1e18),
        });
        const after = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );
        expect(after.deployed).toBe(true);
        expect(tx.code).toBe(0);
      }, 300000);
      // TODO - should sendTransaction - Contract Call
    });

    describe(`ORIGIN CHAIN: ${CHAIN.PUSH_TESTNET_DONUT}`, () => {
      const originChain = CHAIN.PUSH_TESTNET_DONUT;
      let pushClient: PushChain;
      let account: PrivateKeyAccount;

      beforeAll(async () => {
        const privateKey = process.env['PUSH_CHAIN_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('PUSH_CHAIN_PRIVATE_KEY not set');

        account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
          account,
          transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
        });

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          walletClient,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          }
        );

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should computeUEA', async () => {
        const address = pushClient.universal.account;
        expect(address).toBeDefined();
        expect(address).toBe(account.address);
      });

      it('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);
        expect(isAddress(uoa.address)).toBe(true);
      });

      it('should sendTransaction', async () => {
        const tx = await pushClient.universal.sendTransaction({
          to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(2),
        });

        expect(tx).toBeDefined();
        expect(tx.code).toBe(0);
      }, 30000);
    });
  });

  describe('SVM signer', () => {
    describe(`ORIGIN CHAIN: ${CHAIN.SOLANA_DEVNET}`, () => {
      const originChain = CHAIN.SOLANA_DEVNET;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
        if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

        const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

        const account = Keypair.fromSecretKey(privateKey);

        universalSigner = await PushChain.utils.signer.toUniversalFromKeypair(
          account,
          {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
          }
        );

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should computeUEA', async () => {
        const result = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );
        expect(isAddress(result.address)).toBe(true);
        expect(typeof result.deployed).toBe('boolean');
      });

      it('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);

        let isValid = true;
        try {
          new PublicKey(uoa.address);
        } catch {
          isValid = false;
        }

        expect(isValid).toBe(true);
      });

      it('should sendTransaction', async () => {
        await pushClient.universal.sendTransaction({
          to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(1e18),
        });
        const after = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );
        expect(after.deployed).toBe(true);
      }, 30000);
    });
  });

  describe('Push Chain Signer', () => {
    it('Origin and Account should be the same when push chain', async () => {
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
      const origin = pushChainClient.universal.origin;
      const account2 = pushChainClient.universal.account;
      expect(origin.address).toBe(account2);
      expect(origin.chain === CHAIN.PUSH_TESTNET);
    });

    it.skip('Should be able to send transaction from push chain', async () => {
      const privateKey = process.env['PUSH_CHAIN_PRIVATE_KEY'] as Hex;
      if (!privateKey) throw new Error('PUSH_CHAIN_PRIVATE_KEY not set');
      const wallet = new Wallet(privateKey);
      const provider = new ethers.JsonRpcProvider(
        'https://evm.rpc-testnet-donut-node1.push.org/'
      );
      const signer = wallet.connect(provider);
      const balance = await provider.getBalance(wallet.address);
      if (balance <= BigInt(0)) {
        throw new Error('Insufficient balance for transaction');
      }
      const universalSigner = await PushChain.utils.signer.toUniversal(signer);
      const pushChainClient = await PushChain.initialize(universalSigner, {
        network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
      });

      const tx = await pushChainClient.universal.sendTransaction({
        to: '0x1b527b5A848A264a4d8195Fc41aEae0166cd36b7',
        value: BigInt(100000000),
      });
      expect(tx).toBeDefined();
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
          'PUSH_TESTNET'
        );
        expect(
          PushChain.utils.helpers.getChainName(CHAIN.PUSH_TESTNET_DONUT)
        ).toBe('PUSH_TESTNET');
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
          'PUSH_TESTNET'
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
  });
});
