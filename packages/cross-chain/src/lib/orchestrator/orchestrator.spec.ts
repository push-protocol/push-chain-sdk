import { Orchestrator } from './orchestrator';
import { CHAIN, NETWORK } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import {
  bytesToHex,
  Hex,
  hexToBytes,
  parseEther,
  parseTransaction,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';

describe('Orchestrator', () => {
  const mockSigner: UniversalSigner = {
    address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    chain: CHAIN.ETHEREUM_SEPOLIA,
    signMessage: async (data: Uint8Array) => {
      return data;
    },
    signTransaction: async (unsignedTx: Uint8Array) => {
      return unsignedTx;
    },
  };

  describe.skip('lockFee', () => {
    it('eth sepolia', async () => {
      // Create orchestrator for eth_sepolia signer

      const chain = CHAIN.ETHEREUM_SEPOLIA;
      const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

      if (!PRIVATE_KEY) {
        throw new Error('SEPOLIA_PRIVATE_KEY environment variable is not set');
      }

      const account = privateKeyToAccount(PRIVATE_KEY);

      const ethSepoliaSigner: UniversalSigner = {
        address: account.address,
        chain,
        signMessage: async (data: Uint8Array) => {
          const hexSig = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        },
        signTransaction: async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const txHash = await account.signTransaction(tx as never);
          return hexToBytes(txHash);
        },
      };

      const orchestrator = new Orchestrator(ethSepoliaSigner, NETWORK.TESTNET);
      const txHash = await orchestrator['lockFee'](parseEther('0.0001'));
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('solana devnet', async () => {
      // Create orchestrator for eth_sepolia signer

      const chain = CHAIN.SOLANA_DEVNET;
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) {
        throw new Error('SOLANA_PRIVATE_KEY environment variable is not set');
      }
      const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

      // Generate a keypair from the private key in .env
      const testAccount = Keypair.fromSecretKey(privateKey);

      // Create the object first with any required properties
      const solanaDevnetSigner = {
        address: testAccount.publicKey.toBase58(),
        chain,
        signMessage: async (data: Uint8Array) => {
          return nacl.sign.detached(data, testAccount.secretKey);
        },
        signTransaction: async function (unsignedTx: Uint8Array) {
          return nacl.sign.detached(unsignedTx, testAccount.secretKey);
        },
      };

      const orchestrator = new Orchestrator(
        solanaDevnetSigner,
        NETWORK.TESTNET
      );
      const txHash = await orchestrator['lockFee'](parseEther('0.0001'));
      console.log('lockFee txHash:', txHash);
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('sendCrossChainPushTx', () => {
    //
  });

  describe('computeExecutionHash', () => {
    const orc = new Orchestrator(mockSigner, NETWORK.TESTNET);
    const expectedHash =
      '0x861bf096806b54e87be2ff4480c2568e4d90161c8c9f962e392b8a7ae4f96aea';
    it('should return the expected Hash', () => {
      const value = {
        target: '0x527F3692F5C53CfA83F7689885995606F93b6164' as `0x{string}`,
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312' as `0x{string}`,
        gasLimit: BigInt(21000000),
        maxFeePerGas: BigInt(10000000000000000),
        maxPriorityFeePerGas: BigInt(2),
        nonce: BigInt(1),
        deadline: BigInt(9999999999),
      };

      const hash = orc['computeExecutionHash']({
        chainId: 9000,
        payload: value,
        verifyingContract: '0x48445e02796af0b076f96fc013536f1c879e282c',
      });
      expect(hash === expectedHash).toBe(true);
    });

    it('should return different hash on changing params', () => {
      const value = {
        target: '0x527F3692F5C53CfA83F7689885995606F93b6164' as `0x{string}`,
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312' as `0x{string}`,
        gasLimit: BigInt(21000000),
        maxFeePerGas: BigInt(10000000000000000),
        maxPriorityFeePerGas: BigInt(2),
        nonce: BigInt(1),
        deadline: BigInt(9999999998),
      };

      const hash = orc['computeExecutionHash']({
        chainId: 9000,
        payload: value,
        verifyingContract: '0x48445e02796af0b076f96fc013536f1c879e282c',
      });
      expect(hash === expectedHash).toBe(false);
    });
  });
});
