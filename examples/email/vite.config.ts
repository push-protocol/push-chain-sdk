import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [nodePolyfills({}), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // This is the base path for the email app
  base: '/push-network-sdk/email/',
});