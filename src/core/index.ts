/**
 * 毛豆笔记 共享内核公共 API 出口。
 * 安卓（Capacitor）/ Windows（Tauri）客户端均通过本入口复用同一套核心逻辑。
 */

// 模型
export * from './models/NoteCard';
export * from './models/SyncMeta';
export * from './models/SyncStatus';
export * from './models/SyncResult';

// 工具
export * from './utils/Clock';
export * from './utils/IdGenerator';

// 存储
export * from './storage/INoteRepository';
export * from './storage/SqlJsNoteRepository';
export * from './storage/ISyncStateStore';
export * from './storage/SqlJsSyncStateStore';
export * from './storage/DbInitializer';

// 同步
export * from './sync/ISyncEngine';
export * from './sync/SyncEngine';
export * from './sync/IWebDavClient';
export * from './sync/LocalFileWebDavClient';
export * from './sync/HttpWebDavClient';
export * from './sync/ConflictResolver';

// 服务
export * from './services/TagService';
export * from './services/SearchService';
