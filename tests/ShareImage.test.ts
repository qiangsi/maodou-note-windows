import { describe, it, expect } from 'vitest';
import { NoteCard } from '../src/core/models/NoteCard';
import { SyncStatus } from '../src/core/models/SyncStatus';
import {
  generateShareSvg,
  listTemplates,
  getTemplate,
  DEFAULT_WATERMARK_ZH,
  DEFAULT_WATERMARK_EN,
} from '../src/core/share';

function makeNote(overrides: Partial<NoteCard> = {}): NoteCard {
  return {
    id: 'note-1',
    content:
      '今天想清楚了一件事：#写作 不是为了发表，而是为了把模糊的想法逼出形状。\n第二行：持续积累。',
    tags: ['写作', '思考', 'daily'],
    createdAt: new Date(Date.UTC(2026, 10, 8, 14, 30)),
    updatedAt: new Date(Date.UTC(2026, 10, 8, 14, 30)),
    deleted: false,
    status: SyncStatus.Synced,
    version: 1,
    conflictOf: null,
    ...overrides,
  };
}

describe('分享长图 - 模板', () => {
  it('listTemplates 返回 paper/minimal/dark 三个模板', () => {
    const list = listTemplates();
    expect(list.map((t) => t.id)).toEqual(['paper', 'minimal', 'dark']);
    expect(list[0].name).toBeTruthy();
  });

  it('getTemplate 找不到时回退到 paper', () => {
    expect(getTemplate('nope').id).toBe('paper');
    expect(getTemplate('dark').id).toBe('dark');
  });
});

describe('分享长图 - 默认(纸感)渲染', () => {
  const svg = generateShareSvg(makeNote());

  it('包含右下角水印中英文', () => {
    expect(svg).toContain(DEFAULT_WATERMARK_ZH); // 毛豆笔记
    expect(svg).toContain(DEFAULT_WATERMARK_EN); // Maodou-Memo
    // 水印位于右下角：text-anchor="end"
    expect(svg).toContain('text-anchor="end"');
  });

  it('包含正文与格式化的 UTC 日期', () => {
    expect(svg).toContain('今天想清楚了一件事');
    expect(svg).toContain('2026-11-08 14:30');
  });

  it('标签以 # 前缀渲染为 chip', () => {
    expect(svg).toContain('#写作');
    expect(svg).toContain('#思考');
    expect(svg).toContain('#daily');
  });

  it('画布宽度为 1080', () => {
    expect(svg).toContain('width="1080"');
  });
});

describe('分享长图 - 安全与健壮性', () => {
  it('正文含 HTML 时被转义，不出现原始标签', () => {
    const svg = generateShareSvg(
      makeNote({ content: '危险内容 <script>alert(1)</script> & "引号"' }),
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;');
  });

  it('空正文 / 空标签不崩溃', () => {
    const svg = generateShareSvg(makeNote({ content: '', tags: [] }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('超长连续中文会断行而非溢出', () => {
    const longText = '豆'.repeat(200);
    const svg = generateShareSvg(makeNote({ content: longText }));
    // 应生成多个 tspan（折行）
    const tspanCount = (svg.match(/<tspan/g) ?? []).length;
    expect(tspanCount).toBeGreaterThan(1);
  });
});

describe('分享长图 - 模板差异', () => {
  it('dark 使用渐变背景', () => {
    const svg = generateShareSvg(makeNote(), { templateId: 'dark' });
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('url(#bgGrad)');
  });

  it('minimal 不绘制卡片阴影', () => {
    const svg = generateShareSvg(makeNote(), { templateId: 'minimal' });
    expect(svg).not.toContain('cardShadow');
  });

  it('可自定义水印文案', () => {
    const svg = generateShareSvg(makeNote(), {
      watermarkZh: '自定义中文',
      watermarkEn: 'CustomEN',
    });
    expect(svg).toContain('自定义中文');
    expect(svg).toContain('CustomEN');
  });
});
