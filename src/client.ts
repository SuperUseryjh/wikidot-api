/**
 * Wikidot API 客户端
 *
 * 提供 AMC 协议之上的高级 API：搜索页面、获取页面 ID、源码、渲染 HTML。
 */

import type { PageMeta, SearchPagesOptions } from "./types.ts";
import { AmcTransport } from "./amc.ts";
import { parseListPages, getPagerTotal, extractTagsFromHtml, extractRatingFromHtml } from "./parser.ts";

export class WikidotClient {
  private site: string;
  private baseUrl: string;
  private amc: AmcTransport;

  constructor(site = "mc-anomaly-archives", rateLimitMs = 300) {
    this.site = site;
    this.baseUrl = `https://${site}.wikidot.com`;
    this.amc = new AmcTransport(site, rateLimitMs);
  }

  // ── 搜索页面列表 ─────────────────────────────────────

  async searchPages(opts: SearchPagesOptions = {}): Promise<PageMeta[]> {
    const { category: rawCategory = "*", tags, order = "created_at desc", offset = 0, limit, perPage = 250, maxPages = 0, moduleBody } = opts;

    // 始终请求全部分类，后面在客户端侧过滤
    const query: Record<string, string> = {
      moduleName: "list/ListPagesModule",
      category: "*",
      order,
      offset: String(offset),
      perPage: String(perPage),
      pager: "on",
    };

    // 显式传入的 moduleBody 优先（仅 /api/tags 全量扫描）
    if (moduleBody) {
      query.module_body = moduleBody;
    }

    // 标签搜索：服务端过滤 + pipe 格式输出以包含 tags 字段
    if (tags) {
      query.tags = Array.isArray(tags) ? tags.join(" ") : tags;
      // 默认 ListPages 输出不包含 %%tags%% 字段，使用 pipe 格式展示标签
      if (!moduleBody) {
        query.module_body = "%%fullname%%||%%title%%||%%tags%%||%%rating%%||";
      }
    }
    if (limit !== undefined) query.limit = String(limit);

    console.log(`[searchPages] 请求 category="*" perPage=${perPage} tags=${tags || "none"}`);
    const resp = await this.amc.request(query);
    const allPages = parseListPages(resp.body);
    console.log(`[searchPages] 第 1 页: ${allPages.length} 条`);

    let totalPages = getPagerTotal(resp.body);
    const effectiveMaxPages = maxPages > 0 ? maxPages : limit !== undefined ? Math.ceil(limit / perPage) : 0;
    if (effectiveMaxPages > 0 && totalPages > effectiveMaxPages) totalPages = effectiveMaxPages;

    for (let i = 1; i < totalPages; i++) {
      const q = { ...query, offset: String(i * perPage) };
      const pageResp = await this.amc.request(q);
      const pageItems = parseListPages(pageResp.body);
      allPages.push(...pageItems);
      console.log(`[searchPages] 第 ${i + 1} 页: ${pageItems.length} 条`);
    }

    // ── 客户端侧过滤（仅 category）──
    // 注意：tags 由 Wikidot 服务端过滤，不在客户端重复过滤，
    // 因为默认 ListPages 输出中 tags 字段不可靠（始终为空数组）。

    // 1) 分类过滤
    if (rawCategory && rawCategory !== "*") {
      const before = allPages.length;
      for (let i = allPages.length - 1; i >= 0; i--) {
        if (allPages[i].category !== rawCategory) {
          allPages.splice(i, 1);
        }
      }
      console.log(`[searchPages] 分类 "${rawCategory}" 过滤: ${before} → ${allPages.length} 条`);
    }

    // 2) 应用 limit
    if (limit !== undefined && allPages.length > limit) {
      allPages.splice(limit);
    }

    return allPages;
  }

  // ── 获取页面 ID ──────────────────────────────────────

  async getPageId(fullname: string): Promise<number | null> {
    // 策略 1：直接请求页面 URL
    try {
      const url = `${this.baseUrl}/${fullname}`;
      const res = await fetch(url, { headers: { "User-Agent": "WikidotAPIService/1.0" } });
      if (res.ok) {
        const html = await res.text();
        const m = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
        if (m) return parseInt(m[1]);
        const f = /page_id=(\d+)/.exec(html);
        if (f) return parseInt(f[1]);
      }
    } catch { /* fallthrough */ }

    // 策略 2：PageFlowAction
    try {
      const url = `${this.baseUrl}/default/flow/PageFlowAction?pageName=${encodeURIComponent(fullname)}&norender=true&noredirect=true`;
      const res = await fetch(url, { headers: { "User-Agent": "WikidotAPIService/1.0" } });
      const html = await res.text();
      const m = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (m) return parseInt(m[1]);
      const f = /page_id=(\d+)/.exec(html);
      if (f) return parseInt(f[1]);
    } catch { /* fallthrough */ }

    // 策略 3：norender/noredirect URL
    try {
      const url = `${this.baseUrl}/${fullname}/norender/true/noredirect/true`;
      const res = await fetch(url, { headers: { "User-Agent": "WikidotAPIService/1.0" } });
      const html = await res.text();
      const m = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (m) return parseInt(m[1]);
      const f = /page_id=(\d+)/.exec(html);
      if (f) return parseInt(f[1]);
    } catch { /* fallthrough */ }

    return null;
  }

  // ── 获取页面 wiki 源代码 ─────────────────────────────

  async getPageSource(pageId: number): Promise<string | null> {
    const resp = await this.amc.request({ moduleName: "viewsource/ViewSourceModule", page_id: String(pageId) });
    const m = /<div\s+class="page-source"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(resp.body);
    if (m) return m[1].trim();
    const f = /<div\s+class="page-source"[^>]*>([\s\S]*?)<\/div>/.exec(resp.body);
    return f ? f[1].trim() : resp.body.trim();
  }

  // ── 获取渲染后 HTML ─────────────────────────────────

  async getRenderedPage(fullname: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/${fullname}`, {
      headers: { "User-Agent": "WikidotAPIService/1.0" },
    });
    return res.text();
  }

  // ── 公共解析方法 ────────────────────────────────────

  extractRatingFromHtml(html: string): number {
    return extractRatingFromHtml(html);
  }

  extractTagsFromHtml(html: string): string[] {
    return extractTagsFromHtml(html);
  }
}
