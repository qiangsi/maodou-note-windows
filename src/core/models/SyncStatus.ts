/**
 * 本地同步状态枚举（见架构文档 NoteCard.status）。
 * 与文档类图、共享约定完全一致：
 * - Synced：已与远端一致
 * - Pending：本地已变更，待同步
 * - Conflict：检测到真冲突，已保留双版本，待用户合并
 */
export enum SyncStatus {
  Synced = 'synced',
  Pending = 'pending',
  Conflict = 'conflict',
}

/**
 * 将存储中的字符串安全解析为 SyncStatus，缺省/未知值回退为 Pending。
 */
export function parseSyncStatus(value: string | null | undefined): SyncStatus {
  switch ((value ?? '').toLowerCase()) {
    case 'synced':
      return SyncStatus.Synced;
    case 'conflict':
      return SyncStatus.Conflict;
    case 'pending':
    default:
      return SyncStatus.Pending;
  }
}
