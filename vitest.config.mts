import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/compactPAccessory.ts',
        'src/cts700Data.ts',
        'src/cts700Modbus.ts',
        'src/cts700TargetResolver.ts',
        'src/platform.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    clearMocks: true,
    restoreMocks: true,
  },
});
