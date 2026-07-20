/**
 * Wikidot API 路由定义
 */

import { WikidotClient } from "./client.ts";
import type { PageDetail } from "./types.ts";

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

// 首页 / 健康检查
route("GET", "/", async () => {
  return json({
    service: "Wikidot API Service",
    site: `https://${DEFAULT_SITE}.wikidot.com`,
    version: "1.0.0",
    common_params: {
      wiki:
        "（可选）指定 Wikidot 站点，如 ?wiki=scp-wiki 或 ?wiki=https://scp-wiki.wikidot.com，默认 mc-anomaly-archives",
    },
    endpoints: {
      "GET /api/pages?wiki=...&category=co&tags=...&order=...&limit=...":
        "搜索文章列表",
      "GET /api/pages/:fullname?wiki=...": "获取文章详情（含源代码）",
      "GET /api/pages/:fullname/source?wiki=...": "获取文章 Wiki 源代码",
      "GET /api/pages/:fullname/rendered?wiki=...": "获取渲染后 HTML",
      "GET /api/categories?wiki=...": "获取所有分类列表",
      "GET /api/tags?wiki=...": "获取所有标签",
      "GET /api/stats?wiki=...": "站点统计",
    },
  });
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

  if (method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
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
