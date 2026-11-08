/**
 * 标签解析与规范化服务（对齐架构文档 TagService + 第7章约定）。
 *
 * 约定：
 * - 用户输入 "#标签"，解析后存储时不带 '#'。
 * - 规范化：去除首尾空白、折叠内部连续空白、去除前缀 '#'。
 * - 同一卡片内标签去重（大小写不敏感去重，但保留首次出现的大小写形式）。
 */
export class TagService {
  /** 从正文中解析所有 "#标签" 出现，返回规范化且去重后的标签列表。 */
  public static parseTags(content: string): string[] {
    const tags: string[] = [];
    if (!content) {
      return tags;
    }
    const seen = new Set<string>();
    const regex = /#([^\s#]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const normalized = TagService.normalize(match[1]);
      if (normalized.length === 0) {
        continue;
      }
      const key = normalized.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        tags.push(normalized);
      }
    }
    return tags;
  }

  /** 规范化单个标签：去首尾空白、去前缀 '#'、折叠内部空白。 */
  public static normalize(tag: string): string {
    if (!tag) {
      return '';
    }
    return tag
      .trim()
      .replace(/^#+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
