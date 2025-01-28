import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { ConfessionType } from './getConfessions';

export const postConfession = async (
  userAlice: PushNetwork,
  wallet: string,
  confessionDetails: ConfessionType,
  handleSendSignRequestToPushWallet: (data: Uint8Array) => Promise<Uint8Array>
) => {
  try {
    // Define the schema
    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        int32 upvotes = 3;
        bool isVisible = 4;
      }
    `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Confession = root.lookupType('Confession');

    // Verify the data against the schema
    const errMsg = Confession.verify(confessionDetails);
    if (errMsg) throw Error(errMsg);

    // Encode the object into a binary format
    const buffer = Confession.encode(
      Confession.create(confessionDetails)
    ).finish();
    console.log('Binary Encoded data:', buffer);

    // Create an unsigned transaction
    const unsignedTx = userAlice.tx.createUnsigned(
      'CUSTOM:CONFESSION',
      ['eip155:1:0xC9C52B3717A8Dfaacd0D33Ce14a916C575eE332A'], // acc 63
      buffer
    );
    console.log('Unsigned Transaction:', unsignedTx);

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

    return txHash;
  } catch (error) {
    console.error('Error in postConfession:', error);
    throw error; // Re-throw the error to handle it in the component
  }
};
