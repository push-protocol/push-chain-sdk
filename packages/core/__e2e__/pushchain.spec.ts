import {
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { createWalletClient, Hex, http, isAddress, PublicClient } from 'viem';
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

        universalSigner = await PushChain.utils.signer.toUniversalFromKeyPair(
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

      it('should getNMSCAddress', async () => {
        const result = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );

        expect(isAddress(result.address)).toBe(true);
        expect(typeof result.deployed).toBe('boolean');

        const universalSignerSolana =
          await PushChain.utils.signer.toUniversalFromKeyPair(new Keypair(), {
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
        await pushClient.universal.sendTransaction({
          target: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(1e13),
        });
        const after = await PushChain.utils.account.convertOriginToExecutor(
          universalSigner.account,
          {
            status: true,
          }
        );
        expect(after.deployed).toBe(true);
      }, 300000);
      // TODO - should sendTransaction - Contract Call
    });

    describe(`ORIGIN CHAIN: ${CHAIN.PUSH_TESTNET_DONUT}`, () => {
      const originChain = CHAIN.PUSH_TESTNET_DONUT;
      let pushClient: PushChain;
      let account: PrivateKeyAccount;

      beforeAll(async () => {
        const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

        account = privateKeyToAccount(privateKey);
        const walletClient = createWalletClient({
          account,
          transport: http(CHAIN_INFO[originChain].defaultRPC[0]),
        });

        universalSigner = await PushChain.utils.signer.toUniversalFromKeyPair(
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

      it('should getNMSCAddress', async () => {
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
        const txHash = await pushClient.universal.sendTransaction({
          target: '0x35B84d6848D16415177c64D64504663b998A6ab4',
          value: BigInt(2),
        });

        expect(txHash).toBeDefined();
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

        universalSigner = await PushChain.utils.signer.toUniversalFromKeyPair(
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

      it('should getNMSCAddress', async () => {
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

      it.skip('should sendTransaction', async () => {
        await pushClient.universal.sendTransaction({
          target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
          value: BigInt(1000000),
          // data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: BigInt(50000000000000000),
          maxFeePerGas: BigInt(50000000000000000),
          maxPriorityFeePerGas: BigInt(200000000),
          deadline: BigInt(9999999999),
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
      const signer = await PushChain.utils.signer.toUniversalFromKeyPair(
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

      const txHash = await pushChainClient.universal.sendTransaction({
        target: '0x1b527b5A848A264a4d8195Fc41aEae0166cd36b7',
        value: BigInt(100000000),
      });

      const tx = await provider.getTransaction(txHash);
      expect(tx).toBeDefined();
    });
  });
});

describe('viem', () => {
  let viemClient: PublicClient;

  beforeAll(() => {
    viemClient = PushChain.viem.createPublicClient({
      chain: PushChain.CONSTANTS.VIEM_PUSH_TESTNET_DONUT,
      transport: PushChain.viem.http(),
    });
  });

  it('creates a viem client', async () => {
    expect(viemClient).toBeDefined();
    expect(typeof viemClient.getBlock).toBe('function');
  });

  it('gets a block', async () => {
    const block = await viemClient.getBlock();
    expect(block).toBeDefined();

    // Check essential block properties
    expect(typeof block.number).toBe('bigint');
    expect(typeof block.hash).toBe('string');
    expect(block.hash).toMatch(/^0x[a-fA-F0-9]{64}$/); // Valid hex hash
    expect(typeof block.timestamp).toBe('bigint');
    expect(Array.isArray(block.transactions)).toBe(true);
    expect(typeof block.gasLimit).toBe('bigint');
    expect(typeof block.gasUsed).toBe('bigint');
    expect(block.number).toBeGreaterThan(0);
    expect(block.timestamp).toBeGreaterThan(0);
  });
});
