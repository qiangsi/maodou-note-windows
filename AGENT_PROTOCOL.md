# AGENT_PROTOCOL · AI 协作规约（毛豆笔记）

> **任何 AI 会话 / 协作者在改代码前必须先读完本文。** 违反规约的提交会被回滚。
> 背景：2026-11-08 曾发生协作方用本地旧副本覆盖关键修复的事故，本规约即为防止复发而立。

## 1. 推送纪律

- **推送前必须 `git fetch` + `git rebase origin/main`**，确认远端没有新提交后再推。
- 禁止 `--force` 推送 main（除非修复事故且有另一方确认）。
- 推送后立刻核对 `git log origin/main -1` 确认自己的提交真的在最前面。
- 网络断连导致 push 失败时，重试或走 API，**不得**因此跳过 rebase 直接强推。

## 2. 「不得回滚」清单

以下修复点是踩过坑换来的，**任何情况下不得被旧代码覆盖、回滚或"顺手清理"**。改动这些位置前必须逐条核对：

| # | 修复点 | 位置 | 说明 |
|---|--------|------|------|
| 1 | **Vite browser conditions** | `clients/desktop/vite.config.ts`（`resolve.conditions` 含 `node`）；`clients/mobile/vite.config.ts` 同理 | WASM SQLite 内核在 Node 主进程正确加载的关键，删掉即构建出坏包 |
| 2 | **`Directory.Data` 存储** | `clients/mobile/` Capacitor 配置与存储路径 | Android 端数据落到应用数据目录；改回默认值会丢用户数据 |
| 3 | **Gradle 插件接线** | `clients/mobile/android/`（gradle.properties 含 `android.useAndroidX=true`、插件声明、签名配置） | 构建链断了 APK 就打不出来 |
| 4 | **Workflow 文件** | `.github/workflows/windows.yml`（pnpm + onlyBuiltDependencies + `publish: null`）、Android 端 `.github/workflows/android.yml` | Windows runner 上 npm install 会崩（必须 pnpm）；electron-builder 需 publish=null。这些是调试多轮的成果 |
| 5 | **vitest 沙箱规避** | 根 `vitest.config.ts`（`optimizeDeps: { disabled: true }`、`cache: false`、ssr/web optimizer disabled） | 受限沙箱下 .tmp 缓存写入 EPERM |

**操作规则**：如果你发现自己的本地副本与远端在这些位置不一致，**以远端为准**，先 `git pull --rebase` 再动手，不要用本地副本覆盖。

## 3. 职责边界

| 角色 | 负责 | 不得触碰 |
|------|------|----------|
| WorkBuddy（内核协作方） | `src/`（共享内核）、`tests/` | `clients/`、`.github/workflows/`、`android/`、gradle/CI 配置 |
| 用户 / 构建 side | 构建链：`clients/mobile/android/`、`clients/desktop/electron/`、workflow、CI 配置、打包发布 | 不重构内核逻辑（小修可以，需同步测试） |

- 跨边界需求：先提 issue / 留言说明，等对方确认后再动。
- 共享内核（`src/`）改动必须带测试，`npm test` 全绿 + `tsc --noEmit` 零错误才能推。
- 双端共享的接口（内核 API、IPC、preload）变更，两端同一批次内完成，不留中间态。

## 4. 会话自检（每次开始改代码前）

```
[ ] fetch + rebase 了吗？
[ ] 本次要动的文件在职责边界内吗？
[ ] 会碰到「不得回滚」清单里的位置吗？碰到了是否保持原修复语义？
[ ] 测试跑了吗？
```
