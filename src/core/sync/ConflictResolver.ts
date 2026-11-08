import { NoteCard } from '../models/NoteCard';
import { SyncStatus } from '../models/SyncStatus';
import { IdGenerator } from '../utils/IdGenerator';
import { ConflictInfo } from '../models/SyncResult';

/** 冲突判定结果类型。 */
export type ConflictOutcome = 'local-wins' | 'remote-wins' | 'conflict' | 'no-change';

/** 冲突判定结果。 */
export interface ConflictResolution {
  outcome: ConflictOutcome;
  /** outcome === 'conflict' 时，由引擎写入远端的冲突副本卡片。 */
  conflictCopy?: NoteCard;
  /** outcome === 'conflict' 时，冲突明细。 */
  conflictInfo?: ConflictInfo;
}

/**
 * 冲突判定器（对齐架构文档 ConflictResolver + 第7章约定）。
 *
 * 判定依据：以 updatedAt 与增量水位线 cursor 比较。
 * - 本地与远端同一 id 的 updatedAt 都 > cursor  → 真冲突（保留双版本）。
 * - 仅一端 > cursor                                   → 采用已变更方（last-write-wins 退化）。
 * - 两端都未变更                                       → 无变化。
 *
 * 真冲突处理（绝不丢数据，见架构 1.4 / 4.3）：
 * 1. 本地版本保持不动（由引擎置为 Conflict 状态）。
 * 2. 将远端版本另存为一份"冲突副本"：新 id、内容前缀 [冲突副本]、引用原 id。
 */
export class ConflictResolver {
  public constructor(private readonly idGenerator: { newId(): string } = IdGenerator) {}

  /**
   * 判定单条卡片（local 可为 null，表示本地不存在该远端卡片）在给定 cursor 下的同步策略。
   * @param local 本地卡片（不存在则为 null）
   * @param remote 远端卡片（必填，来自远端快照）
   * @param cursor 增量水位线（null 表示首次全量）
   */
  public resolve(local: NoteCard | null, remote: NoteCard, cursor: Date | null): ConflictResolution {
    const localChanged = local !== null && this.afterCursor(local.updatedAt, cursor);
    const remoteChanged = this.afterCursor(remote.updatedAt, cursor);

    if (localChanged && remoteChanged) {
      const copy = this.buildConflictCopy(remote);
      return {
        outcome: 'conflict',
        conflictCopy: copy,
        conflictInfo: { originalId: remote.id, conflictCopyId: copy.id },
      };
    }
    if (remoteChanged) {
      return { outcome: 'remote-wins' };
    }
    if (localChanged) {
      return { outcome: 'local-wins' };
    }
    return { outcome: 'no-change' };
  }

  private afterCursor(time: Date, cursor: Date | null): boolean {
    if (cursor === null) {
      return true;
    }
    return time.getTime() > cursor.getTime();
  }

  private buildConflictCopy(remote: NoteCard): NoteCard {
    const copyId = this.idGenerator.newId();
    return {
      id: copyId,
      content: `[冲突副本] ${remote.content}`,
      tags: [...remote.tags],
      createdAt: remote.createdAt,
      updatedAt: remote.updatedAt,
      deleted: remote.deleted,
      deviceId: remote.deviceId,
      status: SyncStatus.Synced,
      version: remote.version,
      conflictOf: remote.id,
    };
  }
}
