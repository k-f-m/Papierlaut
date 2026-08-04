import { defineConfig } from 'vite';

/**
 * `SharedArrayBuffer` — and therefore multi-threaded ONNX Runtime inference —
 * is only available in a cross-origin-isolated context. The production nginx
 * config sets the same pair of headers; see docker/nginx.conf.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    host: true,
    port: 4173,
    headers: crossOriginIsolation,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // ORT ships WebAssembly and spawns its own workers; pre-bundling it through
    // esbuild rewrites those paths and breaks the loader.
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
