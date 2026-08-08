import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Minimal test setup for the web package's security-critical print/PDF path
// (Issue F-1 stored-XSS fix). Mirrors vite.config.ts's alias so tests import
// application code exactly the way the real app does.
//
// react-router-dom is also aliased to unified-app's own copy: packages/web
// and packages/unified-app each have a separate physical react-router-dom
// install (same version, different module instance/React Context identity).
// Without this, a test that renders a real unified-app page component (via
// the '@' alias above) alongside a <MemoryRouter> resolved from web's own
// copy fails with "useNavigate() may be used only in the context of a
// <Router> component" -- the two copies' React Context objects don't match
// even though they're the same library version. This is a test-harness-only
// concern: production never has two copies active in the same render tree,
// since all real routing runs through unified-app's single copy.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../unified-app/src'),
      'react-router-dom': resolve(__dirname, '../unified-app/node_modules/react-router-dom'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
