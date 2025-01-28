import { getConfessions } from './getConfessions';

export const getSentConfessions = async (wallet: string) => {
  try {
    const allConfessions = await getConfessions();
    if (!Array.isArray(allConfessions)) {
      throw new Error(
        'Unexpected API response format: Confessions is not an array'
      );
    }

    // Filter confessions by wallet address
    const result = allConfessions.filter((item) => {
      if (!item.address) {
        console.warn('Skipping confession with missing address:', item);
        return false;
      }
      const address = item.address;
      return address === wallet;
    });

    return result;
  } catch (error) {
    console.error('Error in getSentConfessions:', error);
    return []; // Return an empty array to avoid breaking the UI
  }
};
