import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Default to plain Node; DOM-dependent suites opt in per file with a
    // `@vitest-environment jsdom` docblock.
    environment: 'node',
    restoreMocks: true,
  },
});
