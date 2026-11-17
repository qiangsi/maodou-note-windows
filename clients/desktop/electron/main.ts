import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// ESM 下没有 __dirname，用 import.meta.url 推导（打包后 package.json type=module，主进程按 ESM 加载）
const __dirname = dirname(fileURLToPath(import.meta.url));

// 复用共享内核（TypeScript 内核在 Node 主进程直接运行，node:fs / WASM SQLite 均可用）
import {
  SqlJsNoteRepository,
  SqlJsSyncStateStore,
  SyncEngine,
  HttpWebDavClient,
  ConflictResolver,
  SystemClock,
  SyncMeta,
  generateShareSvg,
  listTemplates,
  type NoteCard,
  type SyncResult,
} from 'maodou-notes';

/**
 * Windows 客户端主进程。
 * 内核（Repository / StateStore / SyncEngine）全部运行于 Node 主进程；
 * 渲染进程（浏览器）通过 contextBridge 暴露的 maodouAPI 调用，绝不直接 import 内核，
 * 从而避免浏览器环境缺少 node:fs 的问题。
 */

const isDev = !app.isPackaged;
let forceQuit = false;
const DB_PATH = join(app.getPath('userData'), 'maodou.db');
const SETTINGS_PATH = join(app.getPath('userData'), 'settings.json');

interface DesktopSettings {
  serverBaseUrl: string;
  username: string;
  password: string;
  /** 关闭按钮行为：ask=每次询问（默认），minimize=最小化到托盘，exit=直接退出 */
  closeAction?: 'ask' | 'minimize' | 'exit';
}

function loadSettings(): DesktopSettings {
  try {
    if (existsSync(SETTINGS_PATH)) {
      return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) as DesktopSettings;
    }
  } catch {
    // 忽略损坏的配置，回退默认值
  }
  return { serverBaseUrl: '', username: '', password: '', closeAction: 'ask' };
}

function saveSettings(s: DesktopSettings): void {
  mkdirSync(join(SETTINGS_PATH, '..'), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s), 'utf-8');
}

// ---------- 托盘 + 关闭行为 ----------
let tray: import('electron').Tray | null = null;

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    createWindow();
  }
}

function createTray(): void {
  // 托盘图标：优先用打包时的应用图标（resources/tray.png），缺失时空图标兜底
  let icon = nativeImage.createEmpty();
  const iconCandidates = [
    join(__dirname, 'tray.png'),
    join((process as any).resourcesPath ?? '', 'tray.png'),
    join(__dirname, '../dist/tray.png'),
  ];
  for (const p of iconCandidates) {
    try {
      if (p && existsSync(p)) {
        icon = nativeImage.createFromBuffer(readFileSync(p));
        if (!icon.isEmpty()) break;
      }
    } catch { /* try next */ }
  }
  tray = new Tray(icon);
  tray.setToolTip('毛豆笔记');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开毛豆笔记', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          forceQuit = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => showMainWindow());
}

async function handleCloseRequest(win: BrowserWindow): Promise<void> {
  const s = loadSettings();
  const action = s.closeAction ?? 'ask';
  if (action === 'exit') {
    forceQuit = true;
    app.quit();
    return;
  }
  if (action === 'minimize') {
    win.hide(); // 隐藏到托盘，不占任务栏
    return;
  }
  // ask：弹一次三选一，可勾选"记住我的选择"
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: '关闭毛豆笔记',
    message: '要退出毛豆笔记，还是最小化到系统托盘？',
    detail: '最小化后程序在托盘运行，点托盘图标可重新打开。',
    checkboxLabel: '记住我的选择，不再询问',
    checkboxChecked: false,
    buttons: ['最小化到托盘', '退出程序', '取消'],
    defaultId: 0,
    cancelId: 2,
  });
  if (r.response === 2) return; // 取消
  const chosen: 'minimize' | 'exit' = r.response === 0 ? 'minimize' : 'exit';
  if (r.checkboxChecked) {
    saveSettings({ ...s, closeAction: chosen });
  }
  if (chosen === 'minimize') {
    win.hide();
  } else {
    forceQuit = true;
    app.quit();
  }
}

async function createRepository() {
  const clock = new SystemClock();
  const repository = await SqlJsNoteRepository.createFromFile(DB_PATH, clock);
  const stateStore = new SqlJsSyncStateStore(repository.database);
  return { repository, stateStore, clock };
}

let repository: SqlJsNoteRepository;
let stateStore: SqlJsSyncStateStore;
let clock: SystemClock;

// 启动后初始化内核与 IPC 通道
async function bootstrap(): Promise<void> {
  const bundle = await createRepository();
  repository = bundle.repository;
  stateStore = bundle.stateStore;
  clock = bundle.clock;
  registerIpc();
}

function collectTags(): { tag: string; count: number }[] {
  const all = repository.getAll(true).filter((c) => !c.deleted);
  const counter = new Map<string, number>();
  for (const card of all) {
    for (const tag of card.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

function registerIpc(): void {
  ipcMain.handle('cards:list', () => repository.getAll());
  ipcMain.handle('cards:create', (_e, content: string, tags: string[]) =>
    repository.create(content, tags),
  );
  ipcMain.handle('cards:update', (_e, id: string, content: string, tags: string[]) =>
    repository.update(id, content, tags),
  );
  ipcMain.handle('cards:delete', (_e, id: string) => {
    repository.softDelete(id);
    repository.save();
  });
  ipcMain.handle('cards:search', (_e, query: string | null, tags: string[] | null) =>
    repository.query(query, tags),
  );
  ipcMain.handle('tags:list', () => collectTags());

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, s: DesktopSettings) => {
    saveSettings(s);
    const meta = stateStore.get();
    stateStore.save(
      new SyncMeta({
        serverBaseUrl: s.serverBaseUrl,
        username: s.username,
        lastSyncTime: meta.lastSyncTime,
        lastSyncCursor: meta.lastSyncCursor,
      }),
    );
  });

  ipcMain.handle('sync:run', async (): Promise<SyncResult> => {
    const s = loadSettings();
    const webDav = new HttpWebDavClient(s.serverBaseUrl, s.username, s.password);
    const engine = new SyncEngine(
      repository,
      stateStore,
      webDav,
      new ConflictResolver(),
      clock,
    );
    const result = await engine.sync();
    repository.save(); // 同步完成后落盘
    return result;
  });

  ipcMain.handle('meta:get', () => stateStore.get());

  // 分享长图：列出模板 / 把单条笔记渲染为 SVG 长图
  ipcMain.handle('share:templates', () => listTemplates());
  ipcMain.handle('share:generate', (_e, noteId: string, templateId: string) => {
    const note = repository.get(noteId);
    if (!note) {
      throw new Error(`note not found: ${noteId}`);
    }
    return generateShareSvg(note, { templateId });
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    title: '毛豆笔记',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 点关闭（含 Alt+F4）走询问/托盘逻辑；只有托盘菜单"退出"才真正退出
  win.on('close', (e) => {
    if (forceQuit) return;
    e.preventDefault();
    void handleCloseRequest(win);
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    await bootstrap();
    createWindow();
    if (!isDev) {
      createTray();
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err) {
    // 启动失败绝不能静默：弹出错误窗口并把日志写到 userData 方便排查
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    dialog.showErrorBox('毛豆笔记启动失败', detail);
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(join(app.getPath('userData'), 'startup-error.log'), detail, 'utf-8');
    } catch { /* ignore */ }
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // 托盘模式下窗口隐藏后此事件不触发；此处理只兜底真退出时的清理
  if (repository) {
    repository.close();
  }
  if (process.platform !== 'darwin' || forceQuit) {
    app.quit();
  }
});
