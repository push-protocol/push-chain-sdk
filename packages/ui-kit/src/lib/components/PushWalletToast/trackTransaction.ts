import type { ProgressEvent } from '@pushchain/core/src/lib/progress-hook/progress-hook.types';

type ProgressResponse = {
  txHash?: unknown;
  pushTxHash?: unknown;
  chain?: unknown;
};

/** Build the `utx` value expected by the Donut lifecycle tracker. */
export const getUniversalTxId = (
  progress: ProgressEvent,
  initialChain?: string
): string | null => {
  const response = progress.response as ProgressResponse | null;
  if (!response) return null;

  const hash =
    typeof response.pushTxHash === 'string'
      ? response.pushTxHash
      : typeof response.txHash === 'string'
        ? response.txHash
        : null;
  if (!hash) return null;

  const chain =
    initialChain ||
    (typeof response.chain === 'string' ? response.chain : null);
  return chain ? `${chain}:${hash}` : null;
};
