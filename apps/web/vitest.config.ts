import { defineConfig } from 'vitest/config';

// Playwright owns e2e/; Vitest is for unit tests next to the code.
export default defineConfig({ test: { exclude: ['e2e/**', 'node_modules/**', '.next/**'] } });
