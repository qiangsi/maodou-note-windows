import { NoteCard } from '../models/NoteCard';
import { SyncStatus } from '../models/SyncStatus';

/**
 * 笔记仓储接口（对齐架构文档 INoteRepository 类图，方法名采用同步风格以契合
 * sql.js 的同步 API；字段名、语义与文档完全一致）。
 *
 * 应用层使用：create / get / getAll / update / softDelete / getPending / query / setSyncStatus。
 * 同步引擎额外使用 put() 以全量写入（采纳远端版本 / 写入冲突副本）。
 */
export interface INoteRepository {
  /** 新建一条卡片：自动生成 id、UTC 时间、Pending 状态。 */
  create(content: string, tags: string[]): NoteCard;

  /** 按 id 查询单条卡片（含软删除）。 */
  get(id: string): NoteCard | null;

  /** 获取全部卡片。includeDeleted=true 时包含软删除卡片。默认按 createdAt 倒序。 */
  getAll(includeDeleted?: boolean): NoteCard[];

  /** 更新正文与标签：刷新 updatedAt、version+1、置为 Pending。createdAt 不变。 */
  update(id: string, content: string, tags: string[]): NoteCard;

  /** 软删除：标记 deleted=true，刷新 updatedAt、置为 Pending，物理行保留。 */
  softDelete(id: string): void;

  /** 获取所有待同步（status === Pending）的卡片。 */
  getPending(): NoteCard[];

  /**
   * 查询：基于 FTS5 全文检索（content + tags），并支持按标签筛选。
   * - text：全文关键字（命中 content 或 tags），为空则跳过全文检索。
   * - tags：需同时包含的标签集合（AND 语义），为空则跳过标签筛选。
   * 默认排除软删除卡片。
   */
  query(text?: string | null, tags?: string[] | null): NoteCard[];

  /** 设置单条卡片的同步状态。 */
  setSyncStatus(id: string, status: SyncStatus): void;

  /**
   * 全量写入/更新一条卡片（upsert）。用于同步引擎：
   * - 采纳远端版本（覆盖本地）。
   * - 写入新生成的冲突副本。
   * 调用方负责构造完整 NoteCard（含 createdAt / updatedAt 等）。
   */
  put(card: NoteCard): void;
}
