import { describe, it, expect } from 'vitest';
import { SqlJsNoteRepository } from '../src/core/storage/SqlJsNoteRepository';
import { SyncStatus } from '../src/core/models/SyncStatus';
import { MockClock } from './helpers';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('SqlJsNoteRepository 离线 CRUD', () => {
  it('新建生成 id / UTC 时间 / Pending 状态', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const card = repo.create('第一条笔记', ['灵感']);

    expect(card.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(card.createdAt.getTime()).toBe(clock.utcNow().getTime());
    expect(card.updatedAt.getTime()).toBe(clock.utcNow().getTime());
    expect(card.deleted).toBe(false);
    expect(card.status).toBe(SyncStatus.Pending);
    expect(card.version).toBe(1);
    expect(card.tags).toEqual(['灵感']);

    const fetched = repo.get(card.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.content).toBe('第一条笔记');
  });

  it('更新刷新 updatedAt、version、置 Pending，createdAt 不变', async () => {
    const clock = new MockClock(new Date('2026-01-01T00:00:00.000Z'));
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const card = repo.create('原文', ['a']);
    const createdAt = card.createdAt;

    clock.advance(5000);
    const updated = repo.update(card.id, '改后', ['a', 'b']);
    expect(updated.content).toBe('改后');
    expect(updated.tags).toEqual(['a', 'b']);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(updated.createdAt.getTime()).toBe(createdAt.getTime());
    expect(updated.version).toBe(2);
    expect(updated.status).toBe(SyncStatus.Pending);
  });

  it('软删除标记 deleted 且默认排除', async () => {
    const clock = new MockClock();
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const a = repo.create('A', []);
    const b = repo.create('B', []);

    repo.softDelete(a.id);
    expect(repo.get(a.id)!.deleted).toBe(true);
    expect(repo.get(a.id)!.status).toBe(SyncStatus.Pending);

    const all = repo.getAll();
    expect(all.map((c) => c.id)).toEqual([b.id]);

    const allIncludingDeleted = repo.getAll(true);
    expect(allIncludingDeleted.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('getPending 仅返回 Pending 卡片', async () => {
    const clock = new MockClock();
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const pending = repo.create('待同步', []);
    const synced = repo.create('已同步', []);
    repo.setSyncStatus(synced.id, SyncStatus.Synced);

    const pendingIds = repo.getPending().map((c) => c.id);
    expect(pendingIds).toEqual([pending.id]);
  });

  it('query 按标签筛选（AND 语义）并排除软删除', async () => {
    const clock = new MockClock();
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const both = repo.create('同时两个标签', ['灵感', '阅读']);
    const one = repo.create('只有一个', ['灵感']);

    const byInspiration = repo.query(null, ['灵感']);
    expect(byInspiration.map((c) => c.id).sort()).toEqual([both.id, one.id].sort());

    const byBoth = repo.query(null, ['灵感', '阅读']);
    expect(byBoth.map((c) => c.id)).toEqual([both.id]);

    repo.softDelete(both.id);
    const afterDelete = repo.query(null, ['灵感']);
    expect(afterDelete.map((c) => c.id)).toEqual([one.id]);
  });

  it('query 全文检索命中 content（FTS5 trigram，>=3 字符）与短词（LIKE 回落）', async () => {
    const clock = new MockClock();
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const c = repo.create('今天读了毛豆笔记，收获很多', ['灵感']);
    const d = repo.create('另一张卡片，关于读书方法', ['阅读']);
    // c 软删除后不应再被检索
    repo.softDelete(c.id);

    // '毛豆笔记' 仅存在于已软删的 c → 空
    expect(repo.query('毛豆笔记').map((x) => x.id)).toEqual([]);

    // '读书方法' 命中 d 的 content（FTS5 trigram）
    expect(repo.query('读书方法').map((x) => x.id)).toEqual([d.id]);

    // 2 字符短词回落 LIKE，命中 content 子串 '卡片'
    expect(repo.query('卡片').map((x) => x.id)).toEqual([d.id]);

    // 标签也可被全文检索命中（tags 列参与 FTS）：'阅读' 命中 d 的标签
    expect(repo.query('阅读').map((x) => x.id)).toEqual([d.id]);
  });

  it('文件持久化：关闭后重新打开可读取数据', async () => {
    const clock = new MockClock();
    const file = join(tmpdir(), `maodou-repo-${Date.now()}.db`);
    const repo = await SqlJsNoteRepository.createFromFile(file, clock);
    const card = repo.create('持久化测试', ['灵感']);
    repo.setSyncStatus(card.id, SyncStatus.Synced);
    repo.close();

    const reopened = await SqlJsNoteRepository.createFromFile(file, clock);
    const loaded = reopened.get(card.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.content).toBe('持久化测试');
    expect(loaded!.status).toBe(SyncStatus.Synced);
    reopened.close();
  });
});
