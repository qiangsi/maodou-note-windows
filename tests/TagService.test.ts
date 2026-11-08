import { describe, it, expect } from 'vitest';
import { TagService } from '../src/core/services/TagService';

describe('TagService 标签解析与规范化', () => {
  it('从正文解析多个 #标签（去 # 存储）', () => {
    expect(TagService.parseTags('#灵感 #阅读')).toEqual(['灵感', '阅读']);
  });

  it('在正文中混排提取标签', () => {
    expect(TagService.parseTags('今天#灵感 随手记一条#阅读')).toEqual(['灵感', '阅读']);
  });

  it('连续 # 也能正确切分', () => {
    expect(TagService.parseTags('#灵感#阅读')).toEqual(['灵感', '阅读']);
  });

  it('同卡片内标签去重（大小写不敏感，保留首次大小写）', () => {
    expect(TagService.parseTags('#灵感 #灵感 #阅读')).toEqual(['灵感', '阅读']);
    expect(TagService.parseTags('#Idea #idea')).toEqual(['Idea']);
  });

  it('无标签时返回空数组', () => {
    expect(TagService.parseTags('今天随手记一条')).toEqual([]);
    expect(TagService.parseTags('')).toEqual([]);
  });

  it('normalize 去除前缀 # 并折叠内部空白与首尾空白', () => {
    expect(TagService.normalize('#阅读')).toBe('阅读');
    expect(TagService.normalize('  #Hello   World ')).toBe('Hello World');
    expect(TagService.normalize('A#B')).toBe('A#B');
    expect(TagService.normalize('')).toBe('');
  });
});
