import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';

/**
 * Desktop（Electron）构建配置。
 * - 主进程（electron/main.ts）在 Node 环境运行，可直接复用 maodou-notes 共享内核
 *   （含 WASM SQLite 与 node:fs 文件持久化）；渲染进程仅通过 contextBridge 调用主进程。
 * - 解析条件强制 node 优先，确保内核的 WASM SQLite Node 构建被正确加载。
 */
export default defineConfig({
  plugins: [
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
  ],
  resolve: {
    conditions: ['node', 'import', 'module', 'browser', 'default'],
  },
});
