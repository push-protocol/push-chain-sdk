import { Address, Tx } from '../../src';
import { TxCategory } from '../../src/lib/tx/tx.types';
import { InitDid } from '../../src/lib/generated/txData/init_did';
import { config } from '../config';
import { TxResponse } from '../../src/lib/tx/tx.types';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { hexToBytes } from 'viem';
import { ENV } from '../../src/lib/constants';

// Mock data for testing
const mockInitDidTxData: InitDid = {
  masterPubKey: 'efdgakce',
  derivedKeyIndex: 0,
  derivedPubKey: 'jdwdwowfn',
  walletToEncDerivedKey: {
    'push:devnet:push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux': {
      encDerivedPrivKey: {
        ciphertext: 'qwe',
        salt: 'qaz',
        nonce: '',
        version: 'push:v5',
        preKey: '',
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

describe('Tx', () => {
  const env = config.ENV;
  const txChecker = (tx: TxResponse) => {
    expect(tx).toHaveProperty('txnHash');
    expect(tx).toHaveProperty('ts');
    expect(tx).toHaveProperty('blockHash');
    expect(tx).toHaveProperty('category');
    expect(tx).toHaveProperty('sender');
    expect(tx).toHaveProperty('status');
    expect(tx).toHaveProperty('recipients');
    expect(tx).toHaveProperty('txnData');
    expect(tx).toHaveProperty('sig');
  };
  it('should create an unsigned transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const tx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    expect(tx).toEqual({
      type: 0,
      category: TxCategory.INIT_DID,
      sender: '',
      recipients: mockRecipients,
      data: Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID),
      salt: tx.salt,
      apiToken: tx.apiToken,
      signature: new Uint8Array(0),
      fee: '0',
    });
  });
  it('should serialize an unsigned transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const unsignedTx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    const serializedTx = Tx.serialize(unsignedTx);
    expect(serializedTx).toBeInstanceOf(Uint8Array);
    expect(unsignedTx).toEqual(Tx.deserialize(serializedTx));
  });
  it('should serialize a signed transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const unsignedTx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    const signedTx = {
      ...unsignedTx,
      signature: new Uint8Array([6, 7, 8, 9, 10]),
      sender: 'eip155:1:0xabcc',
    };
    const serializedTx = Tx.serialize(signedTx);
    expect(serializedTx).toBeInstanceOf(Uint8Array);
    expect(signedTx).toEqual(Tx.deserialize(serializedTx));
  });
  it('should serialize a Tx data into a Uint8Array', () => {
    const serializedTxData = Tx.serializeData(
      mockInitDidTxData,
      TxCategory.INIT_DID
    );
    expect(serializedTxData).toBeInstanceOf(Uint8Array);
    expect(serializedTxData.length).toBeGreaterThan(0);
  });
  it('should deserialize a Uint8Array into a Tx Data object', () => {
    const serializedTxData = Tx.serializeData(
      mockInitDidTxData,
      TxCategory.INIT_DID
    );
    const deserializedTxData = Tx.deserializeData(
      serializedTxData,
      TxCategory.INIT_DID
    );
    expect(deserializedTxData).toEqual(mockInitDidTxData);
  });
  it('should get transactions with default parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get();
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with custom parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now() / 1000),
      'DESC',
      10,
      2
    );
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions for a specific user', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4'
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Category', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      undefined,
      'CUSTOM:PUSH_MAIL'
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Sender', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getBySender(
      'push:devnet:push18zc5t7jjnzyvzjs0707gy5axtntzqgv5w6lnuh',
      Math.floor(Date.now()),
      'DESC',
      10,
      1
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Recipient', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getByRecipient(
      'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      Math.floor(Date.now()),
      'DESC',
      10,
      1
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should search for a tx by hash', async () => {
    const txInstance = await Tx.initialize(env);
    const txHash = '9f636ac0faa040a74ae49410528c5634';
    const res = await txInstance.search(txHash);
    if (res.blocks.length > 0) {
      expect(res.blocks.length).toEqual(1);
      expect(res.blocks[0].transactions.length).toEqual(1);
    }
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should send for a tx', async () => {
    const txInstance = await Tx.initialize(env);
    for (let i = 0; i < 1; i++) {
      const recipients = [
        `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
      ];
      const tx = txInstance.createUnsigned(
        TxCategory.INIT_DID,
        recipients,
        Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
      );

      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      const signer = {
        account: Address.toPushCAIP(account.address, ENV.DEV),
        signMessage: async (data: Uint8Array) => {
          const signature = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(signature);
        },
      };
      const res = await txInstance.send(tx, signer);
      expect(typeof res).toEqual('string');
    }
  });
});
