import { Address, CONSTANTS, Tx } from '../../src';
import { TxCategory } from '../../src/lib/tx/tx.types';
import { InitDid } from '../../src/lib/generated/txData/init_did';
import { config } from '../config';
import { TxResponse } from '../../src/lib/tx/tx.types';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { Hex, hexToBytes, toHex, verifyMessage } from 'viem';
import { ENV } from '../../src/lib/constants';
import { sha256 } from '@noble/hashes/sha256';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { INIT_DID_TX, INIT_DID_TX_2 } from '../data';
import { randomBytes } from 'tweetnacl';

const test_pk = generatePrivateKey();
const test_account = privateKeyToAccount(test_pk);
// Mock data for testing
const mockInitDidTxData: InitDid = {
  masterPubKey: test_account.publicKey.slice(2), // remove 0x
  derivedKeyIndex: 0,
  derivedPubKey: '00000',
  walletToEncDerivedKey: {
    'push:devnet:push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux': {
      encDerivedPrivKey: {
        ciphertext: 'sample_ciphertext',
        salt: 'sample_salt',
        nonce: 'sample_nonce',
        version: 'push:v5',
        preKey: 'sample_prekey',
      },
      signature: new Uint8Array([1, 2, 3]),
    },
  },
};
const mockRecipients = [
  `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
  `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
  `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
];

async function sendCustomTx(
  txInstance: Tx,
  senderPrivateKey: Hex,
  nonce: number
) {
  const recipients = [
    `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
    `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
    `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
  ].map((value) => Tx.normalizeCaip(value));
  const category = ('CUSTOM:V' + nonce).substring(0, 21);
  const sampleData = intToArray(nonce);
  const sampleTx = txInstance.createUnsigned(category, recipients, sampleData);

  const account = privateKeyToAccount(senderPrivateKey);
  const senderInCaip = Address.toPushCAIP(account.address, ENV.DEV);
  const signer = {
    account: senderInCaip,
    signMessage: async (data: Uint8Array) => {
      const signature = await account.signMessage({
        message: { raw: data },
      });
      return hexToBytes(signature);
    },
  };
  const res = await txInstance.send(sampleTx, signer);
  return res;
}

// add .skip if needed
describe('validator smoke test', () => {
  // NOTE: you can switch manually to CONSTANTS.ENV.LOCAL or CONSTANTS.ENV.DEV
  const env = config.ENV;

  it('sinittx : send INIT_DID tx', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX_2.masterPrivateKey as `0x${string}`
    );
    const signer = {
      account: Address.toPushCAIP(account.address, ENV.DEV),
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.send(INIT_DID_TX_2.unsignedInitDIDTx, signer);
    expect(typeof res).toEqual('string');
  });

  it('spam100 : spam 100 custom tx', async () => {
    const txInstance = await Tx.initialize(env);
    await sleep(2000);
    const iterations = 50;
    const delay = 50;
    const senderPrivKey = generatePrivateKey();
    const arr: Promise<string>[] = [];
    for (let i = 0; i < iterations; i++) {
      arr.push(sendCustomTx(txInstance, senderPrivKey, i));
      await sleep(delay);
    }
    const allTxIds = await Promise.allSettled(arr);
    console.log('total sent txs %d', allTxIds.length);
    for (const res of allTxIds) {
      console.log('res %o', res);
    }
  });

  it('wtr : write and read 10 custom', async () => {
    const iterations = 1;
    const txInstance = await Tx.initialize(env);
    for (let i = 0; i < iterations; i++) {
      const recipients = [
        `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
      ].map((value) => Tx.normalizeCaip(value));
      const category = 'CUSTOM:NETWORK_BENCH';
      const sampleTx = txInstance.createUnsigned(
        category,
        recipients,
        new Uint8Array(randomBytes(20))
      );

      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      const senderInCaip = Address.toPushCAIP(account.address, ENV.DEV);
      const signer = {
        account: senderInCaip,
        signMessage: async (data: Uint8Array) => {
          const signature = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(signature);
        },
      };
      const res = await txInstance.send(sampleTx, signer);
      expect(typeof res).toEqual('string');

      await sleep(10000);

      // read
      for (const recipient of [senderInCaip, ...recipients]) {
        console.log('checking %s', recipient);
        const res = await txInstance.getTransactionsFromVNode(
          recipient,
          category
        );
        expect(res.items).toBeInstanceOf(Array);
        const item0 = res.items[0];
        expect(item0.sender).toEqual(signer.account);
        expect(item0.recipientsList).toEqual(sampleTx.recipients);
        const sampleDataBase16 = toHex(sampleTx.data).substring(2);
        expect(item0.data).toEqual(sampleDataBase16);
        console.log('OK %o', res);
      }
    }
  });

  it('read :: should get transactions with custom parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getTransactionsFromVNode(
      'eip155:1:0x76cfb79DA0f91b2C162cA2a23f7f0117bD8cDB2c',
      'CUSTOM:CORE_SDK'
    );
    expect(res.items).toBeInstanceOf(Array);
    console.log('%o', res);
  });

  it('read :: should get transactions with custom parameters2', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getTransactionsFromVNode(
      'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      'CUSTOM:NETWORK_BENCH'
    );
    expect(res.items).toBeInstanceOf(Array);
    console.log('%o', res);
  });
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function intToArray(i: number) {
  return Uint8Array.of(
    (i & 0xff000000) >> 24,
    (i & 0x00ff0000) >> 16,
    (i & 0x0000ff00) >> 8,
    (i & 0x000000ff) >> 0
  );
}
