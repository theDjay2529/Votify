import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        host: resolve(__dirname, 'host_6969.html'),
        participant: resolve(__dirname, 'participant.html'),
      },
    },
  },
  server: {
    host: true,
    port: 3000,
    open: true,
  },
});
