import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        sidebar: resolve(__dirname, 'src/sidebar.ts'),
        directory: resolve(__dirname, 'src/directory.ts'),
        chat: resolve(__dirname, 'src/chat.ts'),
        'chat-poc': resolve(__dirname, 'src/chat-poc.js'),
        // JS AI Provider files
        'content-bridge': resolve(__dirname, 'src/provider/content-bridge.ts'),
        'provider-injected': resolve(__dirname, 'src/provider/injected.ts'),
        'permission-prompt': resolve(__dirname, 'src/permission-prompt.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  publicDir: false,
  plugins: [
    {
      name: 'copy-html-and-manifest',
      writeBundle() {
        // Copy design-tokens.css
        const designTokens = readFileSync(
          resolve(__dirname, 'src/design-tokens.css'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/design-tokens.css'), designTokens);

        // Copy sidebar.html
        const sidebarHtml = readFileSync(
          resolve(__dirname, 'src/sidebar.html'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/sidebar.html'), sidebarHtml);

        // Copy directory.html
        const directoryHtml = readFileSync(
          resolve(__dirname, 'src/directory.html'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/directory.html'), directoryHtml);

        // Copy chat.html
        const chatHtml = readFileSync(
          resolve(__dirname, 'src/chat.html'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/chat.html'), chatHtml);

        // Copy chat-poc.html
        const chatPocHtml = readFileSync(
          resolve(__dirname, 'src/chat-poc.html'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/chat-poc.html'), chatPocHtml);

        // Copy permission-prompt.html
        const permissionPromptHtml = readFileSync(
          resolve(__dirname, 'src/permission-prompt.html'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/permission-prompt.html'), permissionPromptHtml);

        // Copy manifest.json
        const manifest = readFileSync(
          resolve(__dirname, 'manifest.json'),
          'utf-8'
        );
        writeFileSync(resolve(__dirname, 'dist/manifest.json'), manifest);
      },
    },
  ],
});
