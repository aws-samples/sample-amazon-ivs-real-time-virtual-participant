import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@internal': path.resolve(__dirname, './src/internal'),
      '@stage': path.resolve(__dirname, './src/stage'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@processor': path.resolve(__dirname, './src/processor')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'build',
    sourcemap: true
  }
});
