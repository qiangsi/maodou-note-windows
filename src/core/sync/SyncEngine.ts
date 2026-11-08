import { INoteRepository } from '../storage/INoteRepository';
import { ISyncStateStore } from '../storage/ISyncStateStore';
import { IWebDavClient } from './IWebDavClient';
import { ConflictResolver } from './ConflictResolver';
import { SyncResult, ConflictInfo } from '../models/SyncResult';
import { SyncStatus } from '../models/SyncStatus';
import { NoteCard } from '../models/NoteCard';
import { SyncMeta } from '../models/SyncMeta';
import { IClock } from '../utils/Clock';
import { ISyncEngine } from './ISyncEngine';

/** 远端快照文件名（MVP：单文件全量 JSON）。 */
const DEFAULT_REMOTE_PATH = 'notes.json';

/**
 * 增量同步引擎（对齐架构文档 SyncEngine + 时序图 4.2 / 4.3）。
 *
 * 同步流程：
 * 1. 下载远端 notes.json 快照（不存在则视为空）。
 * 2. 取本地全部（含软删除）与远端快照。
 * 3. 逐条远端卡片调用 ConflictResolver 判定：
 *    - conflict：本地保留并置 Conflict；写远端冲突副本（新 id，前缀 [冲突副本]）。
 *    - remote-wins：采纳远端版本（拉取）。
 *    - local-wins / no-change：无需拉取。
 * 4. 统计 push（本地新增/变更、冲突副本等未存在于远端者）。
 * 5. 上传合并后的本地全量快照到远端。
 * 6. 本地 Pending 卡片标记为 Synced；更新 lastSyncCursor / lastSyncTime。
 * 7. 返回 SyncResult{pushed, pulled, conflicts, conflictsDetail, durationMs}。
 *
 * 软删除随快照传播；真冲突保留双版本且两份内容均不丢失。
 */
export class SyncEngine implements ISyncEngine {
  public constructor(
    private readonly repository: INoteRepository,
    private readonly stateStore: ISyncStateStore,
    private readonly webDav: IWebDavClient,
    private readonly resolver: ConflictResolver,
    private readonly clock: IClock,
    private readonly remotePath: string = DEFAULT_REMOTE_PATH,
  ) {}

  public async sync(): Promise<SyncResult> {
    const start = Date.now();
    const meta = this.stateStore.get();
    const cursor = meta.lastSyncCursor ?? null;

    const remoteRaw = await this.webDav.download(this.remotePath);
    const remoteNotes: NoteCard[] = remoteRaw ? this.deserialize(remoteRaw) : [];
    const remoteById = new Map(remoteNotes.map((n) => [n.id, n] as const));

    const localAll = this.repository.getAll(true);
    const localById = new Map(localAll.map((n) => [n.id, n] as const));

    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    const conflictsDetail: ConflictInfo[] = [];

    // 逐条处理远端卡片：冲突检测 + 拉取采纳
    for (const remote of remoteNotes) {
      const local = localById.get(remote.id) ?? null;
      const resolution = this.resolver.resolve(local, remote, cursor);

      if (resolution.outcome === 'conflict') {
        if (local) {
          this.repository.setSyncStatus(local.id, SyncStatus.Conflict);
        }
        const copy = resolution.conflictCopy!;
        this.repository.put(copy);
        conflicts += 1;
        conflictsDetail.push(resolution.conflictInfo!);
      } else if (resolution.outcome === 'remote-wins') {
        this.repository.put({ ...remote, status: SyncStatus.Synced });
        pulled += 1;
      }
      // local-wins / no-change：无需从远端拉取
    }

    // 统计 push：本地卡片中 status === Pending（本地变更）或不在远端（净新增 / 冲突副本）
    const currentLocal = this.repository.getAll(true);
    for (const local of currentLocal) {
      const inRemote = remoteById.has(local.id);
      if (local.status === SyncStatus.Pending || !inRemote) {
        pushed += 1;
      }
    }

    // 上传合并后的本地全量快照（含软删除，确保删除随同步传播）
    const merged = this.repository.getAll(true);
    await this.webDav.upload(this.remotePath, this.serialize(merged));

    // 本地 Pending 卡片标记为 Synced（冲突原件保持 Conflict，冲突副本保持 Synced）
    for (const local of merged) {
      if (local.status === SyncStatus.Pending) {
        this.repository.setSyncStatus(local.id, SyncStatus.Synced);
      }
    }

    // 推进同步水位线
    const now = this.clock.utcNow();
    const newMeta = new SyncMeta({
      serverBaseUrl: meta.serverBaseUrl,
      username: meta.username,
      lastSyncTime: now,
      lastSyncCursor: now,
    });
    this.stateStore.save(newMeta);

    return new SyncResult({
      pushed,
      pulled,
      conflicts,
      conflictsDetail,
      durationMs: Date.now() - start,
    });
  }

  private serialize(cards: NoteCard[]): string {
    return JSON.stringify(
      cards.map((c) => ({
        id: c.id,
        content: c.content,
        tags: c.tags,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        deleted: c.deleted,
        deviceId: c.deviceId ?? null,
        status: c.status,
        version: c.version,
        conflictOf: c.conflictOf ?? null,
      })),
    );
  }

  private deserialize(raw: string): NoteCard[] {
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    return arr.map((o) => ({
      id: String(o.id),
      content: String(o.content ?? ''),
      tags: Array.isArray(o.tags) ? (o.tags as string[]) : [],
      createdAt: new Date(String(o.createdAt)),
      updatedAt: new Date(String(o.updatedAt)),
      deleted: !!o.deleted,
      deviceId: (o.deviceId as string) ?? null,
      status: o.status as SyncStatus,
      version: typeof o.version === 'number' ? o.version : 1,
      conflictOf: (o.conflictOf as string) ?? null,
    }));
  }
}
