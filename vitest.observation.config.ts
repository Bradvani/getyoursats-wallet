import {defineConfig} from 'vitest/config';
import {tmpdir} from 'node:os';
import path from 'node:path';

// A focused offline fixture test, with caches outside shared installed packages.
export default defineConfig({
  cacheDir: path.join(tmpdir(), 'gys-settled-observation-vitest-cache'),
  test: {environment: 'happy-dom', include: ['src/security/settledIncomingObservation.test.ts'], cache: false},
});
