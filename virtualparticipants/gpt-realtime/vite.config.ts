import path from 'path';
import * as vite from 'vite';
import * as html from 'vite-plugin-html';
import tsconfigPaths from 'vite-tsconfig-paths';

const port = Number(process.env.PORT) || 3000;

const viteConfig = vite.defineConfig({
  plugins: [
    tsconfigPaths(),
    html.createHtmlPlugin(),
    {
      name: 'configure-mime-types',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.mp4')) {
            res.setHeader('Content-Type', 'video/mp4');
          }

          next();
        });
      }
    }
  ],
  server: {
    port,
    open: '/',
    strictPort: true
  },
  build: {
    target: 'ES2022',
    emptyOutDir: true,
    outDir: path.resolve(process.cwd(), 'build'),
    rollupOptions: {
      output: {
        manualChunks,
        // Ensure worklet files are treated as separate assets
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.includes('worklet')) {
            return 'worklets/[name]-[hash][extname]';
          }

          return 'assets/[name]-[hash][extname]';
        }
      }
    }
  },
  // Configure worker handling for audio worklets
  worker: {
    format: 'es',
    plugins: () => [tsconfigPaths()]
  }
});

function manualChunks(moduleId: string) {
  const vendor = moduleId.split('/node_modules/')[1]?.split('/')[0];
  const vendorChunks = ['amazon-ivs-web-broadcast', 'micromark', 'remix'];

  if (vendor) {
    const vendorChunk = vendorChunks.find((vc) => vendor.includes(vc));

    return vendorChunk ? `vendor_${vendorChunk}` : 'vendor';
  }
}

export default viteConfig;
