# AGENT_PROTOCOL — 多 Agent 协作规约（Windows 端仓库）

> 本仓库是毛豆笔记 Windows 端（Electron）。Android 端见 `qiangsi/maodou-note-android`
> ——那边有一份同规约的 Android 版，含移动端不得回滚清单。**跨仓库协作规矩以两边文件为准，互相引用。**

本仓库由多个 AI Agent 会话（Hermes / WorkBuddy 等）共同维护。
它们**不能互相通信**，只能通过 git 仓库感知彼此。以下是强制规约，违反会导致别人的修复被静默回滚（已发生过多次）。

## 分工

| 角色 | 负责 | 不碰 |
|---|---|---|
| 写代码的会话（WorkBuddy 等） | `src/`（共享内核）、`tests/`、`clients/desktop/src/`、文档 | 构建链、CI、electron-builder 配置 |
| 打包/发布的会话 | `.github/workflows/`、`clients/desktop/electron/`、`vite.config.ts`、`build/` 图标、发布 Release | 业务逻辑实现 |

## 推送规则（强制）

1. **推送前必须 `git fetch` 并检查远端 head**：
   ```bash
   git fetch origin
   git log HEAD..origin/main --oneline   # 有输出说明别人推过新东西
   git pull --rebase origin main         # 先整合再推送
   ```
   直接 push 失败出现 `non-fast-forward` 时，**绝不**用 `--force`。
   （本机网络对 github.com 不稳定时可用 Git Data API 逐文件推送，但**推送前照样要先 fetch 对比**。）
2. **工作副本必须先同步再改**。开工前 `git pull`；不要在几天前的旧副本上直接提交推送。

## 关键修复点（不得回滚清单）

这些是历史踩坑换来的，任何提交如果 diff 中出现以下内容被回退，先停下来想：

| 文件 | 必须保持的状态 | 为什么 |
|---|---|---|
| `clients/desktop/vite.config.ts` | `resolve.conditions` 数组**必须含** `'node'` 且 node 优先 | WASM SQLite 内核在 Electron 主进程要用 Node 构建，conditions 缺 `'node'` 会解析到 browser 构建，node:fs 不可用，数据持久化全挂 |
| `.github/workflows/windows.yml` | 用 **pnpm**（`pnpm install --shamefully-hoist`）+ `pnpm-workspace.yaml` 写 `onlyBuiltDependencies: electron / esbuild` | Windows runner 上 npm install 必崩（"Exit handler never called"，npm 自身 bug）；pnpm 不放行 postinstall 则 Electron 二进制缺失，electron-builder 打不出包 |
| `clients/desktop/package.json` | `build.publish: null`；`repository` 字段存在 | publish 未显式置空时 electron-builder 检测不到仓库 → `Cannot read properties of null (reading 'provider')` 崩在最后一步 |
| `.github/workflows/windows.yml` | 测试步骤 `npm ci && npm test` 在**根目录**先跑 | 内核回归是打包的前置闸门 |
| 根 `vitest.config.ts` | `optimizeDeps: { disabled: true }`、`cache: false`、ssr/web optimizer disabled | 受限沙箱下 .tmp 缓存写入 EPERM |

## 构建与发布流程

```bash
# 1. 内核测试
npm test && npm run typecheck
# 2. 桌面构建（本机 ELECTRON_SKIP_BINARY_DOWNLOAD=1；真二进制只在 CI 下载）
cd clients/desktop && npm install && npm run build
# 3. push 后 GitHub Actions（windows.yml）自动出 NSIS 安装包 artifact
# 4. 发布：挂 GitHub Release（v0.1.0 起有安装包），无授权限制随意分发
```

## 沟通

- 有跨会话需要对方知道的决策 → 写进本文件，不要只写在自己的会话记忆里。
- 本仓库与 `maodou-note-android` 共享内核（`src/`）：内核改动两边都要测试全绿；接口变更两端同一批次完成，不留中间态。
- 构建产物（`dist/`、`dist-electron/`）不提交：CI 会重新生成。
