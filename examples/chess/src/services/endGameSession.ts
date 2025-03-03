import { GAME_RESULT, GameData } from '@/common';
import { PushChain } from '@pushchain/devnet';
import { UniversalAddress } from '@pushprotocol/pushchain-ui-kit';

export const endGameSession = async (
  pushChain: PushChain,
  data: GameData,
  universalAddress: UniversalAddress,
  status: GAME_RESULT
) => {
  const txn = await pushChain.tx.send([], {
    category: `CHESS_GAME_RESULTS`,
    data: JSON.stringify({
      ...data,
      result: {
        address: universalAddress.address,
        status: status,
      },
    }),
  });

  console.log(txn);
};
