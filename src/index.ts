/**
 * Wikidot API 服务
 *
 * 提供 https://mc-anomaly-archives.wikidot.com 的文章获取 API
 *
 * 启动: bun src/index.ts
 * 服务端口: 3030
 */

import { WikidotClient, type PageMeta, type PageDetail } from "./wikidot-client.ts";

const PORT = parseInt(process.env.PORT || "3030");
const SITE = process.env.WIKIDOT_SITE || "mc-anomaly-archives";

const client = new WikidotClient(SITE);

// ── 工具函数 ──────────────────────────────────────────

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

/** 从 URL 的 ?wiki= 参数获取 Wikidot 站点名称，未指定则返回默认 client */
function getClient(url?: URL): WikidotClient {
  if (!url) return client;
  const wiki = url.searchParams.get("wiki");
  if (!wiki) return client;
  let site = wiki.trim();
  site = site.replace(/^https?:\/\//, "").replace(/\.wikidot\.com$/, "").replace(/\/+$/, "");
  if (!site) return client;
  return new WikidotClient(site);
}

// ── 路由分发 ──────────────────────────────────────────

const routes: Array<{
  method: string;
  pattern: RegExp;
  params: string[];
  handler: (match: RegExpExecArray, url: URL) => Promise<Response>;
}> = [];

function route(method: string, path: string, handler: (url: URL, ...args: string[]) => Promise<Response>) {
  // 将 :param 替换为命名捕获组
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

// ── 定义 API 端点 ─────────────────────────────────────

// 首页 / 健康检查
route("GET", "/", async () => {
  return json({
    service: "Wikidot API Service",
    site: `https://${SITE}.wikidot.com`,
    version: "1.0.0",
    endpoints: {
      "GET /": "服务信息",
      "GET /api/pages": "搜索文章列表 ?category=co&tags=原创&order=created_at+desc&limit=10",
      "GET /api/pages/:fullname": "获取文章详情（含源代码）",
      "GET /api/pages/:fullname/source": "获取文章 Wiki 源代码",
      "GET /api/pages/:fullname/rendered": "获取渲染后 HTML",
      "GET /api/categories": "获取所有分类列表",
      "GET /api/tags": "获取所有标签",
      "GET /api/stats": "站点统计",
    },
    params: {
      wiki: "（可选）指定 Wikidot 站点域名，如 ?wiki=https://scp-wiki.wikidot.com 或 ?wiki=scp-wiki，默认 mc-anomaly-archives",
    },
  });
});

// 搜索文章列表（实际处理在 handleSearchPages）
route("GET", "/api/pages", async () => {
  return json({ error: "use /api/pages with query params" });
});

// 文章详情（含源代码）
route("GET", "/api/pages/:fullname", async (url: URL, fullname: string) => {
  const c = getClient(url);
  try {
    const [metaArr] = await Promise.all([
      c.searchPages({ category: fullname.split("-")[0] || "*", limit: 250 }),
    ]);

    const meta = metaArr.find((p) => p.fullname === fullname);
    if (!meta) {
      // 直接获取渲染页面和 page_id
      const [pageId, rendered] = await Promise.all([
        c.getPageId(fullname),
        c.getRenderedPage(fullname).catch(() => null),
      ]);

      const detail: PageDetail = {
        fullname,
        category: fullname.split("-")[0] || "_default",
        name: fullname,
        title: fullname,
        tags: [],
        rating: 0,
        votes_count: 0,
        comments_count: 0,
        size: 0,
        children_count: 0,
        revisions_count: 0,
        page_id: pageId ?? undefined,
        rendered_html: rendered ?? undefined,
      };

      if (pageId) {
        const source = await c.getPageSource(pageId).catch(() => null);
        detail.source = source ?? undefined;
      }

      return json(detail);
    }

    const [pageId, source] = await Promise.all([
      c.getPageId(fullname),
      c.getPageSource(0).catch(() => null),
    ]);

    const detail: PageDetail = { ...meta };
    if (pageId) {
      detail.page_id = pageId;
      const s = await c.getPageSource(pageId).catch(() => null);
      detail.source = s ?? undefined;
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
    const allPages = await c.searchPages({ perPage: 250, order: "name asc" });
    const categories = [...new Set(allPages.map((p) => p.category))].sort();
    return json({ categories });
  } catch (e: any) {
    return error(e.message, 500);
  }
});

// 获取所有标签
route("GET", "/api/tags", async (url: URL) => {
  const c = getClient(url);
  try {
    const allPages = await c.searchPages({ perPage: 250, order: "name asc" });
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
    const allPages = await c.searchPages({ perPage: 250, order: "name asc" });
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

// ── /api/pages 查询处理 ──────────────────────────────

async function handleSearchPages(url: URL): Promise<Response> {
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
    });
    return json({ count: pages.length, pages });
  } catch (e: any) {
    return error(e.message, 500);
  }
}

// ── 服务器主循环 ──────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  // CORS 头
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 特殊处理 /api/pages（无 :fullname）
  if (method === "GET" && path === "/api/pages") {
    const resp = await handleSearchPages(url);
    for (const [k, v] of Object.entries(corsHeaders)) {
      resp.headers.set(k, v);
    }
    return resp;
  }

  // 匹配路由
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (match) {
      const resp = await r.handler(match, url);
      for (const [k, v] of Object.entries(corsHeaders)) {
        resp.headers.set(k, v);
      }
      return resp;
    }
  }

  return error("Not Found", 404);
}

// ── 启动 ──────────────────────────────────────────────

console.log(`\n🚀 Wikidot API Service`);
console.log(`   Site: https://${SITE}.wikidot.com`);
console.log(`   Server: http://0.0.0.0:${PORT}\n`);

Bun.serve({ port: PORT, fetch: handler });
