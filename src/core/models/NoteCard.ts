import { SyncStatus } from './SyncStatus';

/**
 * 笔记卡片数据模型（对齐架构文档类图 NoteCard）。
 *
 * 字段语义：
 * - id：本地生成，全局同步主键，永不变更。
 * - content：正文（MVP 纯文本）。
 * - tags：标签数组，存储时已去除 '#'（规范化后）。
 * - createdAt：创建时间（UTC），不可变。
 * - updatedAt：最后更新时间（UTC），冲突判定依据。
 * - deleted：软删除标记（默认 false），物理行保留并随同步传播。
 * - deviceId：来源设备标识（可选，溯源/冲突用）。
 * - status：本地同步状态（synced | pending | conflict）。
 * - version：乐观并发版本号。
 * - conflictOf：当本卡片是同步冲突时由引擎生成的"冲突副本"时，
 *   引用被复制的原始卡片 id（最小扩展，用于 UI 展示"这是谁的冲突副本"）。
 */
export interface NoteCard {
  id: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
  deviceId?: string | null;
  status: SyncStatus;
  version: number;
  /** 仅冲突副本使用：指向原始卡片 id。普通卡片为 null。 */
  conflictOf?: string | null;
}
