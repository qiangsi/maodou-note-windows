import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqlJsNoteRepository } from '../src/core/storage/SqlJsNoteRepository';
import { SqlJsSyncStateStore } from '../src/core/storage/SqlJsSyncStateStore';
import { SyncMeta } from '../src/core/models/SyncMeta';
import { MockClock } from './helpers';

describe('SqlJsSyncStateStore 持久化', () => {
  it('SyncMeta 在文件库重建后仍能正确读取', async () => {
    const clock = new MockClock();
    const dir = mkdtempSync(join(tmpdir(), 'maodou-metastore-'));

    try {
      const file = join(dir, 'meta.db');
      const repo = await SqlJsNoteRepository.createFromFile(file, clock);
      const store = new SqlJsSyncStateStore(repo.database);

      const cursor = new Date('2026-03-04T05:06:07.000Z');
      store.save(
        new SyncMeta({
          serverBaseUrl: 'https://dav.example.com',
          username: 'maodou',
          lastSyncTime: cursor,
          lastSyncCursor: cursor,
        }),
      );
      repo.close();

      // 重新打开同一文件库
      const repo2 = await SqlJsNoteRepository.createFromFile(file, clock);
      const store2 = new SqlJsSyncStateStore(repo2.database);
      const loaded = store2.get();

      expect(loaded.serverBaseUrl).toBe('https://dav.example.com');
      expect(loaded.username).toBe('maodou');
      expect(loaded.lastSyncTime!.getTime()).toBe(cursor.getTime());
      expect(loaded.lastSyncCursor!.getTime()).toBe(cursor.getTime());
      repo2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('默认值：未保存时返回空 SyncMeta', async () => {
    const clock = new MockClock();
    const dir = mkdtempSync(join(tmpdir(), 'maodou-metastore-'));
    try {
      const file = join(dir, 'empty.db');
      const repo = await SqlJsNoteRepository.createFromFile(file, clock);
      const store = new SqlJsSyncStateStore(repo.database);
      const meta = store.get();
      expect(meta.serverBaseUrl).toBe('');
      expect(meta.username).toBeNull();
      expect(meta.lastSyncCursor).toBeNull();
      repo.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
