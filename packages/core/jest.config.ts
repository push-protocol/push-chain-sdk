export default {
  displayName: 'core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/core',
  testTimeout: 30000,
  // Unit tests only. The __e2e__ specs broadcast real testnet transactions and are
  // run exclusively through jest.e2e.config.ts (300s timeout, global setup, file
  // reporter) via `yarn e2e:ci`. Matching them here made the nx-inferred `test`
  // target try to run them at a 30s timeout.
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/src/**/*.test.ts',
  ],
  moduleNameMapper: {
    '^@e2e/shared/(.*)$': '<rootDir>/__e2e__/shared/$1',
  },
  // Exclude integration tests that make real network calls
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/lib/push-chain/push-chain\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.readonly\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.signing\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.addresses\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.reinitialize\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.explorer\\.spec\\.ts$',
    '<rootDir>/src/lib/vm-client/evm-client\\.spec\\.ts$',
    '<rootDir>/src/lib/vm-client/svm-client\\.spec\\.ts$',
    '<rootDir>/src/lib/orchestrator/orchestrator\\.spec\\.ts$',
    '<rootDir>/src/lib/price-fetch/price-fetch\\.spec\\.ts$',
  ],
};
