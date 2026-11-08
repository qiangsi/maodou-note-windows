import { describe, it, expect } from 'vitest';
import { ConflictResolver } from '../src/core/sync/ConflictResolver';
import { NoteCard } from '../src/core/models/NoteCard';
import { SyncStatus } from '../src/core/models/SyncStatus';

function makeCard(id: string, updatedAt: Date, content = 'c', tags: string[] = []): NoteCard {
  return {
    id,
    content,
    tags,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt,
    deleted: false,
    deviceId: null,
    status: SyncStatus.Synced,
    version: 1,
    conflictOf: null,
  };
}

const RESOLVER = new ConflictResolver();

describe('ConflictResolver 冲突判定', () => {
  const cursor = new Date('2026-06-01T00:00:00.000Z');
  const before = new Date('2026-05-01T00:00:00.000Z'); // <= cursor
  const after = new Date('2026-07-01T00:00:00.000Z'); //  > cursor

  it('两端都未变更（均 <= cursor）→ 无变化', () => {
    const local = makeCard('x', before);
    const remote = makeCard('x', before, 'remote');
    expect(RESOLVER.resolve(local, remote, cursor).outcome).toBe('no-change');
  });

  it('仅本地变更（local > cursor, remote <= cursor）→ local-wins', () => {
    const local = makeCard('x', after, 'local');
    const remote = makeCard('x', before, 'remote');
    const r = RESOLVER.resolve(local, remote, cursor);
    expect(r.outcome).toBe('local-wins');
    expect(r.conflictCopy).toBeUndefined();
  });

  it('仅远端变更（remote > cursor, local <= cursor）→ remote-wins', () => {
    const local = makeCard('x', before, 'local');
    const remote = makeCard('x', after, 'remote');
    const r = RESOLVER.resolve(local, remote, cursor);
    expect(r.outcome).toBe('remote-wins');
    expect(r.conflictCopy).toBeUndefined();
  });

  it('两端都变更（均 > cursor）→ 真冲突，生成冲突副本', () => {
    const local = makeCard('x', after, 'local');
    const remote = makeCard('x', after, 'remote-content', ['t']);
    const r = RESOLVER.resolve(local, remote, cursor);
    expect(r.outcome).toBe('conflict');
    expect(r.conflictInfo).toBeDefined();
    expect(r.conflictInfo!.originalId).toBe('x');
    const copy = r.conflictCopy!;
    expect(copy.id).not.toBe('x');
    expect(copy.content).toBe('[冲突副本] remote-content');
    expect(copy.conflictOf).toBe('x');
    expect(copy.tags).toEqual(['t']);
    expect(copy.status).toBe(SyncStatus.Synced);
  });

  it('首次同步（cursor=null）：本地存在即视为双端变更 → 冲突', () => {
    const local = makeCard('x', after, 'local');
    const remote = makeCard('x', after, 'remote');
    const r = RESOLVER.resolve(local, remote, null);
    expect(r.outcome).toBe('conflict');
    expect(r.conflictCopy!.conflictOf).toBe('x');
  });

  it('首次同步（cursor=null）：本地不存在远端卡片 → remote-wins（拉取新卡）', () => {
    const remote = makeCard('y', after, 'remote');
    const r = RESOLVER.resolve(null, remote, null);
    expect(r.outcome).toBe('remote-wins');
  });
});
