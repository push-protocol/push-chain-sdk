import { PushNetwork, CONSTANTS } from '@pushprotocol/push-chain';
import protobuf from 'protobufjs';
import { Buffer } from 'buffer';
import { calculateVote } from './calculateVote';

export type ConfessionType = {
  post: string;
  address: string;
  upvotes: number;
  isVisible: boolean;
};

export type RumorType = ConfessionType & {
  markdownPost: string;
  txnHash: string;
  upVoteCount: number;
};

export const getConfessions = async () => {
  try {
    const userAlice = await PushNetwork.initialize(CONSTANTS.ENV.DEV);

    const schema = `
      syntax = "proto3";

      message Confession {
        string post = 1;
        string address = 2;
        int32 upvotes = 3;
        bool isVisible = 4;
      }
    `;

    const root = await protobuf.parse(schema).root;
    const Confession = root.lookupType('Confession');

    const confessions: RumorType[] = [];
    let currentPage = 1;
    const pageSize = 15;

    while (confessions.length < 15) {
      const txRes = await userAlice.tx.get(
        Math.floor(Date.now()),
        'DESC',
        pageSize,
        currentPage,
        undefined,
        'CUSTOM:CONFESSION'
      );

      if (!txRes || txRes.blocks.length === 0) break;

      for (let i = 0; i < txRes.blocks.length; i++) {
        const block = txRes.blocks[i];
        const upVoteCount = await calculateVote(block.transactions[0].txnHash);

        const binaryData = Buffer.from(
          block.blockDataAsJson.txobjList[0].tx.data,
          'base64'
        );

        const decodedData = Confession.decode(binaryData);
        const confessionObj = Confession.toObject(decodedData, {
          longs: String,
          enums: String,
          bytes: String,
        });

        confessions.push({
          ...(confessionObj as ConfessionType),
          upVoteCount: upVoteCount,
          markdownPost: (decodedData as any).post,
          txnHash: block.transactions[0].txnHash,
        });
      }

      currentPage++;
    }

    return confessions;
  } catch (error) {
    console.error('Error fetching confessions:', error);
    return [];
  }
};
