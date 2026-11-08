import { contextBridge, ipcRenderer } from 'electron';

/**
 * 渲染进程与内核之间的安全桥（contextIsolation 开启，nodeIntegration 关闭）。
 * 渲染进程只能通过这些白名单方法间接调用主进程中的内核逻辑。
 */

export interface MaodouApi {
  listCards(): Promise<unknown[]>;
  createCard(content: string, tags: string[]): Promise<unknown>;
  updateCard(id: string, content: string, tags: string[]): Promise<unknown>;
  deleteCard(id: string): Promise<void>;
  search(query: string | null, tags: string[] | null): Promise<unknown[]>;
  listTags(): Promise<{ tag: string; count: number }[]>;
  getSettings(): Promise<{ serverBaseUrl: string; username: string; password: string }>;
  saveSettings(s: {
    serverBaseUrl: string;
    username: string;
    password: string;
  }): Promise<void>;
  runSync(): Promise<{
    pushed: number;
    pulled: number;
    conflicts: number;
    conflictsDetail: unknown[];
    durationMs: number;
  }>;
  getMeta(): Promise<unknown>;
}

const api: MaodouApi = {
  listCards: () => ipcRenderer.invoke('cards:list'),
  createCard: (content, tags) => ipcRenderer.invoke('cards:create', content, tags),
  updateCard: (id, content, tags) =>
    ipcRenderer.invoke('cards:update', id, content, tags),
  deleteCard: (id) => ipcRenderer.invoke('cards:delete', id),
  search: (query, tags) => ipcRenderer.invoke('cards:search', query, tags),
  listTags: () => ipcRenderer.invoke('tags:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  runSync: () => ipcRenderer.invoke('sync:run'),
  getMeta: () => ipcRenderer.invoke('meta:get'),
};

contextBridge.exposeInMainWorld('maodou', api);
