import { IWebDavClient } from './IWebDavClient';

/**
 * 真实 WebDAV HTTP 客户端（真机用）。
 *
 * 使用 fetch 实现 WebDAV 基础动词：
 * - GET：下载    - PUT：上传（覆盖写）  - DELETE：删除  - PROPFIND：列举
 *
 * 凭据采用 HTTP Basic Auth（由 ISecureStorage 在设备端加密保存，不在此明文落库）。
 * 注：本实现在本机不做端到端验证（需真实 WebDAV 服务器），仅作为真机落地脚手架，
 * 接口与 LocalFileWebDavClient 完全一致，同步引擎无需感知差异。
 */
export class HttpWebDavClient implements IWebDavClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly username?: string,
    private readonly password?: string,
  ) {}

  private authHeaders(): Record<string, string> {
    if (this.username && this.password) {
      const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    return {};
  }

  private buildUrl(path: string): string {
    const normalized = path.replace(/^\/+/, '');
    return `${this.baseUrl.replace(/\/+$/, '')}/${normalized}`;
  }

  public async exists(path: string): Promise<boolean> {
    const res = await fetch(this.buildUrl(path), {
      method: 'HEAD',
      headers: this.authHeaders(),
    });
    return res.ok;
  }

  public async download(path: string): Promise<string | null> {
    const res = await fetch(this.buildUrl(path), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`WebDAV GET failed: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  }

  public async upload(path: string, content: string): Promise<void> {
    const res = await fetch(this.buildUrl(path), {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`WebDAV PUT failed: ${res.status} ${res.statusText}`);
    }
  }

  public async delete(path: string): Promise<void> {
    const res = await fetch(this.buildUrl(path), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`WebDAV DELETE failed: ${res.status} ${res.statusText}`);
    }
  }

  public async list(prefix: string): Promise<string[]> {
    const url = `${this.buildUrl(prefix).replace(/\/?$/, '/')}`;
    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: { ...this.authHeaders(), Depth: '1' },
    });
    if (!res.ok) {
      throw new Error(`WebDAV PROPFIND failed: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    const hrefs = [...text.matchAll(/<href>([^<]+)<\/href>/gi)].map((m) => m[1]);
    return hrefs;
  }
}
