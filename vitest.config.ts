import { defineConfig } from 'vitest/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 受限沙箱环境下系统 Temp 目录的写入常被拦截（EPERM），导致 vitest/vite 的 SSR
// 模块缓存写入出现 unhandled error。此处将临时目录收敛到项目内可写目录，并在 vite
// 服务启动前覆盖 os.tmpdir() 的取信来源（TMPDIR/TEMP/TMP），从而彻底规避该问题。
// 在常规本机环境中此目录同样可写，设置亦无害。
const projectTmp = join(process.cwd(), '.tmp');
mkdirSync(projectTmp, { recursive: true });
process.env.TMPDIR = projectTmp;
process.env.TEMP = projectTmp;
process.env.TMP = projectTmp;

export default defineConfig({
  // 强制 Vite 解析到 @sqlite.org/sqlite-wasm 的 Node 构建（而非浏览器 worker 构建），
  // 否则 vitest 在 node 环境下可能加载会发起 fetch 的浏览器构建导致失败。
  resolve: {
    conditions: ['node', 'import', 'module', 'browser', 'default'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 30000,
  },
});
