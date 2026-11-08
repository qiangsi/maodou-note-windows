/**
 * 分享长图导出工具（浏览器 / Electron 渲染进程环境）。
 *
 * 内核 generateShareSvg() 产出的是矢量 SVG 长图；本文件负责把它栅格化为 PNG 并触发下载。
 * 用法（例如在卡片详情的"分享"按钮里）：
 *   const svg = await window.maodou.generateShareImage(noteId, 'paper');
 *   const png = await svgToPngDataUrl(svg, 2);
 *   downloadDataUrl(png, `maodou-${noteId}.png`);
 */

/** 把 SVG 字符串栅格化为 PNG dataURL（默认为 2 倍清晰度）。 */
export function svgToPngDataUrl(svg: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      const w = Number(root.getAttribute('width')) || img.naturalWidth;
      const h = Number(root.getAttribute('height')) || img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('canvas 2d context unavailable'));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err as Error);
      }
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e instanceof Error ? e : new Error('svg load failed'));
    };
    img.src = url;
  });
}

/** 触发浏览器下载一个 dataURL 文件。 */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
