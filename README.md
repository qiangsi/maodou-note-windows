# 毛豆笔记 (Maodou Notes)

类 flomo 的极简卡片笔记工具：离线优先、纯文本 + `#标签`、WebDAV 增量同步、冲突不丢数据。
设计目标来自 `architecture/ARCHITECTURE.md` 与 `prd/PRD.md`。

> ⚠️ **技术栈说明（环境约束）**：原计划为 .NET 8 共享内核（WPF/MAUI）。
> 本机**没有 .NET SDK**（仅 Node v22 与 Python 3.13），无法构建/验证 .NET 方案，
> 因此**架构、数据模型、接口契约、同步语义完全沿用设计文档**，仅实现语言下沉为
> **TypeScript / Node（ESM）**：共享内核 + WASM 版 SQLite（含 FTS5）+ 双端薄壳（Electron / Capacitor）。

---

## 目录结构

```
maodou-notes/
├── src/core/                 # 共享内核（TypeScript，双端复用）
│   ├── models/               # NoteCard / SyncMeta / SyncStatus / SyncResult
│   ├── storage/              # INoteRepository / SqlJsNoteRepository / ISyncStateStore / DbInitializer
│   ├── sync/                 # ISyncEngine / SyncEngine / IWebDavClient / Http·LocalFile WebDavClient / ConflictResolver
│   ├── services/             # TagService / SearchService
│   ├── utils/                # Clock / IdGenerator
│   └── index.ts              # 公共 API 出口（客户端从这里 import）
├── tests/                    # 内核单元测试（vitest，Node 环境）
├── clients/
│   ├── desktop/              # Windows 客户端（Electron 壳，复用内核）
│   └── mobile/               # Android 客户端（Capacitor 壳，复用内核）
├── architecture/ARCHITECTURE.md
├── prd/PRD.md
├── package.json              # 根：内核项目（也作为可被引用的库）
├── tsconfig.json
└── vitest.config.ts
```

---

## 快速开始（内核 + 测试）

```bash
cd maodou-notes
npm install
npm test          # vitest run —— 离线 CRUD / 标签 / FTS5 搜索 / 增量同步 / 冲突 / 持久化 全部覆盖
npm run typecheck # tsc --noEmit，内核类型零错误
```

- **测试要求 Node ≥ 18**（已在 v22 验证）。
- 测试完全在 Node 环境下进行，**无需 Android SDK / Windows 运行时**，通过 `LocalFileWebDavClient`（本地目录模拟 WebDAV）模拟双端同步。
- 测试默认全部为**绿色（44 个用例，9 个测试文件）**。

---

## 共享内核（src/core）

### 数据模型（与架构文档一致）

| 模型 | 关键字段 |
|------|----------|
| `NoteCard` | `id`(UUID 字符串, 同步主键), `content`, `tags[]`(去#存储), `createdAt`(UTC 不可变), `updatedAt`(UTC 冲突判定), `deleted`(软删), `deviceId?`, `status`(synced\|pending\|conflict), `version`, `conflictOf?`(冲突副本引用原 id) |
| `SyncMeta` | `serverBaseUrl`, `username?`, `lastSyncTime?`, `lastSyncCursor?`(UTC 增量水位线) |
| `SyncResult` | `pushed`, `pulled`, `conflicts`, `conflictsDetail: ConflictInfo[]`, `durationMs` |
| `SyncStatus` | `synced` / `pending` / `conflict` |

### 同步语义（与架构文档一致）

- **增量游标**：`SyncMeta.lastSyncCursor` 为 UTC 水位线；一次同步只处理双方在 `cursor` 之后有变更（双端 `updatedAt > cursor`）的卡片。
- **真冲突**：同一 `id` 本地与远端 `updatedAt` 都 `> cursor` → 本地保留并置 `Conflict`，远端版本另存为**冲突副本**（新 `id`、`conflictOf` 引用原 `id`、内容前缀 `[冲突副本]`），**两份内容都不丢**。
- **退化 LWW**：仅一端变更 → 采用已变更方，不产生冲突。
- **软删除传播**：`deleted=true` 随快照同步；常规查询默认排除，物理行保留。
- **远端形态**：单个 `notes.json` 全量 UTF-8 JSON 快照。

### 检索

- `SearchService` / `SqlJsNoteRepository.query`：基于 **FTS5（`trigram` 分词器）** 对 `content + tags` 检索；中文 ≥3 字符走 FTS5，<3 字符回落 `LIKE` 子串；标签筛选走 `tags_text LIKE '%|tag|%'`。

### 与架构文档的实现差异（最小改动，已确认）

1. **语言**：TypeScript / Node 替代 C# / .NET（本机无 .NET SDK）。
2. **存储引擎**：`@sqlite.org/sqlite-wasm`（`3.54.1-build1`，**预编译即含 FTS5**）替代社区 `sql.js`（其预编译 WASM **不含 FTS5 模块**，已验证 `no such module: fts5`）。
3. **同步/仓储方法为同步**：WASM SQLite 在 Node 下为同步调用，故 `INoteRepository` 的 CRUD 为同步方法；仅真正的异步 I/O（`createFromFile` 读盘、`SyncEngine.sync()` 中的 WebDAV 网络）保留 `Promise`。
4. **主键类型**：`string`(UUID) 对应原 `Guid`；时间统一 `Date`(UTC) 对应 `DateTime`(UTC)。
5. **文件持久化（Node/桌面）**：用 `sqlite3_js_db_export` + `sqlite3_deserialize` 显式落盘（官方 Node 构建按文件名打开实为内存库，`close()` 不写盘，且无 `db.export()`）。

---

## 客户端

两端均为**薄壳**：所有"会出 bug 的硬逻辑"（CRUD / 增量同步 / 冲突 / 检索）都在 `src/core`，壳只负责 UI 与平台桥接。

### Windows 桌面端 —— `clients/desktop`（Electron）

- 内核运行于 **Electron 主进程（Node）**，可直接复用含 `node:fs` 与 WASM SQLite 的内核；**渲染进程（浏览器）通过 `contextBridge` 暴露的 `maodouAPI` 间接调用，绝不直接 import 内核**，从而规避浏览器缺少 `node:fs` 的问题。
- 三个视图：**卡片流（Home）** / **标签（Tags）** / **设置（Settings：WebDAV + 同步）**。
- 本地数据落盘在 `userData/maodou.db`。
- 依赖 `maodou-notes` 以 `file:../..` 形式引用共享内核。

```bash
cd clients/desktop
npm install
npm run dev     # 开发（Vite + vite-plugin-electron）
npm run build   # 产出 dist-electron + 渲染产物
```

### Android 移动端 —— `clients/mobile`（Capacitor）

- WebView 中运行同样的 TypeScript 内核；因 WebView 无 `node:fs`，移动端**不使用文件型仓储**，而是用 `SqlJsNoteRepository` 的**内存库 + `exportBytes()` / `importBytes()`** 配合 **`@capacitor/filesystem`** 做离线持久化（构建时把 `node:fs` 别名到空实现）。
- 三 Tab：**卡片流（Home）** / **标签（Tags）** / **设置（Settings）**，右下角悬浮 ＋ 打开底部抽屉新建卡片。
- 同步走 `HttpWebDavClient`（浏览器 `fetch` + Basic Auth）。
- 依赖 `maodou-notes` 以 `file:../..` 形式引用共享内核。

```bash
cd clients/mobile
npm install
npm run build          # 产出 dist/（web 资源）
npx cap add android    # 生成完整原生工程（首次）
npx cap sync           # 同步 web 资源到 Android 工程
```

> 说明：`clients/mobile/android/` 下已提供关键原生文件（`MainActivity.java` / `AndroidManifest.xml` / `build.gradle` 等）作为骨架；完整 Gradle Wrapper 由 `npx cap add android` 生成。

---

## 分享长图（Share as Long Image）

把一个笔记渲染成一张竖版长图，方便分享到社交平台 / 朋友圈。类 flomo 的「生成分享图」能力。

### 能力

- **单条笔记 → 一张长图**：正文 + `#标签` chips + 创建时间，高度按内容自适应。
- **3 个模板**（可用 `listShareTemplates()` 获取元信息，或 `listTemplates()` 内核层）：
  - `paper` —— 纸感卡片（米色纸张 + 便签阴影，默认模板）
  - `minimal` —— 简约留白（纯白、克制排版）
  - `dark` —— 暗色渐变（深色 + 渐变背景）
- **右下角水印**：固定显示「毛豆笔记」(中文) + 「Maodou-Memo」(英文)，小字、低透明度；文案可通过 `options.watermarkZh / watermarkEn` 覆盖。
- **安全**：正文做 XML 转义，杜绝注入；中文/英文/emoji 混排按近似字宽自动换行。

### 内核 API（共享，两端复用）

```ts
import { generateShareSvg, listTemplates } from 'maodou-notes';

const svg = generateShareSvg(note, { templateId: 'paper' });
// 返回一张 SVG 长图字符串，宽度 1080，高度自适应
```

### 客户端导出

内核产出的是**矢量 SVG**，两端在 WebView 里把它栅格化成 PNG：

- Windows（Electron）：`clients/desktop/src/share-export.ts` 提供 `svgToPngDataUrl()` + `downloadDataUrl()`。
  ```ts
  const svg = await window.maodou.generateShareImage(noteId, 'paper'); // 主进程渲染
  const png = await svgToPngDataUrl(svg, 2);
  downloadDataUrl(png, `maodou-${noteId}.png`);
  ```
- Android（Capacitor）：`clients/mobile/src/share-export.ts` 提供 `svgToPngDataUrl()` + `saveSharePng()`（写入设备 Documents 目录）。

### 详情页「分享」按钮（两端一致体验）

卡片详情页内已内置「分享长图」区，无需手写调用：

- **入口**：卡片流点击任意卡片 → 桌面端弹出**居中模态**（`clients/desktop/src/main.ts` 的 `openDetail()` 渲染 `.modal-mask`），安卓端弹出**底部 sheet**（`clients/mobile/src/main.ts` 的 `openDetail()` 渲染 `.sheet-mask` + `.sheet--scroll`）。
- **分享区结构**：模板切换按钮（`.tpl-btn`，当前选中高亮，默认 `paper`）+ 长图实时预览（`.share-preview` 内嵌 SVG）+「导出 PNG」按钮（`#share-export`）。
- **切换模板**：点击 `.tpl-btn` 立即以新 `templateId` 重新调用 `generateShareImage()` 并重绘预览。
- **导出**：
  - 桌面：点击「导出 PNG」→ `svgToPngDataUrl()` 栅格化（2×）→ `downloadDataUrl()` 触发浏览器下载 `maodou-<noteId>.png`。
  - 安卓：点击「导出 PNG」→ `saveSharePng()` 栅格化并写入设备 `Documents/maodou/<noteId>.png`（可在文件管理器/相册导入访问）。
- **防误触**：卡片上的「软删除」按钮已 `stopPropagation()`，点击删除不会触发详情弹层。

### 测试

`tests/ShareImage.test.ts`（13 用例）覆盖：模板列表、水印中英文、正文/日期/标签渲染、XSS 转义、空内容/空标签、超长中文断行、模板差异（暗色渐变 / 简约无阴影）、自定义水印。

---

## 验证范围

- ✅ 本机可验证（已全绿 54/54）：离线 CRUD、标签解析/规范化/去重、FTS5 中文检索、增量同步往返、真冲突保留双版本、退化 LWW、软删除同步、SyncMeta 文件持久化、软删除跨设备延迟同步回归、边界健壮性（空内容/特殊字符/LIKE 转义等）、**分享长图渲染（3 模板 + 水印 + XSS 转义）**。
- ⛔ 需真机/真环境：Android UI 交互与权限、Windows 窗口体验、真实 WebDAV 服务器协议兼容性、跨网络性能。

### QA 验收记录（第二轮独立验证）

- QA 独立复跑并补充了 `tests/qa_hardening.test.ts`、`tests/qa_softdelete_resurrection.test.ts` 两组加固/回归用例。
- **发现并修复的源码 Bug**：`SqlJsNoteRepository.query()` 在无可绑定参数时调用 `stmt.bind([])`，WASM SQLite 抛 `This statement has no bindable parameters.`；已改为 `params.length > 0` 时才绑定。
- 修复后全量回归：**54 passed / 0 failed**，`tsc --noEmit` 零错误。
