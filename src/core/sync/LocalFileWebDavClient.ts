import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { IWebDavClient } from './IWebDavClient';

/**
 * 基于本地文件系统的 WebDAV 模拟实现（测试 / 单机模式用）。
 * 把一个本地临时目录当成"远端 WebDAV 根"，文件即远端对象。
 */
export class LocalFileWebDavClient implements IWebDavClient {
  public constructor(private readonly rootDir: string) {
    if (!existsSync(rootDir)) {
      mkdirSync(rootDir, { recursive: true });
    }
  }

  private resolvePath(path: string): string {
    const normalized = path.replace(/^\/+/, '');
    return join(this.rootDir, normalized);
  }

  public async exists(path: string): Promise<boolean> {
    return existsSync(this.resolvePath(path));
  }

  public async download(path: string): Promise<string | null> {
    const filePath = this.resolvePath(path);
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, 'utf-8');
  }

  public async upload(path: string, content: string): Promise<void> {
    const filePath = this.resolvePath(path);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
  }

  public async delete(path: string): Promise<void> {
    const filePath = this.resolvePath(path);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  public async list(prefix: string): Promise<string[]> {
    const dir = this.resolvePath(prefix);
    if (!existsSync(dir)) {
      return [];
    }
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name);
      if (statSync(filePath).isFile()) {
        out.push(`${prefix.replace(/\/+$/, '')}/${name}`.replace(/\\/g, '/'));
      }
    }
    return out;
  }
}
