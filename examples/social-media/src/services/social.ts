import { BlockResponse } from '@pushprotocol/node-core/src/lib/block/block.types';
import { ENV } from '@pushprotocol/node-core/src/lib/constants';
import { PushNetwork } from '@pushprotocol/node-core';
import { Transaction } from '@pushprotocol/node-core/src/lib/generated/tx';
import { Friend, Post, Profile, PushWalletSigner } from '../types';

/**
 * Contains all utilities to interact with the Push Chain for this application
 */
export class Social {
  private TX_CATEGORY_PREFIX = 'v0_SOCIAL:';
  private CREATE_PROFILE = `${this.TX_CATEGORY_PREFIX}CREATE_PROFILE`;
  private POST = `${this.TX_CATEGORY_PREFIX}POST`;
  private FRIENDS = `${this.TX_CATEGORY_PREFIX}FRIENDS`;

  private constructor(private pushNetwork: PushNetwork) {
  }

  /**
   * @param env - The environment to use. Defaults to `ENV.DEV`.
   */
  static async initialize(env: ENV = ENV.DEV) {
    const pushNetwork = await PushNetwork.initialize(env);
    return new Social(pushNetwork);
  }

  async getProfile(address: string): Promise<Profile | null> {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      5,
      1,
      address,
      this.CREATE_PROFILE
    );

    if (response.blocks.length === 0) return null;
    const block = response.blocks[0];
    const transactions = block.blockDataAsJson.txobjList as { tx: Transaction }[];
    const decodedData = new TextDecoder().decode(
      new Uint8Array(
        Buffer.from(transactions[0].tx.data as unknown as string, 'base64')
      )
    );

    if (!decodedData) return null;

    try {
      return JSON.parse(decodedData) as Profile;
    } catch (error) {
      console.error('Invalid JSON: ', error);
      return null;
    }
  }

  async createProfile({ owner, address, bio, encryptedProfilePrivateKey, signature, handle, signer }: Profile & {
                        signer: PushWalletSigner
                      }
  ): Promise<string> {
    if (
      !handle ||
      !encryptedProfilePrivateKey ||
      !bio ||
      !signer ||
      !signature ||
      !address ||
      !owner
    ) {
      throw new Error('Invalid function input for createProfile function');
    }

    const data: Profile = {
      owner,
      address,
      encryptedProfilePrivateKey,
      bio,
      signature,
      handle
    };
    const serializedData = new TextEncoder().encode(JSON.stringify(data));
    const unsignedTx = this.pushNetwork.tx.createUnsigned(
      this.CREATE_PROFILE,
      [signer.account],
      serializedData
    );
    return await this.pushNetwork.tx.send(unsignedTx, signer);
  }

  /**
   * This will return all addresses that you follow or that follow you.
   * Used to display the feed.
   * TODO: Do signature validation
   * TODO: Take into account when user follows, unfollows and follows again
   * @param profileAddress
   */
  async getFriends(profileAddress: string): Promise<{ iFollow: string[], followMe: string[] }> {
    // If I follow someone, then `from` is my address
    // If someone follow me, then `to` is my address

    const promises: Promise<BlockResponse>[] = [];
    promises.push(this.pushNetwork.tx.getBySender(
      profileAddress,
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      this.FRIENDS
    ));
    promises.push(this.pushNetwork.tx.getByRecipient(
      profileAddress,
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      this.FRIENDS
    ));

    const [resultIFollow, resultFollowMe] = await Promise.all(promises);

    const iFollow: string[] = [];
    const followMe: string[] = [];

    if (resultIFollow.blocks.length !== 0) {
      resultIFollow.blocks.forEach(block => {
        const transactions = block.blockDataAsJson.txobjList as { tx: Transaction }[];
        transactions.forEach(t => {
          const decodedData = new TextDecoder().decode(
            new Uint8Array(Buffer.from(t.tx.data as unknown as string, 'base64')
            ));
          if (!decodedData) return;
          try {
            const friend = JSON.parse(decodedData) as Friend;
            iFollow.push(friend.to);
          } catch (error) {
            console.error('Error parsing friend object', error);
          }
        });
      });
    }

    if (resultFollowMe.blocks.length !== 0) {
      resultFollowMe.blocks.forEach(block => {
        const transactions = block.blockDataAsJson.txobjList as { tx: Transaction }[];
        transactions.forEach(t => {
          const decodedData = new TextDecoder().decode(
            new Uint8Array(Buffer.from(t.tx.data as unknown as string, 'base64')
            ));
          if (!decodedData) return;
          try {
            const friend = JSON.parse(decodedData) as Friend;
            followMe.push(friend.from);
          } catch (error) {
            console.error('Error parsing friend object', error);
          }
        });
      });
    }
    return { iFollow, followMe };
  }

  async getFeed(address: string): Promise<Post[]> {
    const response = await this.pushNetwork.tx.get(
      Math.floor(Date.now()),
      'DESC',
      5,
      1,
      address,
      this.POST
    );

    if (response.blocks.length === 0) return [];
    const posts: Post[] = [];
    const blocks = response.blocks;
    if (blocks.length === 0) return [];
    blocks.forEach(block => {
      const transactions = block.blockDataAsJson.txobjList as { tx: Transaction }[];
      transactions.forEach(t => {
        const decodedData = new TextDecoder().decode(
          new Uint8Array(
            Buffer.from(t.tx.data as unknown as string, 'base64')
          )
        );
        if (!decodedData) return [];
        try {
          const post = JSON.parse(decodedData) as Post;
          posts.push(post);
        } catch (error) {
          console.error('Invalid JSON: ', error);
          return [];
        }
      });
    });

    return posts;
  }
}