/**
 * 单次同步结果（对齐架构文档 SyncResult）。
 */
export interface ConflictInfo {
  /** 发生冲突的原始卡片 id（两端各自保留的本地版本）。 */
  originalId: string;
  /** 引擎另存的远端冲突副本 id。 */
  conflictCopyId: string;
}

/**
 * 同步结果聚合对象。
 * - pushed：本次上传（新增/本地变更）到远端的卡片数。
 * - pulled：本次从远端拉取并合并到本地的卡片数。
 * - conflicts：本次检测到的真冲突数。
 * - conflictsDetail：冲突明细列表。
 * - durationMs：本次同步耗时（毫秒）。
 */
export class SyncResult {
  public pushed: number = 0;
  public pulled: number = 0;
  public conflicts: number = 0;
  public conflictsDetail: ConflictInfo[] = [];
  public durationMs: number = 0;

  public constructor(init?: Partial<SyncResult>) {
    if (init) {
      this.pushed = init.pushed ?? 0;
      this.pulled = init.pulled ?? 0;
      this.conflicts = init.conflicts ?? 0;
      this.conflictsDetail = init.conflictsDetail ?? [];
      this.durationMs = init.durationMs ?? 0;
    }
  }
}
