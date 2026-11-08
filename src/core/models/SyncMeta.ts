/**
 * 本地同步状态（仅本地存储，不传远端）。
 * 对齐架构文档 SyncMeta：
 * - serverBaseUrl：WebDAV 根地址。
 * - username：用户名（可选，凭据安全存储另行处理）。
 * - lastSyncTime：上次成功同步时间（UTC）。
 * - lastSyncCursor：增量同步水位线（UTC），仅处理 updatedAt > cursor 的变更。
 */
export class SyncMeta {
  public serverBaseUrl: string = '';
  public username?: string | null = null;
  public lastSyncTime?: Date | null = null;
  public lastSyncCursor?: Date | null = null;

  public constructor(init?: Partial<SyncMeta>) {
    if (init) {
      this.serverBaseUrl = init.serverBaseUrl ?? '';
      this.username = init.username ?? null;
      this.lastSyncTime = init.lastSyncTime ?? null;
      this.lastSyncCursor = init.lastSyncCursor ?? null;
    }
  }
}
