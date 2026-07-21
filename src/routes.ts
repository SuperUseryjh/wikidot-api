/**
 * Wikidot API 路由定义
 */

import { WikidotClient } from "./client.ts";
import type { PageDetail } from "./types.ts";
import { checkRateLimit } from "./rate-limit.ts";

const DEFAULT_SITE = process.env.WIKIDOT_SITE || "mc-anomaly-archives";
const defaultClient = new WikidotClient(DEFAULT_SITE);

// ── 响应工具函数 ────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function error(msg: string, status = 400): Response {
  return json({ error: msg }, status);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function parseQuery(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }
  return params;
}

/** 从 URL 的 ?wiki= 参数获取 Wikidot 站点名称 */
function getClient(url?: URL): WikidotClient {
  if (!url) return defaultClient;
  const wiki = url.searchParams.get("wiki");
  if (!wiki) return defaultClient;
  let site = wiki.trim();
  site = site
    .replace(/^https?:\/\//, "")
    .replace(/\.wikidot\.com$/, "")
    .replace(/\/+$/, "");
  if (!site) return defaultClient;
  return new WikidotClient(site);
}

// ── API 文档页 ───────────────────────────────────────

function renderApiDoc(): string {
  const siteUrl = `https://${DEFAULT_SITE}.wikidot.com`;
  const B = "https://wiki-api.yaoonion.fun";

  interface Snippet { lang: string; code: string; }
  interface ResponseExample { lang: string; code: string; }
  interface FieldDef { name: string; type: string; desc: string; children?: FieldDef[]; }

  const respJson = (code: string): ResponseExample => ({ lang: "JSON", code });

  // ── 共享响应字段定义 ────────────────────────────
  const pageMetaFields: FieldDef[] = [
    { name: "fullname", type: "string", desc: "文章唯一标识，如 `co-1`" },
    { name: "category", type: "string", desc: "分类名称" },
    { name: "name", type: "string", desc: "文章短名称" },
    { name: "title", type: "string", desc: "文章标题" },
    { name: "tags", type: "string[]", desc: "标签列表" },
    { name: "rating", type: "number", desc: "评分（可正可负）" },
    { name: "votes_count", type: "number", desc: "投票数" },
    { name: "comments_count", type: "number", desc: "评论数" },
    { name: "size", type: "number", desc: "页面大小（字节）" },
    { name: "children_count", type: "number", desc: "子页面数量" },
    { name: "revisions_count", type: "number", desc: "修订版本数" },
    { name: "created_by", type: "string", desc: "创建者用户名（可选）" },
    { name: "page_id", type: "number", desc: "Wikidot 页面 ID（可选）" },
  ];
  const pageDetailFields: FieldDef[] = [
    ...pageMetaFields,
    { name: "source", type: "string", desc: "Wiki 源代码（可选）" },
    { name: "rendered_html", type: "string", desc: "渲染后 HTML（可选）" },
  ];

  // ── helper: 生成多语言代码 ──────────────────────
  function curlSnippet(url: string): Snippet {
    return { lang: "cURL", code: `curl "${B}${url}"` };
  }
  function tsSnippet(url: string, comment: string): Snippet {
    return { lang: "TypeScript", code: `// ${comment}\nconst res = await fetch("${B}${url}");\nconst data = await res.json();\nconsole.log(data);` };
  }
  function pySnippet(url: string, comment: string): Snippet {
    return { lang: "Python", code: `# ${comment}\nimport requests\n\nres = requests.get("${B}${url}")\nprint(res.json())` };
  }
  function goSnippet(url: string, comment: string): Snippet {
    return { lang: "Go", code: `// ${comment}\nimport ("net/http"; "io"; "log")\n\nres, _ := http.Get("${B}${url}")\nbody, _ := io.ReadAll(res.Body)\ndefer res.Body.Close()\nlog.Println(string(body))` };
  }



  const endpoints = [
    { id: "root", method: "GET", path: "/", summary: "API 文档", desc: "返回本 API 文档页。", params: [], snippets: [] as Snippet[], responseFields: [] as FieldDef[], response: undefined as ResponseExample | undefined },
    {
      id: "pages-list", method: "GET", path: "/api/pages", summary: "搜索文章列表",
      desc: "搜索文章列表，支持分页、按分类/标签过滤。",
      params: [
        { name: "category", type: "string", required: false, default: "*", desc: "分类名称，`*` 表示全部" },
        { name: "tags", type: "string", required: false, default: "-", desc: "标签过滤，多个标签用空格分隔" },
        { name: "order", type: "string", required: false, default: "created_at desc", desc: "排序方式" },
        { name: "limit", type: "number", required: false, default: "-", desc: "最大返回条数" },
        { name: "offset", type: "number", required: false, default: "0", desc: "偏移量" },
        { name: "perPage", type: "number", required: false, default: "250", desc: "每页条数" },
      ],
      responseFields: [
        { name: "count", type: "number", desc: "返回的文章数量" },
        { name: "pages", type: "PageMeta[]", desc: "文章列表", children: pageMetaFields },
      ],
      snippets: [
        curlSnippet("/api/pages?category=co&limit=10"),
        tsSnippet("/api/pages?category=co&limit=10", "获取 co 分类前 10 篇文章"),
        pySnippet("/api/pages?category=co&limit=10", "获取 co 分类前 10 篇文章"),
        goSnippet("/api/pages?category=co&limit=10", "获取 co 分类前 10 篇文章"),
      ],
      response: respJson(`{\n  "count": 10,\n  "pages": [ { "fullname": "co-1", "category": "co", "rating": 2, "tags": ["_cc"], ... } ]\n}`),
    },
    {
      id: "pages-detail", method: "GET", path: "/api/pages/:fullname", summary: "文章详情",
      desc: "获取单篇文章详情，含源代码、评分、标签、渲染 HTML。",
      params: [
        { name: "fullname", type: "string", required: true, default: "-", desc: "文章 fullname，如 `co-1`" },
      ],
      responseFields: pageDetailFields,
      snippets: [
        curlSnippet("/api/pages/co-1"),
        tsSnippet("/api/pages/co-1", "获取 co-1 的完整信息"),
        pySnippet("/api/pages/co-1", "获取 co-1 的完整信息"),
        goSnippet("/api/pages/co-1", "获取 co-1 的完整信息"),
      ],
      response: respJson(`{\n  "fullname": "co-1", "category": "co", "rating": 2, "tags": ["_cc"], "source": "...", "rendered_html": "...", ...\n}`),
    },
    {
      id: "pages-source", method: "GET", path: "/api/pages/:fullname/source", summary: "Wiki 源代码",
      desc: "获取文章的 Wiki 源代码（纯文本）。",
      params: [
        { name: "fullname", type: "string", required: true, default: "-", desc: "文章 fullname" },
      ],
      responseFields: [
        { name: "（无）", type: "text/plain", desc: "直接返回 Wiki 源代码文本，非 JSON" },
      ],
      snippets: [
        curlSnippet("/api/pages/co-1/source"),
        tsSnippet("/api/pages/co-1/source", "获取 co-1 的 wiki 源码"),
        pySnippet("/api/pages/co-1/source", "获取 co-1 的 wiki 源码"),
        goSnippet("/api/pages/co-1/source", "获取 co-1 的 wiki 源码"),
      ],
      response: respJson("Key: wiki 源码明文"),
    },
    {
      id: "pages-rendered", method: "GET", path: "/api/pages/:fullname/rendered", summary: "渲染 HTML",
      desc: "获取文章渲染后的 HTML。",
      params: [
        { name: "fullname", type: "string", required: true, default: "-", desc: "文章 fullname" },
      ],
      responseFields: [
        { name: "（无）", type: "text/html", desc: "直接返回 HTML 文档，非 JSON" },
      ],
      snippets: [
        curlSnippet("/api/pages/co-1/rendered"),
        tsSnippet("/api/pages/co-1/rendered", "获取 co-1 的渲染 HTML"),
        pySnippet("/api/pages/co-1/rendered", "获取 co-1 的渲染 HTML"),
        goSnippet("/api/pages/co-1/rendered", "获取 co-1 的渲染 HTML"),
      ],
      response: respJson("Key: HTML 文档全文"),
    },
    {
      id: "categories", method: "GET", path: "/api/categories", summary: "所有分类",
      desc: "获取站点所有分类列表。", params: [],
      responseFields: [
        { name: "categories", type: "string[]", desc: "所有分类名称列表" },
      ],
      snippets: [
        curlSnippet("/api/categories"),
        tsSnippet("/api/categories", "获取所有分类"),
        pySnippet("/api/categories", "获取所有分类"),
        goSnippet("/api/categories", "获取所有分类"),
      ],
      response: respJson(`{\n  "categories": [ "_default", "co", "story" ]\n}`),
    },
    {
      id: "tags", method: "GET", path: "/api/tags", summary: "所有标签",
      desc: "获取站点所有标签。", params: [],
      responseFields: [
        { name: "tags", type: "string[]", desc: "所有标签名称列表" },
      ],
      snippets: [
        curlSnippet("/api/tags"),
        tsSnippet("/api/tags", "获取所有标签"),
        pySnippet("/api/tags", "获取所有标签"),
        goSnippet("/api/tags", "获取所有标签"),
      ],
      response: respJson(`{\n  "tags": [ "_cc", "tag1", "tag2" ]\n}`),
    },
    {
      id: "stats", method: "GET", path: "/api/stats", summary: "站点统计",
      desc: "获取站点统计信息（页面总数、分类分布、总大小等）。", params: [],
      responseFields: [
        { name: "total_pages", type: "number", desc: "页面总数" },
        { name: "total_categories", type: "number", desc: "分类数量" },
        { name: "categories", type: "object", desc: "各分类下的页面数量，如 `{ \"co\": 12 }`" },
        { name: "total_size_bytes", type: "number", desc: "所有页面总大小（字节）" },
        { name: "total_votes", type: "number", desc: "总投票数" },
        { name: "total_comments", type: "number", desc: "总评论数" },
      ],
      snippets: [
        curlSnippet("/api/stats"),
        tsSnippet("/api/stats", "获取站点统计"),
        pySnippet("/api/stats", "获取站点统计"),
        goSnippet("/api/stats", "获取站点统计"),
      ],
      response: respJson(`{\n  "total_pages": 439,\n  "total_categories": 93,\n  "categories": { "_default": 2, "co": 12 },\n  "total_size_bytes": 1234567,\n  "total_votes": 89,\n  "total_comments": 34\n}`),
    },
  ];

  const commonParams = [
    { name: "wiki", type: "string", required: false, default: DEFAULT_SITE, desc: `指定目标 Wikidot 站点。可以是站点名如 <code>scp-wiki</code> 或完整 URL <code>https://scp-wiki.wikidot.com</code>` },
  ];

  function paramRows(ps: typeof commonParams) {
    return ps.map(p => `<tr><td><code>${p.name}</code></td><td><span class="tag-type">${p.type}</span></td><td>${p.required ? '<span class="tag-req">必填</span>' : '<span class="tag-opt">可选</span>'}</td><td><code>${p.default}</code></td><td>${p.desc}</td></tr>`).join("");
  }

  function sidebarItems() {
    return endpoints.map((ep, i) =>
      `<div class="sidebar-item" data-index="${i}" onclick="selectEndpoint(${i})">
        <span class="method-badge method-${ep.method.toLowerCase()}">${ep.method}</span>
        <span class="sidebar-path">${ep.path}</span>
        <span class="sidebar-summary">${ep.summary}</span>
      </div>`
    ).join("");
  }

  function codeBlockHtml(snippets: Snippet[], panelIdx: number): string {
    if (snippets.length === 0) return "";
    const tabs = snippets.map((s, si) =>
      `<span class="code-tab" data-panel="${panelIdx}" data-tab="${si}" onclick="switchCodeTab(${panelIdx}, ${si})">${s.lang}</span>`
    ).join("");
    const blocks = snippets.map((s, si) =>
      `<div class="code-content" data-panel="${panelIdx}" data-tab="${si}"><pre>${escapeHtml(s.code)}</pre></div>`
    ).join("");
    return `
    <h3 class="section-title">请求示例</h3>
    <div class="code-wrap">
      <div class="code-tabs">${tabs}</div>
      ${blocks}
    </div>`;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fieldTableRows(fields: FieldDef[], depth = 0): string {
    const pad = depth > 0 ? `style="padding-left:${depth * 20 + 14}px"` : "";
    return fields.map(f => {
      const row = `<tr>
        <td ${pad}><code${depth > 0 ? ` class="nested"` : ""}>${f.name}</code></td>
        <td><span class="tag-type">${f.type}</span></td>
        <td>${f.desc}</td>
      </tr>`;
      const children = f.children && f.children.length > 0 ? fieldTableRows(f.children, depth + 1) : "";
      return row + children;
    }).join("");
  }

  function responseSchemaHtml(fields: FieldDef[]): string {
    if (fields.length === 0) return "";
    return `
    <h3 class="section-title">返回体格式</h3>
    <table class="param-table">
      <thead><tr><th>名称</th><th>类型</th><th>说明</th></tr></thead>
      <tbody>${fieldTableRows(fields)}</tbody>
    </table>`;
  }

  function detailPanels() {
    return endpoints.map((ep, i) =>
      `<div class="detail-panel" id="panel-${i}">
        <div class="detail-header">
          <span class="method-badge method-${ep.method.toLowerCase()} method-lg">${ep.method}</span>
          <span class="detail-path">${ep.path}</span>
        </div>
        <div class="detail-desc">${ep.desc}</div>

        ${ep.params.length > 0 ? `
        <h3 class="section-title">请求参数</h3>
        <table class="param-table">
          <thead><tr><th>名称</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead>
          <tbody>${paramRows(ep.params)}</tbody>
        </table>` : '<div class="no-params">无需请求参数</div>'}

        ${codeBlockHtml(ep.snippets, i)}

        ${responseSchemaHtml(ep.responseFields)}

        ${ep.response ? `
        <h3 class="section-title">返回体示例</h3>
        <div class="resp-block"><pre>${escapeHtml(ep.response.code)}</pre></div>` : ''}
      </div>`
    ).join("");
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wikidot API Service</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --sidebar-w: 300px;
    --bg: #f5f7fa;
    --surface: #fff;
    --border: #e8ecf1;
    --text: #1e293b;
    --text-muted: #64748b;
    --accent: #0f3460;
    --hover-bg: #f1f5f9;
    --active-bg: #eef2ff;
    --green: #22c55e;
    --radius: 8px;
    --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    display: flex;
    min-height: 100vh;
  }

  /* ── 左侧栏 ── */
  .sidebar {
    width: var(--sidebar-w);
    min-width: var(--sidebar-w);
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow: hidden;
  }
  .sidebar-header {
    padding: 20px 20px 16px;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-header h1 { font-size: 1.1rem; font-weight: 700; color: var(--accent); }
  .sidebar-header p { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
  .sidebar-header .site-link { color: var(--accent); }
  .sidebar-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 20px;
    cursor: pointer;
    transition: background 0.15s;
    border-left: 3px solid transparent;
  }
  .sidebar-item:hover { background: var(--hover-bg); }
  .sidebar-item.active {
    background: var(--active-bg);
    border-left-color: var(--accent);
  }
  .sidebar-item .sidebar-path {
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.82rem;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
  }
  .sidebar-item .sidebar-summary {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 70px;
  }

  /* ── 右侧内容 ── */
  .main { flex: 1; padding: 32px 40px; max-width: calc(100vw - var(--sidebar-w)); }
  .detail-panel { display: none; }
  .detail-panel.active { display: block; }

  .detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .detail-path {
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text);
    word-break: break-all;
  }
  .detail-desc { color: var(--text-muted); font-size: 0.92rem; margin-bottom: 28px; }

  .section-title {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 10px;
    margin-top: 24px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* ── 方法 Badge ── */
  .method-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    color: #fff;
    flex-shrink: 0;
    min-width: 36px;
    text-align: center;
  }
  .method-get { background: var(--green); }
  .method-lg { font-size: 0.78rem; padding: 4px 12px; min-width: 48px; }

  /* ── 参数表 ── */
  .param-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .param-table th {
    background: #f8fafc;
    text-align: left;
    padding: 10px 14px;
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }
  .param-table td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .param-table tr:last-child td { border-bottom: none; }
  .param-table td code {
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: "SF Mono", "Fira Code", Menlo, monospace;
    font-size: 0.8rem;
    color: #0f172a;
  }
  .param-table td code.nested {
    font-size: 0.78rem;
    color: #6366f1;
  }
  .tag-type {
    display: inline-block;
    font-size: 0.72rem;
    color: #6366f1;
    background: #eef2ff;
    padding: 1px 8px;
    border-radius: 3px;
  }
  .tag-req { color: #ef4444; font-size: 0.72rem; }
  .tag-opt { color: var(--text-muted); font-size: 0.72rem; }
  .no-params {
    background: #f8fafc;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  /* ── 代码块（标签切换） ── */
  .code-wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .code-tabs {
    display: flex;
    background: #f8fafc;
    border-bottom: 1px solid var(--border);
  }
  .code-tab {
    padding: 8px 18px;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
    user-select: none;
  }
  .code-tab:hover { color: var(--text); }
  .code-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .code-content { display: none; background: #1e293b; }
  .code-content.active { display: block; }
  .code-content pre {
    margin: 0;
    padding: 16px 20px;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.82rem;
    color: #e2e8f0;
    overflow-x: auto;
    line-height: 1.7;
    white-space: pre;
  }

  /* ── 响应体 ── */
  .resp-block {
    background: #0b1120;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .resp-block pre {
    margin: 0;
    padding: 16px 20px;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 0.82rem;
    color: #a5f3fc;
    overflow-x: auto;
    line-height: 1.7;
    white-space: pre;
  }

  /* ── 通用参数 ── */
  .common-params-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 24px;
    margin-top: 32px;
    box-shadow: var(--shadow);
  }
  .common-params-card h3 {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 8px;
  }
  .common-params-card .cp-desc {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  footer {
    text-align: center;
    color: #94a3b8;
    font-size: 0.8rem;
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
  }
  footer a { color: var(--accent); }

  /* ── 响应式 ── */
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main { padding: 20px; max-width: 100vw; }
  }
</style>
</head>
<body>

<!-- 左侧栏 -->
<div class="sidebar">
  <div class="sidebar-header">
    <h1>Wikidot API</h1>
    <p><a class="site-link" href="${siteUrl}" target="_blank">${siteUrl}</a></p>
  </div>
  <div class="sidebar-list">
    ${sidebarItems()}
  </div>
</div>

<!-- 右侧内容 -->
<div class="main">
  ${detailPanels()}

  <!-- 通用参数 -->
  <div class="common-params-card">
    <h3>通用查询参数</h3>
    <div class="cp-desc">所有 API 端点（除 <code>/</code> 外）都支持以下通用查询参数：</div>
    <table class="param-table">
      <thead><tr><th>名称</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr></thead>
      <tbody>${paramRows(commonParams)}</tbody>
    </table>
  </div>

  <!-- 速率限制 -->
  <div class="common-params-card">
    <h3>速率限制</h3>
    <div class="cp-desc">
      每个 IP 每分钟最多 <strong>100</strong> 次请求。超出限制返回 <code>429 Too Many Requests</code>。
    </div>
    <table class="param-table">
      <thead><tr><th>响应头</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><code>X-RateLimit-Limit</code></td><td>速率上限（100）</td></tr>
        <tr><td><code>X-RateLimit-Remaining</code></td><td>当前窗口剩余请求数</td></tr>
        <tr><td><code>X-RateLimit-Reset</code></td><td>窗口重置的 Unix 时间戳（秒）</td></tr>
        <tr><td><code>Retry-After</code></td><td>429 时建议等待的秒数</td></tr>
      </tbody>
    </table>
  </div>

  <footer>
    Wikidot API Service &mdash; <a href="https://github.com/SuperUseryjh/wikidot-api" target="_blank">GitHub</a>
  </footer>
</div>

<script>
const endpoints = ${JSON.stringify(endpoints.map(e => ({id: e.id, path: e.path})))};
let current = 0;

function selectEndpoint(idx) {
  current = idx;
  document.querySelectorAll(".sidebar-item").forEach((el, i) => el.classList.toggle("active", i === idx));
  document.querySelectorAll(".detail-panel").forEach((el, i) => el.classList.toggle("active", i === idx));
  // 默认选中第一个语言 tab
  const firstTab = document.querySelector(\`.code-tab[data-panel="\${idx}"][data-tab="0"]\`);
  if (firstTab) switchCodeTab(idx, 0);
}

function switchCodeTab(panelIdx, tabIdx) {
  document.querySelectorAll(\`.code-tab[data-panel="\${panelIdx}"]\`).forEach((el, i) => el.classList.toggle("active", i === tabIdx));
  document.querySelectorAll(\`.code-content[data-panel="\${panelIdx}"]\`).forEach((el, i) => el.classList.toggle("active", i === tabIdx));
}

// 默认选中第一个
selectEndpoint(0);

// 键盘上下导航
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); selectEndpoint(Math.min(current + 1, ${endpoints.length - 1})); }
  if (e.key === "ArrowUp") { e.preventDefault(); selectEndpoint(Math.max(current - 1, 0)); }
});
</script>
</body>
</html>`;
}

// ── 路由注册 ─────────────────────────────────────────

interface RouteEntry {
  method: string;
  pattern: RegExp;
  params: string[];
  handler: (match: RegExpExecArray, url: URL) => Promise<Response>;
}

const routes: RouteEntry[] = [];

function route(
  method: string,
  path: string,
  handler: (url: URL, ...args: string[]) => Promise<Response>
) {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  const regex = new RegExp(`^${regexStr}$`);

  routes.push({
    method,
    pattern: regex,
    params: paramNames,
    handler: async (match: RegExpExecArray, url: URL) => {
      const args = paramNames.map((_, i) => decodeURIComponent(match[i + 1]));
      return handler(url, ...args);
    },
  });
}

// ── API 端点定义 ─────────────────────────────────────

// 首页 - API 文档
route("GET", "/", async () => {
  return html(renderApiDoc());
});

// 搜索文章列表
route("GET", "/api/pages", async (url: URL) => {
  const q = parseQuery(url);
  const c = getClient(url);
  try {
    const pages = await c.searchPages({
      category: q.category || "*",
      tags: q.tags,
      order: q.order || "created_at desc",
      offset: parseInt(q.offset) || 0,
      limit: q.limit ? parseInt(q.limit) : undefined,
      perPage: parseInt(q.perPage) || 250,
      maxPages: q.maxPages ? parseInt(q.maxPages) : undefined,
    });
    return json({ count: pages.length, pages });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 文章详情（含源代码、评分、标签）
route("GET", "/api/pages/:fullname", async (url: URL, fullname: string) => {
  const c = getClient(url);
  try {
    // 1) 请求渲染 HTML，提取 pageId、rating、tags
    const rendered = await c.getRenderedPage(fullname).catch(() => null);

    let pageId: number | null = null;
    let rating = 0;
    let tags: string[] = [];
    let renderedHtml: string | undefined;

    if (rendered) {
      renderedHtml = rendered;
      rating = c.extractRatingFromHtml(rendered);
      tags = c.extractTagsFromHtml(rendered);
      const idMatch = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(rendered);
      if (idMatch) pageId = parseInt(idMatch[1]);
    }

    // 2) HTML 中没找到 pageId 则 fallback
    if (!pageId) {
      pageId = await c.getPageId(fullname);
    }

    // 3) 从 searchPages 获取元数据（含标签，因 module_body 带 %%tags%%）
    const [metaArr] = await Promise.all([
      c.searchPages({
        category: fullname.split("-")[0] || "*",
        limit: 250,
      }),
    ]);
    const meta = metaArr.find((p) => p.fullname === fullname);

    const detail: PageDetail = meta
      ? {
          ...meta,
          page_id: pageId ?? undefined,
          rendered_html: renderedHtml,
          rating: rating || meta.rating,
          tags: tags.length > 0 ? tags : meta.tags,
        }
      : {
          fullname,
          category: fullname.split("-")[0] || "_default",
          name: fullname,
          title: fullname,
          tags,
          rating,
          votes_count: 0,
          comments_count: 0,
          size: 0,
          children_count: 0,
          revisions_count: 0,
          page_id: pageId ?? undefined,
          rendered_html: renderedHtml,
        };

    // 4) 获取源代码
    if (pageId) {
      const src = await c.getPageSource(pageId).catch(() => null);
      detail.source = src ?? undefined;
    }

    return json(detail);
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 文章 Wiki 源代码
route("GET", "/api/pages/:fullname/source", async (url: URL, fullname: string) => {
  const c = getClient(url);
  try {
    const pageId = await c.getPageId(fullname);
    if (!pageId) {
      return error("无法获取页面 ID", 404);
    }
    const source = await c.getPageSource(pageId);
    if (source === null) {
      return error("无法获取页面源代码", 404);
    }
    return new Response(source, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 文章渲染后 HTML
route("GET", "/api/pages/:fullname/rendered", async (url: URL, fullname: string) => {
  const c = getClient(url);
  try {
    const rendered = await c.getRenderedPage(fullname);
    return html(rendered);
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 获取所有分类
route("GET", "/api/categories", async (url: URL) => {
  const c = getClient(url);
  try {
    const allPages = await c.searchPages({
      perPage: 250,
      order: "name asc",
      maxPages: 40,
    });
    const categories = [...new Set(allPages.map((p) => p.category))].sort();
    return json({ categories });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 获取所有标签（方案2：通过 AMC ListPagesModule + module_body 强制获取）
route("GET", "/api/tags", async (url: URL) => {
  const c = getClient(url);
  try {
    const allPages = await c.searchPages({
      perPage: 250,
      order: "name asc",
      maxPages: 40,
      // 使用 pipe 格式，Wikidot 可靠保留 || 分隔符
      moduleBody: "%%fullname%%||%%title%%||%%tags%%||%%rating%%||",
    });
    const tagSet = new Set<string>();
    for (const p of allPages) {
      for (const t of p.tags) tagSet.add(t);
    }
    const tags = [...tagSet].sort();
    return json({ tags });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 站点统计
route("GET", "/api/stats", async (url: URL) => {
  const c = getClient(url);
  try {
    const allPages = await c.searchPages({
      perPage: 250,
      order: "name asc",
      maxPages: 40,
    });
    const categories = new Map<string, number>();
    let totalSize = 0;
    let totalVotes = 0;
    let totalComments = 0;

    for (const p of allPages) {
      categories.set(p.category, (categories.get(p.category) || 0) + 1);
      totalSize += p.size || 0;
      totalVotes += p.votes_count || 0;
      totalComments += p.comments_count || 0;
    }

    return json({
      total_pages: allPages.length,
      total_categories: categories.size,
      categories: Object.fromEntries(categories),
      total_size_bytes: totalSize,
      total_votes: totalVotes,
      total_comments: totalComments,
    });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// ── 请求处理 ─────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  // CORS
  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 速率限制（单 IP 100 RPM）
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = checkRateLimit(ip);
  const rlHeaders: Record<string, string> = {
    "X-RateLimit-Limit": "100",
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000)),
  };
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return new Response(
      JSON.stringify({ error: "Too Many Requests", retry_after_seconds: retryAfter }, null, 2),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": String(retryAfter),
          ...corsHeaders,
          ...rlHeaders,
        },
      }
    );
  }

  // 匹配路由
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (match) {
      const resp = await r.handler(match, url);
      for (const [k, v] of Object.entries(rlHeaders)) {
        resp.headers.set(k, v);
      }
      for (const [k, v] of Object.entries(corsHeaders)) {
        resp.headers.set(k, v);
      }
      return resp;
    }
  }

  return error("Not Found", 404);
}
