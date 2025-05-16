export const getWalletDataFromAccount = (
    account: string
): {
    chainId: string;
    chain: string;
    address: string;
} => {
    const addressComponent = account.split(':');

    // Handle cases where there are exactly three components (chain, chainId, address)
    if (addressComponent.length === 3) {
        return {
            chain: addressComponent[0],
            chainId: addressComponent[1],
            address: addressComponent[2],
        };
    }
    // Handle cases where there are exactly two components (chain, address)
    else if (addressComponent.length === 2) {
        return {
            chain: addressComponent[0],
            chainId: '',
            address: addressComponent[1],
        };
    }
    // If the input doesn't match the expected format, return the address only
    else {
        return {
            chain: '',
            chainId: '',
            address: account,
        };
    }
};


export function centerMaskString(str: string, len = 6) {
    if (str && str.length > 15) {
        const start = str.substring(0, len);
        const end = str.substring(str.length - len);
        return start + '...' + end;
    }
    // If the string is too short, return it as is
    return str;
}
