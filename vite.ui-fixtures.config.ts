import {defineConfig} from 'vite';
import baseConfig from './vite.config';

// Isolated, compiled UI acceptance pages. Never part of the production build.
// Static serving prevents dependency optimization/HMR from interrupting a test.
export default defineConfig(env => {
  const config = baseConfig(env);
  return {
    ...config,
    plugins: config.plugins?.filter(plugin => !(plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === 'getyoursats-release-manifest')),
    build: {
      ...config.build,
      outDir: 'ui-test-dist',
      sourcemap: false,
      rolldownOptions: {input: ['premium-ui','wallet-setup','payment-fiat','scanner-review'].map(name => `e2e/fixtures/${name}.html`)},
    },
  };
});
