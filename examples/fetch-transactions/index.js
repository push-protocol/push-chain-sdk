// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';

// Initialize the Push Chain SDK
const pushChain = await PushChain.initialize();
console.log('PushChain SDK initialized successfully.');

// Fetch a transaction by its hash
const transactionsByHash = await pushChain.tx.get(
  '177482c5a504f3922875c216f71a2b236f344cfbf334f97c8f59547e1e21fb23'
);
console.log('Fetched transaction by hash:', transactionsByHash);

// Fetch the latest 5 transactions - all transactions
const latestTransactions = await pushChain.tx.get('*', {
  limit: 5,
});
console.log('Fetched the latest 5 transactions:', latestTransactions);

// Fetch a transaction by category
const transactionsByCategory = await pushChain.tx.get('*', {
  category: 'CUSTOM:SAMPLE_TX',
});
console.log(
  "Fetched transactions by category 'CUSTOM:SAMPLE_TX':",
  transactionsByCategory
);

// Fetch transactions sent by a specific account
const senderAccount = {
  chain: CONSTANTS.CHAIN.PUSH,
  chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
  address: 'pushconsumer1l8wd6ucrwf43stuavxwfc9jmr5emlkr66guml6',
};

const transactionsBySender = await pushChain.tx.get(senderAccount, {
  filterMode: 'sender',
});
console.log(
  'Fetched transactions sent by account:',
  senderAccount.address,
  transactionsBySender
);

// Fetch transactions received by a specific account
const recipientAccount = {
  chain: CONSTANTS.CHAIN.ETHEREUM,
  chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
  address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
};

const transactionsByRecipient = await pushChain.tx.get(recipientAccount, {
  filterMode: 'recipient',
});
console.log(
  'Fetched transactions received by account:',
  recipientAccount.address,
  transactionsByRecipient
);

// Fetch transactions sent *OR* received by a specific account
const transactionsByAccount = await pushChain.tx.get(senderAccount, {
  filterMode: 'both',
});
console.log(
  'Fetched transactions sent or received by account:',
  senderAccount.address,
  transactionsByAccount
);
