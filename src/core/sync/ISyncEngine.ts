import { SyncResult } from '../models/SyncResult';

/**
 * 同步引擎接口（对齐架构文档 ISyncEngine）。
 * 为契合本机 Node 环境与 sql.js 同步 API，此处以 async 封装（远端 I/O 为异步）。
 */
export interface ISyncEngine {
  /** 执行一次完整增量同步，返回同步结果。 */
  sync(): Promise<SyncResult>;
}
