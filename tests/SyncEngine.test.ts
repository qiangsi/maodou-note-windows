import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyncStatus } from '../src/core/models/SyncStatus';
import { LocalFileWebDavClient } from '../src/core/sync/LocalFileWebDavClient';
import { MockClock, createDevice } from './helpers';

describe('SyncEngine 增量同步 / 冲突 / 软删传播', () => {
  let clock: MockClock;
  let remoteDir: string;
  let webDav: LocalFileWebDavClient;

  const BASE = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    clock = new MockClock(BASE);
    remoteDir = mkdtempSync(join(tmpdir(), 'maodou-sync-'));
    webDav = new LocalFileWebDavClient(remoteDir);
  });

  afterEach(() => {
    rmSync(remoteDir, { recursive: true, force: true });
  });

  it('增量同步往返：A 建→B 拉；B 改→A 拉；cursor 正确推进并持久化', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);

    const c1 = A.repository.create('来自A的笔记', ['灵感']);

    clock.advance();
    const r1 = await A.engine.sync();
    expect(r1.pushed).toBe(1);
    expect(r1.pulled).toBe(0);
    expect(r1.conflicts).toBe(0);
    expect(A.repository.get(c1.id)!.status).toBe(SyncStatus.Synced);
    expect(A.stateStore.get().lastSyncCursor).toBeInstanceOf(Date);

    clock.advance();
    const r2 = await B.engine.sync();
    expect(r2.pulled).toBe(1);
    expect(B.repository.get(c1.id)!.content).toBe('来自A的笔记');
    expect(B.stateStore.get().lastSyncCursor).toBeInstanceOf(Date);

    clock.advance();
    B.repository.update(c1.id, 'B修改后的笔记', ['灵感', '阅读']);
    clock.advance();
    const r3 = await B.engine.sync();
    expect(r3.pushed).toBe(1);
    expect(r3.conflicts).toBe(0);

    clock.advance();
    const r4 = await A.engine.sync();
    expect(r4.pulled).toBe(1);
    expect(r4.conflicts).toBe(0);
    const pulled = A.repository.get(c1.id)!;
    expect(pulled.content).toBe('B修改后的笔记');
    expect(pulled.tags).toEqual(['灵感', '阅读']);
  });

  it('退化 last-write-wins：仅一端变更不产生冲突', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);

    const c = A.repository.create('初始', ['t']);
    clock.advance();
    await A.engine.sync();
    clock.advance();
    await B.engine.sync();

    // 仅 B 修改
    clock.advance();
    B.repository.update(c.id, '仅B修改', ['t']);
    clock.advance();
    const rb = await B.engine.sync();
    expect(rb.conflicts).toBe(0);
    expect(rb.pushed).toBe(1);

    clock.advance();
    const ra = await A.engine.sync();
    expect(ra.conflicts).toBe(0);
    expect(ra.pulled).toBe(1);
    expect(A.repository.get(c.id)!.content).toBe('仅B修改');
  });

  it('真冲突保留双版本：两端各改同 id，后同步方保留本地 + 远端副本，两份内容不丢', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);

    // 基线：A 建 → 双方同步到一致
    const c2 = A.repository.create('原始内容', ['t']);
    clock.advance();
    await A.engine.sync();
    clock.advance();
    await B.engine.sync();

    // 两端在 cursor 之后各自修改
    clock.advance();
    A.repository.update(c2.id, 'A端修改', ['t']);
    clock.advance();
    B.repository.update(c2.id, 'B端修改', ['t']);

    // 先同步的一方（A）本轮回退为 local-wins，无冲突
    clock.advance();
    const ra = await A.engine.sync();
    expect(ra.conflicts).toBe(0);

    // 后同步的一方（B）检测到真冲突
    clock.advance();
    const rb = await B.engine.sync();
    expect(rb.conflicts).toBe(1);
    expect(rb.conflictsDetail).toHaveLength(1);
    expect(rb.conflictsDetail[0].originalId).toBe(c2.id);

    // B 本地版本保留且标记 Conflict
    const bLocal = B.repository.get(c2.id)!;
    expect(bLocal.content).toBe('B端修改');
    expect(bLocal.status).toBe(SyncStatus.Conflict);

    // B 拥有一份冲突副本：引用原 id，内容包含 A 端修改并带前缀
    const copies = B.repository.getAll(true).filter((c) => c.conflictOf === c2.id);
    expect(copies).toHaveLength(1);
    expect(copies[0].content.startsWith('[冲突副本]')).toBe(true);
    expect(copies[0].content).toContain('A端修改');

    // A 端内容不丢失
    expect(A.repository.get(c2.id)!.content).toBe('A端修改');
  });

  it('软删除随同步传播：A 软删 → B 拉取后默认视图隐藏', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);

    const c3 = A.repository.create('待删除', ['t']);
    clock.advance();
    await A.engine.sync();
    clock.advance();
    await B.engine.sync();
    expect(B.repository.get(c3.id)).not.toBeNull();

    // 推进时钟，确保软删除的 updatedAt 严格晚于 B 上次同步的 cursor（增量语义要求 > cursor）
    clock.advance();
    A.repository.softDelete(c3.id);
    clock.advance();
    const ra = await A.engine.sync();
    expect(ra.pushed).toBeGreaterThanOrEqual(1);
    clock.advance();
    const rb = await B.engine.sync();
    expect(rb.pulled).toBeGreaterThanOrEqual(1);

    // B 的卡片已软删，常规视图隐藏但仍可物理读取
    expect(B.repository.get(c3.id)!.deleted).toBe(true);
    expect(B.repository.getAll().map((c) => c.id)).not.toContain(c3.id);
  });

  it('SyncMeta 持久化：多次同步后 cursor 单调递增', async () => {
    const A = await createDevice(clock, webDav);
    A.repository.create('卡片1', []);
    clock.advance();
    await A.engine.sync();
    const c1 = A.stateStore.get().lastSyncCursor!;
    expect(c1).toBeInstanceOf(Date);

    clock.advance();
    A.repository.create('卡片2', []);
    clock.advance();
    await A.engine.sync();
    const c2 = A.stateStore.get().lastSyncCursor!;
    expect(c2.getTime()).toBeGreaterThan(c1.getTime());
  });
});
