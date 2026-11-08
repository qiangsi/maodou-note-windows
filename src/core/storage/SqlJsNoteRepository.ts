import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { NoteCard } from '../models/NoteCard';
import { SyncStatus, parseSyncStatus } from '../models/SyncStatus';
import { INoteRepository } from './INoteRepository';
import { IClock } from '../utils/Clock';
import { IdGenerator } from '../utils/IdGenerator';
import { DbInitializer } from './DbInitializer';

/**
 * 数据库句柄类型（@sqlite.org/sqlite-wasm 的 oo1.DB 实例）。
 * 此处以宽松类型引用，避免与具体构建的内部类型耦合。
 */
export type SqliteDatabase = any;

/**
 * 基于 WASM 版 SQLite（官方 @sqlite.org/sqlite-wasm，含 FTS5）的笔记仓储实现。
 *
 * 设计要点：
 * - 同步 API（WASM SQLite 在 Node 下为同步调用），因此本实现全部方法均为同步。
 * - 支持内存库（测试）与文件库（生产持久化）两种形态。
 * - 使用 FTS5(trigram) 虚拟表 notes_fts 做 content + tags 全文检索；
 *   tags_text 以 '|tag|' 形式冗余存储，便于按标签精确筛选。
 *
 * 命名说明：类名沿用架构文档的 SqlJsNoteRepository（保持目录/类名约定一致）；
 * 底层引擎已替换为官方 WASM SQLite，因社区 sql.js 预编译产物未包含 FTS5 模块，
 * 而本产品检索需求（含中文）必须依赖 FTS5。详见 README「技术选型说明」。
 */
export class SqlJsNoteRepository implements INoteRepository {
  private constructor(
    private readonly sqlite3: any,
    private readonly db: SqliteDatabase,
    private readonly clock: IClock,
    private readonly filePath: string | null,
  ) {}

  /** 创建内存数据库（测试用）。 */
  public static async createInMemory(clock: IClock): Promise<SqlJsNoteRepository> {
    const sqlite3 = await SqlJsNoteRepository.loadSqlite();
    const db = new sqlite3.oo1.DB(':memory:');
    DbInitializer.init(db);
    return new SqlJsNoteRepository(sqlite3, db, clock, null);
  }

  /**
   * 从文件加载（不存在则新建）持久化数据库。
   *
   * 说明：官方 @sqlite.org/sqlite-wasm 的 Node 构建按文件名打开的 oo1.DB 实为内存库，
   * close() 不会写盘、且 oo1.DB 无 export 方法。因此本实现统一使用 `:memory:` 库，
   * 文件存在时通过 sqlite3_deserialize 把磁盘字节载入内存；文件不存在则新建。
   * 落盘由 `save()`/`close()` 调用 sqlite3_js_db_export 显式完成（详见 saveToFile）。
   */
  public static async createFromFile(
    filePath: string,
    clock: IClock,
  ): Promise<SqlJsNoteRepository> {
    const sqlite3 = await SqlJsNoteRepository.loadSqlite();
    const db = new sqlite3.oo1.DB(':memory:');
    if (existsSync(filePath)) {
      SqlJsNoteRepository.deserializeFile(db, sqlite3, filePath);
    }
    // 建表/索引/FTS5 虚拟表与 sync_meta 均为 IF NOT EXISTS，重复调用安全：
    // - 已有文件：deserialize 后表已存在，init 为空操作；
    // - 新文件：init 创建全部结构。
    DbInitializer.init(db);
    return new SqlJsNoteRepository(sqlite3, db, clock, filePath);
  }

  /** 关闭数据库连接；若为文件库则先导出落盘（用于持久化测试等场景）。 */
  public close(): void {
    if (this.filePath) {
      this.saveToFile();
    }
    try {
      this.db.close();
    } catch {
      // 已关闭或内存库，忽略
    }
  }

  /** 显式将当前内存库导出并落盘（仅文件库有效）。可供同步完成后主动刷盘。 */
  public save(): void {
    if (this.filePath) {
      this.saveToFile();
    }
  }

  /** 把磁盘上的 SQLite 文件字节反序列化进内存库（需先 malloc 到 WASM 堆再传入指针）。 */
  private static deserializeFile(db: SqliteDatabase, sqlite3: any, filePath: string): void {
    const raw = readFileSync(filePath);
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    SqlJsNoteRepository.loadBytesInto(db, sqlite3, bytes);
  }

  /** 将 SQLite 文件字节载入给定内存库（跨平台持久化的底层原语）。 */
  private static loadBytesInto(db: SqliteDatabase, sqlite3: any, bytes: Uint8Array): void {
    const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(
      db.pointer,
      'main',
      ptr,
      bytes.length,
      bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
    );
    if (rc !== 0) {
      throw new Error(`Failed to deserialize SQLite bytes (code ${rc})`);
    }
  }

  /**
   * 将当前内存库导出为 SQLite 文件字节。供任意平台持久化使用
   * （如 Electron 主进程写磁盘、Capacitor/Tauri 调用平台文件系统写入）。
   */
  public exportBytes(): Uint8Array {
    return this.sqlite3.capi.sqlite3_js_db_export(this.db.pointer, 'main');
  }

  /**
   * 从 SQLite 文件字节构造内存库（反序列化），用于跨平台持久化重建。
   * 与 createFromFile 的区别是：本方法不依赖 node:fs，由调用方负责字节来源。
   */
  public static async importBytes(
    bytes: Uint8Array,
    clock: IClock,
  ): Promise<SqlJsNoteRepository> {
    const sqlite3 = await SqlJsNoteRepository.loadSqlite();
    const db = new sqlite3.oo1.DB(':memory:');
    SqlJsNoteRepository.loadBytesInto(db, sqlite3, bytes);
    DbInitializer.init(db);
    return new SqlJsNoteRepository(sqlite3, db, clock, null);
  }

  /** 将内存库导出为 SQLite 文件（覆盖写）。 */
  private saveToFile(): void {
    if (!this.filePath) {
      return;
    }
    const bytes = this.exportBytes();
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, Buffer.from(bytes));
  }

  /** 判断是否为文件持久化库。 */
  public isFileBacked(): boolean {
    return this.filePath !== null;
  }

  /** 暴露底层数据库句柄，便于与 SqlJsSyncStateStore 共享同一连接。 */
  public get database(): SqliteDatabase {
    return this.db;
  }

  public create(content: string, tags: string[]): NoteCard {
    const now = this.clock.utcNow();
    const card: NoteCard = {
      id: IdGenerator.newId(),
      content,
      tags: [...tags],
      createdAt: now,
      updatedAt: now,
      deleted: false,
      deviceId: null,
      status: SyncStatus.Pending,
      version: 1,
      conflictOf: null,
    };
    this.insertCard(card);
    return card;
  }

  public get(id: string): NoteCard | null {
    const stmt = this.db.prepare(`SELECT * FROM notes WHERE id = ?`);
    try {
      stmt.bind([id]);
      if (stmt.step()) {
        return this.rowToCard(stmt.get({}) as Record<string, unknown>);
      }
      return null;
    } finally {
      stmt.finalize();
    }
  }

  public getAll(includeDeleted = false): NoteCard[] {
    const sql = includeDeleted
      ? `SELECT * FROM notes ORDER BY created_at DESC`
      : `SELECT * FROM notes WHERE deleted = 0 ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.get({}) as Record<string, unknown>);
      }
    } finally {
      stmt.finalize();
    }
    return rows.map((r) => this.rowToCard(r));
  }

  public update(id: string, content: string, tags: string[]): NoteCard {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`NoteCard not found: ${id}`);
    }
    const now = this.clock.utcNow();
    const updated: NoteCard = {
      ...existing,
      content,
      tags: [...tags],
      updatedAt: now,
      version: existing.version + 1,
      status: SyncStatus.Pending,
      conflictOf: existing.conflictOf ?? null,
    };
    this.db.exec({
      sql: `UPDATE notes
              SET content=?, tags=?, tags_text=?, updated_at=?, status=?, version=?, deleted=?, device_id=?, conflict_of=?
            WHERE id=?`,
      bind: [
        updated.content,
        JSON.stringify(updated.tags),
        SqlJsNoteRepository.buildTagsText(updated.tags),
        updated.updatedAt.toISOString(),
        updated.status,
        updated.version,
        updated.deleted ? 1 : 0,
        updated.deviceId ?? null,
        updated.conflictOf ?? null,
        updated.id,
      ],
    });
    this.updateFts(updated.id, updated.content, updated.tags);
    return updated;
  }

  public softDelete(id: string): void {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`NoteCard not found: ${id}`);
    }
    const now = this.clock.utcNow();
    this.db.exec({
      sql: `UPDATE notes SET deleted=1, updated_at=?, status=?, version=? WHERE id=?`,
      bind: [now.toISOString(), SyncStatus.Pending, existing.version + 1, id],
    });
    // 软删除保留正文，检索排除由 notes.deleted=0 完成，FTS 行无需变动。
  }

  public getPending(): NoteCard[] {
    const stmt = this.db.prepare(
      `SELECT * FROM notes WHERE status = 'pending' ORDER BY updated_at DESC`,
    );
    const rows: Record<string, unknown>[] = [];
    try {
      while (stmt.step()) {
        rows.push(stmt.get({}) as Record<string, unknown>);
      }
    } finally {
      stmt.finalize();
    }
    return rows.map((r) => this.rowToCard(r));
  }

  public query(text?: string | null, tags?: string[] | null): NoteCard[] {
    const conditions: string[] = ['deleted = 0'];
    const params: unknown[] = [];
    const ftsIds: string[] | null = this.resolveTextCondition(text, conditions, params);

    if (tags && tags.length > 0) {
      for (const t of tags) {
        conditions.push(`tags_text LIKE ? ESCAPE '\\'`);
        params.push(`%|${SqlJsNoteRepository.escapeLike(t)}|%`);
      }
    }

    if (ftsIds !== null && ftsIds.length === 0 && text && text.trim().length >= 3) {
      // FTS 无命中，直接返回空（避免 IN () 语法）。短查询走 LIKE，不会进入此分支。
      return [];
    }

    const sql = `SELECT * FROM notes WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    try {
      // WASM SQLite 对无占位符的语句调用 bind([]) 会抛
      // "This statement has no bindable parameters."，故仅在存在参数时绑定。
      if (params.length > 0) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        rows.push(stmt.get({}) as Record<string, unknown>);
      }
    } finally {
      stmt.finalize();
    }
    return rows.map((r) => this.rowToCard(r));
  }

  public setSyncStatus(id: string, status: SyncStatus): void {
    this.db.exec({
      sql: `UPDATE notes SET status = ? WHERE id = ?`,
      bind: [status, id],
    });
  }

  public put(card: NoteCard): void {
    const existing = this.get(card.id);
    if (existing) {
      this.db.exec({
        sql: `UPDATE notes
                SET content=?, tags=?, tags_text=?, created_at=?, updated_at=?, deleted=?, device_id=?, status=?, version=?, conflict_of=?
              WHERE id=?`,
        bind: [
          card.content,
          JSON.stringify(card.tags),
          SqlJsNoteRepository.buildTagsText(card.tags),
          card.createdAt.toISOString(),
          card.updatedAt.toISOString(),
          card.deleted ? 1 : 0,
          card.deviceId ?? null,
          card.status,
          card.version,
          card.conflictOf ?? null,
          card.id,
        ],
      });
      this.updateFts(card.id, card.content, card.tags);
    } else {
      this.insertCard(card);
    }
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /**
   * 处理 text 检索条件：>=3 字符走 FTS5(trigram) 取得候选 id 集合；
   * 否则走 LIKE 子串（覆盖中文 2 字标签/短词检索）。
   * 返回候选 id 数组（null 表示未启用文本检索；空数组表示 FTS 无命中）。 */
  private resolveTextCondition(
    text: string | null | undefined,
    conditions: string[],
    params: unknown[],
  ): string[] | null {
    if (!text || text.trim().length === 0) {
      return null;
    }
    if (text.trim().length >= 3) {
      const ids = this.fullTextSearch(text);
      conditions.push(`id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
      return ids;
    }
    // 短查询：LIKE 子串（content 或 tags_text 命中即可）
    const likePattern = `%${SqlJsNoteRepository.escapeLike(text)}%`;
    conditions.push(
      `(content LIKE ? ESCAPE '\\' OR tags_text LIKE ? ESCAPE '\\')`,
    );
    params.push(likePattern, likePattern);
    return null;
  }

  private insertCard(card: NoteCard): void {
    this.db.exec({
      sql: `INSERT INTO notes
              (id, content, tags, tags_text, created_at, updated_at, deleted, device_id, status, version, conflict_of)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [
        card.id,
        card.content,
        JSON.stringify(card.tags),
        SqlJsNoteRepository.buildTagsText(card.tags),
        card.createdAt.toISOString(),
        card.updatedAt.toISOString(),
        card.deleted ? 1 : 0,
        card.deviceId ?? null,
        card.status,
        card.version,
        card.conflictOf ?? null,
      ],
    });
    this.insertFts(card.id, card.content, card.tags);
  }

  private insertFts(id: string, content: string, tags: string[]): void {
    this.db.exec({
      sql: `INSERT INTO notes_fts (id, content, tags) VALUES (?, ?, ?)`,
      bind: [id, content, tags.join(' ')],
    });
  }

  private updateFts(id: string, content: string, tags: string[]): void {
    this.db.exec({ sql: `DELETE FROM notes_fts WHERE id = ?`, bind: [id] });
    this.insertFts(id, content, tags);
  }

  private fullTextSearch(text: string): string[] {
    const safe = `"${text.replace(/"/g, '""')}"`;
    const stmt = this.db.prepare(`SELECT DISTINCT id FROM notes_fts WHERE notes_fts MATCH ?`);
    const ids: string[] = [];
    try {
      stmt.bind([safe]);
      while (stmt.step()) {
        const row = stmt.get([]) as unknown[];
        if (row && row.length > 0) {
          ids.push(String(row[0]));
        }
      }
    } finally {
      stmt.finalize();
    }
    return ids;
  }

  private rowToCard(row: Record<string, unknown>): NoteCard {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(String(row.tags));
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t): t is string => typeof t === 'string');
      }
    } catch {
      tags = [];
    }
    return {
      id: String(row.id),
      content: String(row.content ?? ''),
      tags,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
      deleted: !!row.deleted,
      deviceId: (row.device_id as string) ?? null,
      status: parseSyncStatus(row.status as string),
      version: typeof row.version === 'number' ? row.version : 1,
      conflictOf: (row.conflict_of as string) ?? null,
    };
  }

  private static buildTagsText(tags: string[]): string {
    if (!tags || tags.length === 0) {
      return '';
    }
    return `|${tags.join('|')}|`;
  }

  private static escapeLike(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/\|/g, '\\|');
  }

  private static async loadSqlite(): Promise<any> {
    return sqlite3InitModule();
  }
}
