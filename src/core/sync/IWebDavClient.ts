/**
 * WebDAV 客户端抽象（对齐架构文档 IWebDavClient）。
 *
 * 关键抽象：把"远端"差异屏蔽掉。测试与单机模式用 LocalFileWebDavClient
 * （本地目录模拟），真机用 HttpWebDavClient（WebDAV 协议）。
 * 同步引擎只依赖本接口，因此无需真实 WebDAV 服务器即可验证双端同步。
 */
export interface IWebDavClient {
  /** 远端路径是否存在。 */
  exists(path: string): Promise<boolean>;

  /** 下载文件内容为字符串；不存在时返回 null。 */
  download(path: string): Promise<string | null>;

  /** 上传（覆盖写）文件内容。 */
  upload(path: string, content: string): Promise<void>;

  /** 删除远端文件。 */
  delete(path: string): Promise<void>;

  /** 列举某目录/前缀下的文件列表（返回完整路径）。 */
  list(prefix: string): Promise<string[]>;
}
