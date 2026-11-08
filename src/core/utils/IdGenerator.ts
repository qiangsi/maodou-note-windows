/**
 * 全局唯一标识生成器。
 *
 * 约定（见架构文档 第7章 共享知识）：
 * - id 是同步主键，一旦生成永不重新生成、永不回收。
 * - MVP 使用随机 UUID（v4）；P2 可平滑替换为 UUIDv7 以获得时间有序特性。
 */
export class IdGenerator {
  /**
   * 生成一个新的全局唯一 ID（UUID v4 字符串）。
   * 优先使用运行环境内置的 crypto.randomUUID（Node 19+ / 现代浏览器均支持）。
   */
  public static newId(): string {
    const g = globalThis as unknown as {
      crypto?: { randomUUID?: () => string };
    };
    if (g.crypto && typeof g.crypto.randomUUID === 'function') {
      return g.crypto.randomUUID();
    }
    // 兜底实现（极少触发）：RFC4122 v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
