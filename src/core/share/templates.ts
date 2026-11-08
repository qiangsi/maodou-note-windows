/**
 * 分享长图模板定义（对齐 PRD / 用户需求：单条笔记 → 一张竖版长图）。
 *
 * 设计要点：
 * - 长图采用矢量 SVG 输出（宽度固定 1080，高度按内容自适应），
 *   两端（Electron WebView / Capacitor WebView）可直接把 SVG 栅格化为 PNG 下载。
 * - 每个模板定义一整套配色 / 字体 / 圆角，渲染逻辑见 ShareImageBuilder。
 * - 右下角水印固定为「毛豆笔记 · Maodou-Note」，由渲染层统一绘制。
 *
 * 当前提供 3 个模板：paper（纸感卡片，默认）、minimal（简约留白）、dark（暗色渐变）。
 */

export interface ShareTemplate {
  /** 模板唯一 id（用于 generateShareSvg(templateId) 选择）。 */
  id: string;
  /** 模板展示名（中文）。 */
  name: string;
  /** 一句话描述。 */
  description: string;
  /** 画布宽度（px）。 */
  width: number;
  /** 四周内边距（px）。 */
  padding: number;
  /** 纯色背景；若设置了 bgGradient 则优先使用渐变。 */
  bg: string;
  /** 渐变背景（暗色模板用）。 */
  bgGradient?: { from: string; to: string; angle?: number };
  /** 卡片内容区背景（部分模板与 bg 同色即无线框）。 */
  cardBg: string;
  /** 卡片圆角。 */
  radius: number;
  /** 正文主色。 */
  text: string;
  /** 次要信息色（日期、提示）。 */
  subText: string;
  /** 强调色（标签 chip、装饰点、水印主字）。 */
  accent: string;
  /** 水印透明度 0~1。 */
  watermarkOpacity: number;
  /** 字体栈（含中文优先）。 */
  fontFamily: string;
  /** 正文字号（px）。 */
  fontSize: number;
  /** 行高倍数。 */
  lineHeight: number;
}

const CJK_FONT =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif';

export const SHARE_TEMPLATES: ShareTemplate[] = [
  {
    id: 'paper',
    name: '纸感卡片',
    description: '米色纸张质感 + 便签阴影，温暖手账风（默认模板）',
    width: 1080,
    padding: 72,
    bg: '#F3EEE3',
    cardBg: '#FFFDF8',
    radius: 28,
    text: '#33302B',
    subText: '#9A8F7A',
    accent: '#B8895A',
    watermarkOpacity: 0.55,
    fontFamily: CJK_FONT,
    fontSize: 34,
    lineHeight: 1.62,
  },
  {
    id: 'minimal',
    name: '简约留白',
    description: '纯白底、克制排版、大量留白，类 flomo 默认分享图',
    width: 1080,
    padding: 80,
    bg: '#FFFFFF',
    cardBg: '#FFFFFF',
    radius: 0,
    text: '#1A1A1A',
    subText: '#9CA3AF',
    accent: '#6B7280',
    watermarkOpacity: 0.4,
    fontFamily: CJK_FONT,
    fontSize: 34,
    lineHeight: 1.7,
  },
  {
    id: 'dark',
    name: '暗色渐变',
    description: '深色背景 + 渐变，夜间模式感，霓虹蓝强调',
    width: 1080,
    padding: 72,
    bg: '#1F2230',
    bgGradient: { from: '#222637', to: '#2C3350', angle: 145 },
    cardBg: '#262B3D',
    radius: 28,
    text: '#E8EAF0',
    subText: '#8B93A7',
    accent: '#7C9CFF',
    watermarkOpacity: 0.5,
    fontFamily: CJK_FONT,
    fontSize: 34,
    lineHeight: 1.62,
  },
];

const DEFAULT_TEMPLATE_ID = 'paper';

/** 按 id 取模板；找不到时回退到默认模板。 */
export function getTemplate(id: string): ShareTemplate {
  return SHARE_TEMPLATES.find((t) => t.id === id) ?? SHARE_TEMPLATES[0];
}

/** 列出所有模板的精简元信息（供客户端生成模板选择器）。 */
export function listTemplates(): { id: string; name: string; description: string }[] {
  return SHARE_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }));
}
