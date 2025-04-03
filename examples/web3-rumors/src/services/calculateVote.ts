import { PushNetwork } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { Buffer } from 'buffer';

export const calculateVote = async (
  pushNetwork: PushNetwork,
  txHash: string
) => {
  try {
    // Define the schema
    const schema = `
        syntax = "proto3";
  
        message Upvotes {
          repeated string wallets = 2;
          repeated string downvoteWallets = 3;
        }
      `;

    // Create a protobuf root and load the schema
    const root = await protobuf.parse(schema).root;

    // Obtain a message type
    const Upvotes = root.lookupType('Upvotes');

    // Fetch transactions
    const txRes = await pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      undefined,
      `RUMORS:${txHash}`
    );

    if (txRes.blocks.length > 0) {
      const binaryData = Buffer.from(
        txRes.blocks[0].blockDataAsJson.txobjList[0].tx.data,
        'base64'
      );

      const decodedData = Upvotes.decode(binaryData);
      const decodedObject = Upvotes.toObject(decodedData, {
        longs: String,
        enums: String,
        bytes: String,
      });

      const upvoteWallets = decodedObject.wallets || [];
      const downvoteWallets = decodedObject.downvoteWallets || [];

      return {
        upvoteWallets,
        downvoteWallets,
      };
    }

    return { upvoteWallets: [], downvoteWallets: [] };
  } catch (error) {
    console.error('Error at calculateVote():', error);
    return { upvoteWallets: [], downvoteWallets: [] };
  }
};
