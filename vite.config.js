import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main:        resolve(__dirname, 'index.html'),
        auth:        resolve(__dirname, 'auth.html'),
        home:        resolve(__dirname, 'home.html'),
        dashboard:   resolve(__dirname, 'dashboard.html'),
        join:        resolve(__dirname, 'join.html'),
        host:        resolve(__dirname, 'host_6969.html'),
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
