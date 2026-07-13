/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * Vitest config for Harkje.
 *
 * We test the pure-logic core services (org-tree, org-generator, csv-parser,
 * org-layout) in a node environment — no jsdom/DOM, no Angular TestBed.
 * The services are `@Injectable({ providedIn: 'root' })` but their methods
 * are pure, so specs instantiate them with `new` directly.
 *
 * Components (D3 renderer, input panel) are not unit-tested here — they
 * are DOM-heavy and thin wrappers around the tested services.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // WSL /mnt/c can be flaky with the default forks pool when running
    // multiple files in parallel; threads is reliable and fast for pure logic.
    pool: 'threads',
    coverage: {
      provider: 'v8',
      include: ['src/app/core/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
