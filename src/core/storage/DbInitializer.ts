import type { SqliteDatabase } from './SqlJsNoteRepository';

/**
 * 数据库初始化：建表、索引与 FTS5 虚拟表。
 * 所有语句均为 IF NOT EXISTS，可安全重复调用（打开已有库时不报错）。
 *
 * 引擎说明：本项目使用官方 @sqlite.org/sqlite-wasm（WASM 版 SQLite）。
 * 其预编译产物默认即包含 FTS5 扩展（采用 trigram 分词器，支持中文/子串检索），
 * 而社区 sql.js 的预编译 WASM 未包含 FTS5 模块，故此处统一以官方构建为准。
 */
export class DbInitializer {
  /** 在给定数据库连接上初始化全部表结构。 */
  public static init(db: SqliteDatabase): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id           TEXT PRIMARY KEY,
        content      TEXT NOT NULL DEFAULT '',
        tags         TEXT NOT NULL DEFAULT '[]',
        tags_text    TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted      INTEGER NOT NULL DEFAULT 0,
        device_id    TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        version      INTEGER NOT NULL DEFAULT 1,
        conflict_of  TEXT
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted);`);

    // FTS5 独立虚拟表：id 仅作 UNINDEXED 关联键，content 与 tags 参与全文检索。
    // trigram 分词器对中文按字符切分，支持任意子串（>=3 字符）检索；更短查询回落到 LIKE。
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        id UNINDEXED,
        content,
        tags,
        tokenize='trigram'
      );
    `);

    // 本地同步状态表（单行，id 固定为 1）。
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_meta (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        server_base_url TEXT NOT NULL DEFAULT '',
        username        TEXT,
        last_sync_time  TEXT,
        last_sync_cursor TEXT
      );
    `);
    db.exec(`INSERT OR IGNORE INTO sync_meta(id) VALUES (1);`);
  }
}
