import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';

export const performUpVote = async (
  userAlice: PushNetwork,
  wallet: string,
  upVote: number,
  txnHash: string,
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>
) => {
  try {
    const schema = `
      syntax = "proto3";

      message Upvotes {
        int32 upvotes = 1;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;
    const Upvotes = root.lookupType('Upvotes');

    const serializedData = {
      upvotes: upVote + 1,
    };

    // Verify the data against the schema
    const errMsg = Upvotes.verify(serializedData);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Upvotes.encode(Upvotes.create(serializedData)).finish();

    // Create an unsigned transaction (keeping the hardcoded recipient address)
    const unsignedTx = userAlice.tx.createUnsigned(
      `CUSTOM:${txnHash}`,
      ['eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A'], // acc 63
      buffer
    );

    console.log('🛠️🛠️PUSH wallet address: ', wallet);

    let txHash;

    const signer = {
      account: wallet,
      signMessage: async (data: Uint8Array) => {
        try {
          return await handleSendSignRequestToPushWallet(new Uint8Array(data));
        } catch (error) {
          console.error('Error signing with Push Wallet:', error);
          throw error;
        }
      },
    };

    txHash = await userAlice.tx.send(unsignedTx, signer);
    console.log('🪙🪙Push Wallet Transaction: ', txHash);

    return true;
  } catch (error) {
    console.error('Error in performUpVote:', error);
    throw error;
  }
};
