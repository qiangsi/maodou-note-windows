import { describe, it, expect } from 'vitest';
import { SqlJsNoteRepository } from '../src/core/storage/SqlJsNoteRepository';
import { SearchService } from '../src/core/services/SearchService';
import { MockClock } from './helpers';

describe('SearchService 全文搜索（基于 FTS5）', () => {
  async function setup() {
    const clock = new MockClock();
    const repo = await SqlJsNoteRepository.createInMemory(clock);
    const s1 = repo.create('今天读了毛豆笔记，收获很多', ['灵感', '阅读']);
    const s2 = repo.create('关于时间管理的读书方法总结', ['阅读']);
    const search = new SearchService(repo);
    return { repo, s1, s2, search };
  }

  it('search 命中 content（中文短语）', async () => {
    const { s1, s2, search } = await setup();
    const hit = search.search('毛豆笔记').map((c) => c.id);
    expect(hit).toEqual([s1.id]);

    const hit2 = search.search('时间管理').map((c) => c.id);
    expect(hit2).toEqual([s2.id]);
  });

  it('search 命中 tags 列', async () => {
    const { s1, s2, search } = await setup();
    const hit = search.search('灵感').map((c) => c.id);
    expect(hit).toEqual([s1.id]);
  });

  it('search 未命中返回空', async () => {
    const { search } = await setup();
    expect(search.search('不存在的关键词xyz').map((c) => c.id)).toEqual([]);
  });

  it('searchByTags 按标签筛选（AND 语义）', async () => {
    const { s1, s2, search } = await setup();
    expect(search.searchByTags(['阅读']).map((c) => c.id).sort()).toEqual(
      [s1.id, s2.id].sort(),
    );
    expect(search.searchByTags(['灵感', '阅读']).map((c) => c.id)).toEqual([s1.id]);
    expect(search.searchByTags(['灵感', '无此标签']).map((c) => c.id)).toEqual([]);
  });

  it('软删除卡片被搜索排除', async () => {
    const { repo, s1, search } = await setup();
    repo.softDelete(s1.id);
    expect(search.search('毛豆笔记').map((c) => c.id)).toEqual([]);
    expect(search.searchByTags(['灵感']).map((c) => c.id)).toEqual([]);
  });

  it('searchAll 组合关键字与标签', async () => {
    const { s1, search } = await setup();
    // 关键字命中 content，标签进一步筛选
    const hit = search.searchAll('毛豆', ['灵感']).map((c) => c.id);
    expect(hit).toEqual([s1.id]);
  });
});
