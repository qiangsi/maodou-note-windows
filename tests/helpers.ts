import { IClock } from '../src/core/utils/Clock';
import { SqlJsNoteRepository } from '../src/core/storage/SqlJsNoteRepository';
import { SqlJsSyncStateStore } from '../src/core/storage/SqlJsSyncStateStore';
import { LocalFileWebDavClient } from '../src/core/sync/LocalFileWebDavClient';
import { SyncEngine } from '../src/core/sync/SyncEngine';
import { ConflictResolver } from '../src/core/sync/ConflictResolver';

/**
 * 可注入的可控时钟：测试中以固定步长推进时间，确保 updatedAt / cursor 比较确定。
 */
export class MockClock implements IClock {
  private now: Date;

  public constructor(initial?: Date) {
    this.now = initial ?? new Date('2026-01-01T00:00:00.000Z');
  }

  public utcNow(): Date {
    return new Date(this.now);
  }

  public set(date: Date): void {
    this.now = new Date(date);
  }

  public advance(ms = 1000): void {
    this.now = new Date(this.now.getTime() + ms);
  }
}

/** 单台"设备"的运行时组合：仓储 + 状态存储 + 引擎（共享远端 WebDAV）。 */
export interface DeviceBundle {
  repository: SqlJsNoteRepository;
  stateStore: SqlJsSyncStateStore;
  engine: SyncEngine;
  clock: IClock;
}

/**
 * 创建一台设备的核心组合。所有设备共享同一个 clock（代表同一面"墙钟"）与同一个
 * webDav（代表同一"远端"目录），从而模拟双端同步。每台设备有独立的本地库。
 */
export async function createDevice(
  clock: IClock,
  webDav: LocalFileWebDavClient,
  deviceId?: string,
): Promise<DeviceBundle> {
  const repository = await SqlJsNoteRepository.createInMemory(clock);
  const stateStore = new SqlJsSyncStateStore(repository.database);
  const resolver = new ConflictResolver();
  const engine = new SyncEngine(repository, stateStore, webDav, resolver, clock);
  if (deviceId) {
    // 仅用于测试可观测性：把 deviceId 写回不影响逻辑
    void deviceId;
  }
  return { repository, stateStore, engine, clock };
}
