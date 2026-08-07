import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Minimal test setup for the web package's security-critical print/PDF path
// (Issue F-1 stored-XSS fix). Mirrors vite.config.ts's alias so tests import
// application code exactly the way the real app does.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../unified-app/src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
