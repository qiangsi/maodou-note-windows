import './style.css';
import { svgToPngDataUrl, downloadDataUrl } from './share-export';

// 渲染进程：通过 contextBridge 暴露的 window.maodou 调用主进程内核。
// 注意：渲染进程不直接 import 内核（避免浏览器环境缺少 node:fs）。
declare global {
  interface Window {
    maodou: {
      listCards(): Promise<Card[]>;
      createCard(content: string, tags: string[]): Promise<Card>;
      updateCard(id: string, content: string, tags: string[]): Promise<Card>;
      deleteCard(id: string): Promise<void>;
      search(query: string | null, tags: string[] | null): Promise<Card[]>;
      listTags(): Promise<{ tag: string; count: number }[]>;
      getSettings(): Promise<Settings>;
      saveSettings(s: Settings): Promise<void>;
      runSync(): Promise<SyncResult>;
      getMeta(): Promise<{ lastSyncCursor: string | null; lastSyncTime: string | null }>;
      /** 列出分享长图模板（paper / minimal / dark）。 */
      listShareTemplates(): Promise<{ id: string; name: string; description: string }[]>;
      /** 把指定笔记渲染为分享长图（SVG 字符串），templateId 默认 paper。 */
      generateShareImage(noteId: string, templateId: string): Promise<string>;
    };
  }
}

interface Card {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  status: 'synced' | 'pending' | 'conflict';
  version: number;
}

interface Settings {
  serverBaseUrl: string;
  username: string;
  password: string;
}

interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  conflictsDetail: unknown[];
  durationMs: number;
}

/** 简单客户端标签解析（与内核 TagService 一致：提取 #标签）。 */
function parseTags(content: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  const regex = /#([^\s#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    const t = m[1];
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(t);
    }
  }
  return tags;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let activeTagFilter: string | null = null;

/** 渲染列表时缓存完整 Card 对象，详情弹层直接按 id 取用，避免重复请求。 */
let cardsById = new Map<string, Card>();

/** 分享长图模板列表，启动时预加载，详情弹层内复用。 */
let shareTemplates: { id: string; name: string; description: string }[] = [];

function toast(msg: string): void {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el?.classList.remove('show'), 1800);
}

function renderCard(card: Card): string {
  const tagsHtml = card.tags
    .map(
      (t) =>
        `<span class="tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`,
    )
    .join('');
  const conflictBadge =
    card.status === 'conflict' ? '<span class="tag">⚠ 冲突</span>' : '';
  return `
    <div class="card ${card.status === 'conflict' ? 'conflict' : ''}" data-card="${card.id}">
      <div class="body">${escapeHtml(card.content)}</div>
      <div class="tags">${tagsHtml}${conflictBadge}</div>
      <div class="meta">
        <span>${fmtTime(card.createdAt)}</span>
        <button class="ghost" data-del="${card.id}">软删除</button>
      </div>
    </div>`;
}

async function renderHome(): Promise<void> {
  const view = document.querySelector<HTMLElement>('#view-home')!;
  const cards = activeTagFilter
    ? await window.maodou.search(null, [activeTagFilter])
    : await window.maodou.listCards();
  // 缓存完整 Card 对象，详情弹层按 id 取用。显式标注类型，确保上游类型退化时仍可通过严格检查。
  cardsById = new Map<string, Card>(
    cards.map((c: Card) => [c.id, c] as [string, Card]),
  );
  const listHtml = cards.length
    ? cards.map(renderCard).join('')
    : '<div class="empty">还没有卡片，写一条吧～</div>';
  view.innerHTML = `
    <div class="composer">
      <textarea id="composer-input" placeholder="此刻的想法…用 #标签 来组织（Ctrl/⌘+Enter 保存）"></textarea>
      <div class="row">
        <span class="hint">支持 #灵感 #读书 这样的标签；离线保存，联网后一键同步</span>
        <button class="primary" id="composer-save">保存</button>
      </div>
    </div>
    ${activeTagFilter ? `<div class="hint">筛选标签：#${escapeHtml(activeTagFilter)} <button class="ghost" id="clear-filter">清除</button></div>` : ''}
    <div id="card-list">${listHtml}</div>`;

  const input = view.querySelector<HTMLTextAreaElement>('#composer-input')!;
  const save = view.querySelector<HTMLButtonElement>('#composer-save')!;
  const doSave = async () => {
    const content = input.value.trim();
    if (!content) return;
    await window.maodou.createCard(content, parseTags(content));
    input.value = '';
    await renderHome();
  };
  save.addEventListener('click', doSave);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doSave();
  });

  view.querySelectorAll<HTMLElement>('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      activeTagFilter = el.getAttribute('data-tag');
      switchView('home');
    });
  });
  const clear = view.querySelector<HTMLButtonElement>('#clear-filter');
  if (clear) {
    clear.addEventListener('click', () => {
      activeTagFilter = null;
      switchView('home');
    });
  }
  view.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.maodou.deleteCard(btn.getAttribute('data-del')!);
      await renderHome();
    });
  });

  // 点击卡片正文/区域打开详情弹层（删除按钮已 stopPropagation，不会触发）。
  view.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-card')!;
      const card = cardsById.get(id);
      if (card) void openDetail(card);
    });
  });
}

async function renderTags(): Promise<void> {
  const view = document.querySelector<HTMLElement>('#view-tags')!;
  const tags = await window.maodou.listTags();
  const listHtml = tags.length
    ? tags
        .map(
          (t) =>
            `<div class="tag-item" data-tag="${escapeHtml(t.tag)}"><span>#${escapeHtml(
              t.tag,
            )}</span><span class="count">${t.count}</span></div>`,
        )
        .join('')
    : '<div class="empty">还没有标签</div>';
  view.innerHTML = `<h2>标签</h2>${listHtml}`;
  view.querySelectorAll<HTMLElement>('.tag-item').forEach((el) => {
    el.addEventListener('click', () => {
      activeTagFilter = el.getAttribute('data-tag');
      switchView('home');
    });
  });
}

async function renderSettings(): Promise<void> {
  const view = document.querySelector<HTMLElement>('#view-settings')!;
  const s = await window.maodou.getSettings();
  const meta = await window.maodou.getMeta();
  const last = meta.lastSyncCursor
    ? fmtTime(meta.lastSyncCursor)
    : '尚未同步';
  view.innerHTML = `
    <h2>设置</h2>
    <div class="form">
      <label>WebDAV 服务器地址</label>
      <input id="s-url" value="${escapeHtml(s.serverBaseUrl)}" placeholder="https://dav.example.com" />
      <label>用户名</label>
      <input id="s-user" value="${escapeHtml(s.username)}" placeholder="可选" />
      <label>密码</label>
      <input id="s-pass" type="password" value="${escapeHtml(s.password)}" placeholder="可选" />
      <div class="row" style="margin-top:16px; display:flex; gap:8px;">
        <button class="primary" id="s-save">保存配置</button>
        <button class="primary" id="s-sync">立即同步</button>
      </div>
      <div class="sync-status" id="s-status">上次同步：${last}</div>
    </div>`;
  view.querySelector<HTMLButtonElement>('#s-save')!.addEventListener(
    'click',
    async () => {
      await window.maodou.saveSettings({
        serverBaseUrl: view.querySelector<HTMLInputElement>('#s-url')!.value,
        username: view.querySelector<HTMLInputElement>('#s-user')!.value,
        password: view.querySelector<HTMLInputElement>('#s-pass')!.value,
      });
      toast('配置已保存');
    },
  );
  view.querySelector<HTMLButtonElement>('#s-sync')!.addEventListener(
    'click',
    async () => {
      const status = view.querySelector<HTMLDivElement>('#s-status')!;
      status.textContent = '同步中…';
      try {
        const r = await window.maodou.runSync();
        status.textContent = `同步完成：上传 ${r.pushed}，拉取 ${r.pulled}，冲突 ${r.conflicts}`;
        toast('同步成功');
      } catch (e) {
        status.textContent = `同步失败：${(e as Error).message}`;
      }
    },
  );
}

/** 预加载分享模板列表（失败则降级为空，详情弹层默认选中 paper）。 */
async function loadShareTemplates(): Promise<void> {
  try {
    shareTemplates = await window.maodou.listShareTemplates();
  } catch {
    shareTemplates = [];
  }
}

/**
 * 打开卡片详情弹层：展示正文（只读）、#标签、创建时间，以及"分享长图"区。
 * 分享区包含模板切换、长图预览与导出 PNG 三个部分。
 */
async function openDetail(card: Card): Promise<void> {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">卡片详情</span>
        <button class="ghost modal-close">关闭</button>
      </div>
      <div class="modal-body">
        <div class="detail-body">${escapeHtml(card.content)}</div>
        <div class="detail-tags">${
          card.tags.length
            ? card.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')
            : '<span class="detail-empty">无标签</span>'
        }</div>
        <div class="detail-time">创建于 ${fmtTime(card.createdAt)}</div>
      </div>
      <div class="share">
        <div class="share-title">分享长图</div>
        <div class="share-templates" id="share-templates"></div>
        <div class="share-preview" id="share-preview"></div>
        <div class="share-actions">
          <button class="primary" id="share-export">导出 PNG</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(mask);

  const close = () => mask.remove();
  mask.querySelector<HTMLButtonElement>('.modal-close')!.addEventListener('click', close);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close();
  });

  const templatesBox = mask.querySelector<HTMLDivElement>('#share-templates')!;
  const preview = mask.querySelector<HTMLDivElement>('#share-preview')!;
  const exportBtn = mask.querySelector<HTMLButtonElement>('#share-export')!;

  // 默认选中第一个模板（通常为 paper）。
  let currentTemplate = shareTemplates.length ? shareTemplates[0].id : 'paper';
  let currentSvg = '';

  // 渲染模板选择按钮并高亮当前选中项。
  const renderTemplates = (): void => {
    templatesBox.innerHTML = shareTemplates
      .map(
        (t) =>
          `<button class="tpl-btn ${t.id === currentTemplate ? 'active' : ''}" data-tpl="${escapeHtml(
            t.id,
          )}" title="${escapeHtml(t.description)}">${escapeHtml(t.name)}</button>`,
      )
      .join('');
    templatesBox.querySelectorAll<HTMLButtonElement>('[data-tpl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        currentTemplate = btn.getAttribute('data-tpl')!;
        renderTemplates();
        await generatePreview();
      });
    });
  };

  // 生成当前模板的长图 SVG，缓存到 currentSvg 并刷新预览。
  const generatePreview = async (): Promise<void> => {
    currentSvg = await window.maodou.generateShareImage(card.id, currentTemplate);
    preview.innerHTML = currentSvg;
  };

  exportBtn.addEventListener('click', async () => {
    if (!currentSvg) return;
    try {
      const png = await svgToPngDataUrl(currentSvg, 2);
      downloadDataUrl(png, `maodou-${card.id}.png`);
      toast('已导出 PNG');
    } catch (err) {
      toast(`导出失败：${(err as Error).message}`);
    }
  });

  renderTemplates();
  await generatePreview();
}

function switchView(name: 'home' | 'tags' | 'settings'): void {
  document
    .querySelectorAll('.nav-item')
    .forEach((b) =>
      b.classList.toggle('active', b.getAttribute('data-view') === name),
    );
  document
    .querySelectorAll('.view')
    .forEach((v) => v.classList.add('hidden'));
  document.querySelector(`#view-${name}`)!.classList.remove('hidden');

  if (name === 'home') void renderHome();
  else if (name === 'tags') void renderTags();
  else void renderSettings();
}

function bindNav(): void {
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () =>
      switchView(btn.getAttribute('data-view') as 'home' | 'tags' | 'settings'),
    );
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindNav();
  void loadShareTemplates();
  void renderHome();
});
