import { UniversalAddress } from '../../../../../packages/ui-kit';

export function centerMaskString(str: string) {
  if (str && str.length > 15) {
    const start = str.substring(0, 6);
    const end = str.substring(str.length - 6);
    return start + '...' + end;
  }
  // If the string is too short, return it as is
  return str;
}

export const convertCaipToObject = (
  addressinCAIP: string
): {
  result: {
    chainId: string | null;
    chain: string | null;
    address: string | null;
  };
} => {
  // Check if the input is a valid non-empty string
  if (!addressinCAIP || typeof addressinCAIP !== 'string') {
    return {
      result: {
        chain: null,
        chainId: null,
        address: null,
      },
    };
  }

  const addressComponent = addressinCAIP.split(':');

  // Handle cases where there are exactly three components (chain, chainId, address)
  if (addressComponent.length === 3) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: addressComponent[1],
        address: addressComponent[2],
      },
    };
  }
  // Handle cases where there are exactly two components (chain, address)
  else if (addressComponent.length === 2) {
    return {
      result: {
        chain: addressComponent[0],
        chainId: null,
        address: addressComponent[1],
      },
    };
  }
  // If the input doesn't match the expected format, return the address only
  else {
    return {
      result: {
        chain: null,
        chainId: null,
        address: addressinCAIP,
      },
    };
  }
};

export const convertToCaip = ({
  address,
  chain,
  chainId,
}: UniversalAddress) => {
  return `${chain}:${chainId}:${address}`;
};
