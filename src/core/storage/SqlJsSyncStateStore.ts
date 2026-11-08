import { SyncMeta } from '../models/SyncMeta';
import { ISyncStateStore } from './ISyncStateStore';
import type { SqliteDatabase } from './SqlJsNoteRepository';

/**
 * 基于同一 SQLite 文件的本地同步状态存储实现。
 * 与 SqlJsNoteRepository 共享同一个 Database 实例；文件库写入即落盘，
 * 因此 save() 后即可保证 SyncMeta 与笔记数据一起持久化。
 */
export class SqlJsSyncStateStore implements ISyncStateStore {
  public constructor(private readonly db: SqliteDatabase) {}

  public get(): SyncMeta {
    const stmt = this.db.prepare(`SELECT * FROM sync_meta WHERE id = 1`);
    try {
      if (stmt.step()) {
        const row = stmt.get({}) as Record<string, unknown>;
        return new SyncMeta({
          serverBaseUrl: String(row.server_base_url ?? ''),
          username: (row.username as string) ?? null,
          lastSyncTime: row.last_sync_time ? new Date(String(row.last_sync_time)) : null,
          lastSyncCursor: row.last_sync_cursor ? new Date(String(row.last_sync_cursor)) : null,
        });
      }
    } finally {
      stmt.finalize();
    }
    return new SyncMeta();
  }

  public save(meta: SyncMeta): void {
    this.db.exec({
      sql: `UPDATE sync_meta
              SET server_base_url=?, username=?, last_sync_time=?, last_sync_cursor=?
            WHERE id=1`,
      bind: [
        meta.serverBaseUrl ?? '',
        meta.username ?? null,
        meta.lastSyncTime ? meta.lastSyncTime.toISOString() : null,
        meta.lastSyncCursor ? meta.lastSyncCursor.toISOString() : null,
      ],
    });
  }
}
