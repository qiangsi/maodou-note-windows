/**
 * 时间源抽象。所有时间戳统一使用 UTC。
 * 通过可注入的 IClock 提供，便于单元测试中精确控制时间（避免依赖系统时钟）。
 */
export interface IClock {
  /** 返回当前 UTC 时间。 */
  utcNow(): Date;
}

/**
 * 系统时钟实现：直接返回 new Date()（即运行环境本地时区的 UTC 瞬时值）。
 * 注意：Date 内部以 UTC 毫秒存储，toISOString() 输出即为 UTC。
 */
export class SystemClock implements IClock {
  public utcNow(): Date {
    return new Date();
  }
}
