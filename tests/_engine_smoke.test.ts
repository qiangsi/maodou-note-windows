import { describe, it, expect } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

describe('sqlite-wasm engine smoke (vitest resolution)', () => {
  it('initializes, creates FTS5 trigram table, and queries', async () => {
    const sqlite3 = await sqlite3InitModule();
    const db = new sqlite3.oo1.DB(':memory:');
    db.exec(
      "CREATE VIRTUAL TABLE t USING fts5(id UNINDEXED, content, tags, tokenize='trigram');",
    );
    db.exec({
      sql: 'INSERT INTO t(id, content, tags) VALUES (?, ?, ?)',
      bind: ['1', '今天读了毛豆笔记', '灵感 阅读'],
    });
    const stmt = db.prepare('SELECT DISTINCT id FROM t WHERE t MATCH ?');
    stmt.bind(['"毛豆笔记"']);
    let hit: unknown = null;
    while (stmt.step()) {
      hit = stmt.get([]);
    }
    stmt.finalize();
    expect(hit).toEqual(['1']);
  });
});
