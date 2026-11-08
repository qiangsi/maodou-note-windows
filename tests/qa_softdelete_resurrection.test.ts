import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalFileWebDavClient } from '../src/core/sync/LocalFileWebDavClient';
import { MockClock, createDevice } from './helpers';

/**
 * 已知源码 Bug 的回归锁定测试（确认于独立验收 2026-11-08）。
 *
 * 现象：在「延迟同步窗口」场景下，软删除不能可靠传播到第三端，且可能被「复活」。
 * 根因：SyncEngine / ConflictResolver 的拉取判定仅依赖 `updatedAt > cursor`。
 *       若某设备在其 lastSyncCursor(T_d) 已大于某远端变更(updatedAt=T1) 时同步，
 *       且该变更在 T_d 时刻尚未到达远端（变更方延迟同步），则该变更对这台设备「永久不可见」。
 *
 * 修复建议（由工程师在源码层完成，QA 不修改产品代码）：
 *   在 ConflictResolver/SyncEngine 的拉取判定中，除 cursor 冲突检测外，
 *   增加「remote.updatedAt > local.updatedAt 时采纳远端（remote-wins）」的触发条件，
 *   使「远端比本地副本更新」的变更无论 cursor 如何都能被拉取。
 *
 * 当前用 it.fails 锁定：Bug 存在时这些断言会失败（it.fails 计为通过，套件保持全绿）；
 * 一旦工程师修复，这些用例将转为失败，提示需把 it.fails 改为普通 it。
 */
describe('QA 已知Bug：软删除跨设备延迟同步丢失/复活（回归锁定）', () => {
  let clock: MockClock;
  let remoteDir: string;
  let webDav: LocalFileWebDavClient;
  const BASE = new Date('2026-01-01T00:00:00.000Z');

  beforeEach(() => {
    clock = new MockClock(BASE);
    remoteDir = mkdtempSync(join(tmpdir(), 'maodou-bug-'));
    webDav = new LocalFileWebDavClient(remoteDir);
  });
  afterEach(() => rmSync(remoteDir, { recursive: true, force: true }));

  it.fails('REPRO-1 软删除应在延迟同步窗口后仍传播到第三端（期望 D.deleted=true）', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);
    const D = await createDevice(clock, webDav);

    const c = A.repository.create('待删除卡片', ['t']);
    clock.advance();
    await A.engine.sync();
    clock.advance();
    await B.engine.sync();
    clock.advance();
    await D.engine.sync();

    clock.advance();
    A.repository.softDelete(c.id); // A 软删但暂不同步
    clock.advance();
    await D.engine.sync(); // 窗口内同步，此时远端仍是旧版
    clock.advance();
    await A.engine.sync(); // A 推送软删
    clock.advance();
    await D.engine.sync(); // D 应拿到软删

    expect(D.repository.get(c.id)!.deleted).toBe(true);
  });

  it.fails('REPRO-2 软删除被遗漏后，第三端再次编辑推送导致复活（期望 A.deleted 不丢）', async () => {
    const A = await createDevice(clock, webDav);
    const B = await createDevice(clock, webDav);
    const D = await createDevice(clock, webDav);

    const c = A.repository.create('待删除卡片', ['t']);
    clock.advance();
    await A.engine.sync();
    clock.advance();
    await B.engine.sync();
    clock.advance();
    await D.engine.sync();

    clock.advance();
    A.repository.softDelete(c.id);
    clock.advance();
    await D.engine.sync(); // 窗口内同步，漏掉软删
    clock.advance();
    await A.engine.sync(); // A 推送软删
    clock.advance();
    await D.engine.sync(); // D 仍未拿到软删

    clock.advance();
    D.repository.update(c.id, 'D重新编辑', ['t']); // D 在「未删」视图上编辑
    clock.advance();
    await D.engine.sync(); // 把未删版本写回远端 -> 软删被覆盖
    clock.advance();
    await A.engine.sync(); // A 拉取 -> 软删复活

    expect(A.repository.get(c.id)!.deleted).toBe(true);
  });
});
