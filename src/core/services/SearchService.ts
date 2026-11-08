import { INoteRepository } from '../storage/INoteRepository';
import { NoteCard } from '../models/NoteCard';

/**
 * 全文搜索服务（对齐架构文档 SearchService）。
 * 基于仓储的 FTS5 查询封装，默认排除软删除卡片。
 */
export class SearchService {
  public constructor(private readonly repository: INoteRepository) {}

  /** 全文关键字检索（命中 content 或 tags）。 */
  public search(query: string): NoteCard[] {
    return this.repository.query(query, null);
  }

  /** 按标签筛选（AND 语义：需同时包含全部给定标签）。 */
  public searchByTags(tags: string[]): NoteCard[] {
    return this.repository.query(null, tags);
  }

  /** 组合检索：关键字 + 标签筛选。 */
  public searchAll(query: string, tags: string[]): NoteCard[] {
    return this.repository.query(query, tags);
  }
}
