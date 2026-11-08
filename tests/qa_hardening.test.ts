import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyncStatus } from '../src/core/models/SyncStatus';
import { LocalFileWebDavClient } from '../src/core/sync/LocalFileWebDavClient';
import { MockClock, createDevice } from './helpers';
import { SqlJsNoteRepository } from '../src/core/storage/SqlJsNoteRepository';
import { TagService } from '../src/core/services/TagService';

/**
 * 加固测试：覆盖 PRD/架构要求的边界与稳健性场景。
 * 这些用例在「当前源码」下应当全部通过，用于验证常规路径的健壮性。
 */
describe('QA 加固：边界与稳健性', () => {
  it('空内容卡片：可创建、可被检索排除为正常', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const empty = repo.create('', []);
    expect(empty.content).toBe('');
    expect(empty.status).toBe(SyncStatus.Pending);
    expect(repo.get(empty.id)!.content).toBe('');
    // 空串查询不应抛错，返回全部（非软删）
    expect(repo.query('').map((c) => c.id)).toEqual([empty.id]);
  });

  it('超长内容（50k 字符）：存储与 FTS 检索均正常', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const long = '毛豆'.repeat(25000); // 50k 字符
    const marker = '独特检索词XYZ998';
    const card = repo.create(`${long} ${marker}`, ['长文本']);
    expect(repo.get(card.id)!.content).toBe(`${long} ${marker}`);
    // FTS 命中长文中的唯一子串（>=3 字符）
    expect(repo.query('独特检索词XYZ998').map((c) => c.id)).toEqual([card.id]);
  });

  it('中文 + emoji 标签与正文：FTS 中文命中、标签精确筛选、emoji 经 LIKE 命中', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const card = repo.create('火箭发射成功 🚀 灵感来了', ['📌灵感', '阅读']);
    // 中文 FTS（4 字符短语）
    expect(repo.query('火箭发射成功').map((c) => c.id)).toEqual([card.id]);
    // emoji 标签精确筛选（tags_text LIKE）
    expect(repo.query(null, ['📌灵感']).map((c) => c.id)).toEqual([card.id]);
    // 正文 emoji 经 LIKE（短查询）命中
    expect(repo.query('🚀').map((c) => c.id)).toEqual([card.id]);
    // 多标签 AND 筛选
    expect(repo.query(null, ['📌灵感', '阅读']).map((c) => c.id)).toEqual([card.id]);
  });

  it('标签去重与空白折叠（端到端：经 TagService.parseTags 后入库再查询）', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const raw = '#灵感 #阅读  #灵感   #  阅读  #IDEA #idea';
    const tags = TagService.parseTags(raw);
    expect(tags).toEqual(['灵感', '阅读', 'IDEA']); // 大小写不敏感去重、空白折叠
    const card = repo.create('正文', tags);
    expect(repo.get(card.id)!.tags).toEqual(['灵感', '阅读', 'IDEA']);
    // 折叠后的标签可精确检索
    expect(repo.query(null, ['阅读']).map((c) => c.id)).toEqual([card.id]);
    expect(repo.query(null, ['IDEA']).map((c) => c.id)).toEqual([card.id]);
  });

  it('未配置 WebDAV 时 sync 的异常路径：空目录作为远端，sync 应正常完成（首次全量）', async () => {
    // 注意：本实现没有「未配置即报错」的硬失败（远端用空快照），但应保证不抛错且结果一致。
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const remoteDir = mkdtempSync(join(tmpdir(), 'maodou-nocfg-'));
    try {
      const webDav = new LocalFileWebDavClient(remoteDir);
      const A = await createDevice(clock, webDav);
      A.repository.create('离线笔记', ['灵感']);
      clock.advance();
      const r = await A.engine.sync();
      expect(r.pushed).toBe(1);
      expect(r.conflicts).toBe(0);
      expect(A.stateStore.get().lastSyncCursor).toBeInstanceOf(Date);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it('移动端持久化路径：exportBytes → importBytes 重建后数据可恢复', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const card = repo.create('跨进程恢复', ['灵感', '阅读']);
    repo.setSyncStatus(card.id, SyncStatus.Synced);
    const bytes = repo.exportBytes();

    const reopened = await SqlJsNoteRepository.importBytes(bytes, clock);
    const loaded = reopened.get(card.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.content).toBe('跨进程恢复');
    expect(loaded!.tags).toEqual(['灵感', '阅读']);
    expect(loaded!.status).toBe(SyncStatus.Synced);
  });

  it('幂等同步：连续两次 sync，第二次 pulled/pushed 应为 0 且不产生重复卡片', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const remoteDir = mkdtempSync(join(tmpdir(), 'maodou-idem-'));
    try {
      const webDav = new LocalFileWebDavClient(remoteDir);
      const A = await createDevice(clock, webDav);
      const B = await createDevice(clock, webDav);
      const c = A.repository.create('幂等测试', ['t']);
      clock.advance();
      await A.engine.sync();
      clock.advance();
      const r1 = await B.engine.sync();
      expect(r1.pulled).toBe(1);
      expect(B.repository.getAll().map((x) => x.id)).toEqual([c.id]);

      clock.advance();
      const r2 = await B.engine.sync(); // 第二次，不应再拉取
      expect(r2.pulled).toBe(0);
      expect(r2.pushed).toBe(0);
      expect(B.repository.getAll().map((x) => x.id)).toEqual([c.id]); // 无重复
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it('真冲突（引擎级）：本地保留原卡(status=conflict) + 远端副本(prefix+conflictOf) + 两份内容均不丢', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const remoteDir = mkdtempSync(join(tmpdir(), 'maodou-conf-'));
    try {
      const webDav = new LocalFileWebDavClient(remoteDir);
      const A = await createDevice(clock, webDav);
      const B = await createDevice(clock, webDav);
      const c = A.repository.create('原始内容', ['t']);
      clock.advance();
      await A.engine.sync();
      clock.advance();
      await B.engine.sync();

      clock.advance();
      A.repository.update(c.id, 'A端内容AAA', ['t']);
      clock.advance();
      B.repository.update(c.id, 'B端内容BBB', ['t']);
      clock.advance();
      await A.engine.sync(); // A 先同步，本轮回退 local-wins
      clock.advance();
      const rb = await B.engine.sync(); // B 检测到真冲突
      expect(rb.conflicts).toBe(1);

      const bLocal = B.repository.get(c.id)!;
      expect(bLocal.content).toBe('B端内容BBB');
      expect(bLocal.status).toBe(SyncStatus.Conflict);

      const copies = B.repository.getAll(true).filter((x) => x.conflictOf === c.id);
      expect(copies).toHaveLength(1);
      expect(copies[0].content.startsWith('[冲突副本]')).toBe(true);
      expect(copies[0].content).toContain('A端内容AAA');
      expect(copies[0].conflictOf).toBe(c.id);

      // A 端原内容不丢失
      expect(A.repository.get(c.id)!.content).toBe('A端内容AAA');
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  it('三端其一修改：无冲突且正确传播到其余两端', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const remoteDir = mkdtempSync(join(tmpdir(), 'maodou-3dev-'));
    try {
      const webDav = new LocalFileWebDavClient(remoteDir);
      const A = await createDevice(clock, webDav);
      const B = await createDevice(clock, webDav);
      const D = await createDevice(clock, webDav);
      const c = A.repository.create('基线', ['t']);
      clock.advance();
      await A.engine.sync();
      clock.advance();
      await B.engine.sync();
      clock.advance();
      await D.engine.sync();

      clock.advance();
      A.repository.update(c.id, '仅A修改', ['t']);
      clock.advance();
      await A.engine.sync();
      clock.advance();
      await B.engine.sync();
      clock.advance();
      await D.engine.sync();

      for (const dev of [A, B, D]) {
        expect(dev.repository.get(c.id)!.content).toBe('仅A修改');
      }
      expect(A.repository.get(c.id)!.status).toBe(SyncStatus.Synced);
      expect(B.repository.get(c.id)!.status).toBe(SyncStatus.Synced);
      expect(D.repository.get(c.id)!.status).toBe(SyncStatus.Synced);
    } finally {
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });
});
