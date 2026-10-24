import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './serviceWorkerPlugin.ts';

export default defineConfig({
  // Hosting under a sub-path (GitHub Pages serves a project at /<repo>/) sets SIMUVERSE_BASE=/<repo>/.
  base: process.env.SIMUVERSE_BASE ?? '/',
  plugins: [react(), tailwindcss(), serviceWorker()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js is most of the code: it is 700 kB on its own, and changes far less often than the app.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/](\.pnpm[\\/])?three[@\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules/, priority: 1 },
          ],
        },
      },
    },
  },
});
