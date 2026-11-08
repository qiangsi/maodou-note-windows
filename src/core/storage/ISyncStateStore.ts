import { SyncMeta } from '../models/SyncMeta';

/**
 * 本地同步状态存储接口（对齐架构文档 ISyncStateStore）。
 * SyncMeta 仅本地落库，不随 notes.json 传播到远端。
 */
export interface ISyncStateStore {
  /** 读取当前同步状态（无记录时返回默认值）。 */
  get(): SyncMeta;

  /** 持久化同步状态。 */
  save(meta: SyncMeta): void;
}
