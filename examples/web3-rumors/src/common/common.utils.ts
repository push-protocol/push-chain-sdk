import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
export function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(
  timestamp: string,
  showAgo: boolean = false
): string {
  const date = new Date(parseInt(timestamp, 10));
  const now = new Date();

  if (isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  const timeDiff = now.getTime() - date.getTime();
  const seconds = Math.floor(timeDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  let agoText = '';
  if (showAgo) {
    if (seconds < 60) {
      agoText = `(${seconds} seconds ago)`;
    } else if (minutes < 60) {
      agoText = `(${minutes} minutes ago)`;
    } else if (hours < 24) {
      agoText = `(${hours} hours ago)`;
    } else if (days < 30) {
      agoText = `(${days} days ago)`;
    } else if (months < 12) {
      agoText = `(${months} months ago)`;
    } else {
      agoText = `(${years} years ago)`;
    }
  }

  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return (
      date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Yesterday' + (showAgo ? ` ${agoText}` : '');
  }

  if (date.getFullYear() === now.getFullYear()) {
    return (
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      }) + (showAgo ? ` ${agoText}` : '')
    );
  }

  return (
    date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    }) + (showAgo ? ` ${agoText}` : '')
  );
}

export const extractWalletAddress = (address: string) => {
  if (address.includes(':')) {
    const parts = address.split(':');
    return parts[parts.length - 1];
  }
  return address;
};

export const getChainFromCAIP = (caip: string) => {
  const chainId = caip.split(':')[1];
  if (chainId === '1') return 'eth';
  if (chainId === '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') return 'sol';
  return 'push';
};

export const getInCAIP = (address: string, chain: string) => {
  return `${
    chain === 'eth'
      ? 'eip155:1'
      : chain === 'sol'
      ? 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      : chain === 'bnb'
      ? 'eip155:56'
      : 'push:devnet'
  }:${address}`;
};

export const markdownToPlainText = (markdown: string) => {
  return markdown
    .replace(/\*\*(.*?)\*\*/g, '$1') // Bold (**text**)
    .replace(/_(.*?)_/g, '$1') // Italic (_text_)
    .replace(/~~(.*?)~~/g, '$1') // Strikethrough (~~text~~)
    .replace(/>\s(.*?)(\r\n|\r|\n)?/g, '$1') // Blockquote (> text)
    .replace(/\[(.*?)\]\(.*?\)/g, '$1'); // Links ([text](url))
};
