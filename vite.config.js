import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths — keeps the build portable (double-clickable dist, subfolder hosting, etc.)
  build: {
    target: 'es2020',
  },
});
