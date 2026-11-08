/**
 * 分享长图渲染器：把单条 NoteCard 渲染为一张竖版长图（SVG 矢量）。
 *
 * 设计要点（对齐用户需求）：
 * - 单条笔记 → 一张长图：正文 + #标签 chips + 创建时间。
 * - 右下角固定水印：「毛豆笔记」(中文) + 「Maodou-Note」(英文)，小字、低透明度。
 * - 输出 SVG（宽度固定，高度按内容自适应），便于两端 WebView 直接栅格化为 PNG。
 * - 内容做 XML 转义，杜绝注入；中文/英文/emoji 混排按近似字宽自动换行。
 */

import { NoteCard } from '../models/NoteCard';
import { ShareTemplate, getTemplate } from './templates';

/** 水印默认文案（可被 options 覆盖）。 */
export const DEFAULT_WATERMARK_ZH = '毛豆笔记';
export const DEFAULT_WATERMARK_EN = 'Maodou-Note';

export interface ShareImageOptions {
  /** 水印中文文案，默认「毛豆笔记」。 */
  watermarkZh?: string;
  /** 水印英文文案，默认「Maodou-Note」。 */
  watermarkEn?: string;
  /** 模板 id，默认 paper。 */
  templateId?: string;
}

/** XML / SVG 文本转义，防止内容注入破坏结构。 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 单字符近似宽度（px）：CJK/全角按 1em，拉丁按 0.55em，标点更窄。 */
function charWidth(ch: string, fs: number): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x2e7f) {
    if (ch === ' ' || ch === '　') return fs * 0.32;
    if (/[A-Z]/.test(ch)) return fs * 0.62;
    if (/[a-z0-9]/.test(ch)) return fs * 0.55;
    if (/[.,;:!?'"()\-/]/.test(ch)) return fs * 0.32;
    return fs * 0.55;
  }
  if (code >= 0x3000 && code <= 0x303f) return fs; // CJK 标点
  if (code >= 0x3040 && code <= 0x30ff) return fs; // 假名
  if (code >= 0x4e00 && code <= 0x9fff) return fs; // 汉字
  if (code >= 0xff00 && code <= 0xffef) return fs; // 全角
  return fs * 0.6;
}

/** 估算一段文本的宽度（px）。 */
function measureWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, fs);
  return w;
}

/** 按最大宽度折行（处理显式换行 + 超长单词/连续中文逐字断行）。 */
function wrapText(text: string, maxWidth: number, fs: number): string[] {
  const out: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para === '') {
      out.push('');
      continue;
    }
    let line = '';
    const tokens = para.split(' ');
    for (const rawToken of tokens) {
      let token = rawToken;
      // 超长 token（连续中文/长单词）逐字断行
      while (measureWidth(token, fs) > maxWidth && token.length > 1) {
        let cut = token.length - 1;
        while (cut > 0 && measureWidth(token.slice(0, cut), fs) > maxWidth) cut--;
        const piece = token.slice(0, cut);
        if (line.length > 0) {
          out.push(line);
          line = '';
        }
        out.push(piece);
        token = token.slice(cut);
      }
      const candidate = line.length > 0 ? line + ' ' + token : token;
      if (measureWidth(candidate, fs) <= maxWidth) {
        line = candidate;
      } else {
        if (line.length > 0) out.push(line);
        line = token;
      }
    }
    out.push(line);
  }
  return out;
}

/** 把 UTC 时间格式化为「YYYY-MM-DD HH:mm」（与内核"时间全 UTC"约定一致）。 */
function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  );
}

/**
 * 生成分享长图的 SVG 字符串。
 * @param note 单条笔记（已包含规范化后的 tags、UTC 时间）
 * @param options 模板 / 水印覆盖
 */
export function generateShareSvg(note: NoteCard, options: ShareImageOptions = {}): string {
  const tpl: ShareTemplate = getTemplate(options.templateId ?? 'paper');
  const wmZh = options.watermarkZh ?? DEFAULT_WATERMARK_ZH;
  const wmEn = options.watermarkEn ?? DEFAULT_WATERMARK_EN;

  const width = tpl.width;
  const pad = tpl.padding;
  const fs = tpl.fontSize;
  const lineH = Math.round(fs * tpl.lineHeight);
  const maxW = width - pad * 2;

  // ---- 布局游标 ----
  let y = pad;
  const headerBaseline = y + 26; // 日期字号 26
  y = headerBaseline + 20;

  const lines = wrapText(note.content || '', maxW, fs);
  const yContent = y + lineH; // 首行基线
  let yAfterContent = yContent + lines.length * lineH;

  // ---- 标签 chips ----
  const chipFont = Math.round(fs * 0.82);
  const chipH = 46;
  const chipPadX = 18;
  const chipGapX = 14;
  const chipGapY = 14;
  let tagRows = 0;
  let yAfterTags = yAfterContent;
  if (note.tags && note.tags.length > 0) {
    let cx = pad;
    let cy = yAfterContent + 40;
    let rowMaxBottom = cy + chipH;
    for (const tag of note.tags) {
      const label = '#' + tag;
      const cw = measureWidth(label, chipFont) + chipPadX * 2;
      if (cx + cw > width - pad) {
        cx = pad;
        cy += chipH + chipGapY;
        rowMaxBottom = cy + chipH;
      }
      cx += cw + chipGapX;
    }
    yAfterTags = rowMaxBottom;
    tagRows = 1;
  }

  const footerGap = 44;
  const wmBlockH = 56;
  const totalHeight = yAfterTags + footerGap + wmBlockH + Math.round(pad * 0.7);

  // ---- 组装 SVG ----
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
      `viewBox="0 0 ${width} ${totalHeight}" font-family='${tpl.fontFamily}'>`,
  );

  // defs：渐变背景 / 卡片阴影
  parts.push('<defs>');
  if (tpl.bgGradient) {
    parts.push(
      `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="${tpl.bgGradient.from}"/>` +
        `<stop offset="1" stop-color="${tpl.bgGradient.to}"/></linearGradient>`,
    );
  }
  if (tpl.id !== 'minimal') {
    parts.push(
      `<filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">` +
        `<feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.12"/>` +
        `</filter>`,
    );
  }
  parts.push('</defs>');

  // 背景
  parts.push(
    `<rect x="0" y="0" width="${width}" height="${totalHeight}" fill="${tpl.bgGradient ? 'url(#bgGrad)' : tpl.bg}"/>`,
  );

  // 卡片（纸感 / 暗色有卡片感；简约白底 invisible 但保留阴影开关）
  const cardX = Math.round(pad * 0.5);
  const cardW = width - pad;
  const cardY = Math.round(pad * 0.5);
  const cardH = yAfterTags - cardY + 28;
  parts.push(
    `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${tpl.radius}" ` +
      `fill="${tpl.cardBg}"${tpl.id !== 'minimal' ? ' filter="url(#cardShadow)"' : ''}/>`,
  );

  // 头部日期 + 装饰点
  parts.push(
    `<circle cx="${pad + 6}" cy="${headerBaseline - 8}" r="6" fill="${tpl.accent}"/>`,
  );
  parts.push(
    `<text x="${pad + 24}" y="${headerBaseline}" font-size="26" fill="${tpl.subText}">${escapeXml(
      formatDateTime(note.createdAt),
    )}</text>`,
  );
  // 头部细分隔线
  parts.push(
    `<line x1="${pad}" y1="${headerBaseline + 16}" x2="${width - pad}" y2="${headerBaseline + 16}" ` +
      `stroke="${tpl.subText}" stroke-opacity="0.25" stroke-width="1.5"/>`,
  );

  // 正文
  const contentTspans = lines
    .map(
      (ln, i) =>
        `<tspan x="${pad}" dy="${i === 0 ? 0 : lineH}">${ln.length ? escapeXml(ln) : ' '}</tspan>`,
    )
    .join('');
  parts.push(
    `<text x="${pad}" y="${yContent}" font-size="${fs}" fill="${tpl.text}" font-weight="400">${contentTspans}</text>`,
  );

  // 标签 chips
  if (note.tags && note.tags.length > 0) {
    let cx = pad;
    let cy = yAfterContent + 40;
    for (const tag of note.tags) {
      const label = '#' + tag;
      const cw = measureWidth(label, chipFont) + chipPadX * 2;
      if (cx + cw > width - pad) {
        cx = pad;
        cy += chipH + chipGapY;
      }
      parts.push(
        `<rect x="${cx}" y="${cy}" width="${cw}" height="${chipH}" rx="${Math.round(
          chipH / 2,
        )}" fill="${tpl.accent}" fill-opacity="0.14"/>`,
      );
      parts.push(
        `<text x="${cx + chipPadX}" y="${cy + Math.round(chipH / 2) + Math.round(chipFont * 0.35)}" ` +
          `font-size="${chipFont}" fill="${tpl.accent}">${escapeXml(label)}</text>`,
      );
      cx += cw + chipGapX;
    }
  }

  // 右下角水印
  const wmEnY = totalHeight - Math.round(pad * 0.7);
  const wmZhY = wmEnY - 26;
  parts.push(
    `<text text-anchor="end" x="${width - pad}" y="${wmZhY}" font-size="24" ` +
      `fill="${tpl.accent}" opacity="${tpl.watermarkOpacity}" font-weight="600">${escapeXml(wmZh)}</text>`,
  );
  parts.push(
    `<text text-anchor="end" x="${width - pad}" y="${wmEnY}" font-size="15" letter-spacing="2" ` +
      `fill="${tpl.subText}" opacity="${tpl.watermarkOpacity}">${escapeXml(wmEn)}</text>`,
  );

  parts.push('</svg>');
  return parts.join('');
}
