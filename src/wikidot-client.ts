/**
 * Wikidot Ajax Module Connector (AMC) 客户端
 *
 * 基于逆向工程协议：
 *   POST https://{site}.wikidot.com/ajax-module-connector.php
 *   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *   Cookie: wikidot_token7=123456
 *   Body: moduleName=...&wikidot_token7=123456&...
 */

export interface PageMeta {
  fullname: string;
  category: string;
  name: string;
  title: string;
  created_at?: string;
  created_by?: string;
  updated_at?: string;
  updated_by?: string;
  tags: string[];
  rating: number;
  votes_count: number;
  comments_count: number;
  size: number;
  children_count: number;
  revisions_count: number;
  parent_fullname?: string;
}

export interface PageDetail extends PageMeta {
  source?: string;
  rendered_html?: string;
  page_id?: number;
}

interface AMCResponse {
  status: string;
  body: string;
  message?: string;
  CURRENT_TIMESTAMP?: number;
}

// 默认 module_body，用于从 ListPages 获取所有元数据字段
const DEFAULT_MODULE_BODY =
  '[[div class="page"]]' +
  [
    "fullname", "category", "name", "title",
    "created_at", "created_by_linked",
    "updated_at", "updated_by_linked",
    "commented_at", "commented_by_linked",
    "parent_fullname", "comments", "size",
    "children", "rating_votes", "rating",
    "rating_percent", "revisions", "tags", "_tags",
  ]
    .map(
      (key) =>
        `[[span class="set ${key}"]]` +
        `[[span class="name"]]${key}[[/span]]` +
        `[[span class="value"]]%${key}%[[/span]]` +
        `[[/span]]`
    )
    .join("") +
  "[[/div]]";

export class WikidotClient {
  private site: string;
  private baseUrl: string;
  private amcUrl: string;
  private lastRequestTime = 0;
  private rateLimitMs: number;

  constructor(site = "mc-anomaly-archives", rateLimitMs = 300) {
    this.site = site;
    this.baseUrl = `https://${site}.wikidot.com`;
    this.amcUrl = `https://${site}.wikidot.com/ajax-module-connector.php`;
    this.rateLimitMs = rateLimitMs;
  }

  // ── 底层 AMC 请求 ─────────────────────────────────────

  private async amcRequest(params: Record<string, string>): Promise<AMCResponse> {
    // 限速
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await sleep(this.rateLimitMs - elapsed);
    }

    // 注入 token
    params["wikidot_token7"] = "123456";

    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      formBody.append(k, v);
    }

    const res = await fetch(this.amcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "WikidotAPIService/1.0",
        Cookie: "wikidot_token7=123456",
      },
      body: formBody.toString(),
    });

    this.lastRequestTime = Date.now();

    if (!res.ok) {
      throw new Error(`AMC HTTP ${res.status}`);
    }

    const data = (await res.json()) as AMCResponse;

    if (data.status === "try_again") {
      await sleep(2000);
      return this.amcRequest(params);
    }
    if (data.status !== "ok") {
      throw new Error(`AMC error: ${data.status}${data.message ? " - " + data.message : ""}`);
    }

    return data;
  }

  // ── 搜索页面列表 ─────────────────────────────────────

  async searchPages(opts: {
    category?: string;
    tags?: string | string[];
    order?: string;
    offset?: number;
    limit?: number;
    perPage?: number;
  } = {}): Promise<PageMeta[]> {
    const {
      category = "*",
      tags,
      order = "created_at desc",
      offset = 0,
      limit,
      perPage = 250,
    } = opts;

    const query: Record<string, string> = {
      moduleName: "list/ListPagesModule",
      category,
      order,
      offset: String(offset),
      perPage: String(perPage),
      separate: "no",
      wrapper: "no",
      pager: "on",
      module_body: DEFAULT_MODULE_BODY,
    };

    if (tags) {
      query.tags = Array.isArray(tags) ? tags.join(" ") : tags;
    }
    if (limit !== undefined) {
      query.limit = String(limit);
    }

    // 第一页
    const resp = await this.amcRequest(query);
    const allPages = this.parseListPages(resp.body);

    // 分页
    const totalPages = this.getPagerTotal(resp.body);
    for (let i = 1; i < totalPages; i++) {
      const q = { ...query, offset: String(i * perPage) };
      const pageResp = await this.amcRequest(q);
      allPages.push(...this.parseListPages(pageResp.body));
    }

    return allPages;
  }

  // ── 解析 ListPages HTML ──────────────────────────────

  private parseListPages(html: string): PageMeta[] {
    const pages: PageMeta[] = [];

    // 匹配每个 <div class="page">...</div>
    const pageRegex = /<div\s+class="page"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
    let match: RegExpExecArray | null;

    while ((match = pageRegex.exec(html)) !== null) {
      const divContent = match[1];
      const page: Record<string, any> = { tags: [] };

      // 提取所有 set 字段
      const setRegex =
        /<span\s+class="set\s+(\w+)"[^>]*>[\s\S]*?<span\s+class="value">([\s\S]*?)<\/span>/g;
      let setMatch: RegExpExecArray | null;
      while ((setMatch = setRegex.exec(divContent)) !== null) {
        const key = setMatch[1];
        let value = setMatch[2]
          .replace(/<[^>]+>/g, "") // 去 HTML 标签
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();

        if (["comments", "size", "children", "rating_votes", "revisions"].includes(key)) {
          value = parseInt(value) || 0;
        } else if (key === "rating") {
          value = parseFloat(value) || 0;
        } else if (key === "tags" || key === "_tags") {
          page.tags = [...(page.tags || []), ...(value ? value.split(/\s+/) : [])];
          continue; // 已处理，跳过
        }

        // 重命名键
        const mappedKey = this.mapKey(key);
        page[mappedKey] = value;
      }

      if (page.fullname) {
        pages.push(page as PageMeta);
      }
    }

    return pages;
  }

  private mapKey(key: string): string {
    const map: Record<string, string> = {
      created_by_linked: "created_by",
      updated_by_linked: "updated_by",
      commented_by_linked: "commented_by",
      rating_votes: "votes_count",
      comments: "comments_count",
      children: "children_count",
      revisions: "revisions_count",
    };
    return map[key] || key;
  }

  private getPagerTotal(html: string): number {
    const pagerMatch = /<div\s+class="pager"[^>]*>([\s\S]*?)<\/div>/.exec(html);
    if (!pagerMatch) return 1;

    const targets: number[] = [];
    const targetRegex = /<span\s+class="target"[^>]*>\s*<a[^>]*>(\d+)<\/a>\s*<\/span>/g;
    let m: RegExpExecArray | null;
    while ((m = targetRegex.exec(pagerMatch[1])) !== null) {
      targets.push(parseInt(m[1]));
    }
    return targets.length > 0 ? targets[targets.length - 1] : 1;
  }

  // ── 获取页面 ID ──────────────────────────────────────

  async getPageId(fullname: string): Promise<number | null> {
    const url = `${this.baseUrl}/${fullname}/norender/true/noredirect/true`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "WikidotAPIService/1.0" },
      });
      const html = await res.text();

      // WIKIREQUEST.info.pageId = <数字>;
      const idMatch = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (idMatch) return parseInt(idMatch[1]);

      // 备选
      const fallback = /page_id=(\d+)/.exec(html);
      if (fallback) return parseInt(fallback[1]);

      return null;
    } catch {
      return null;
    }
  }

  // ── 获取页面 wiki 源代码 ─────────────────────────────

  async getPageSource(pageId: number): Promise<string | null> {
    const resp = await this.amcRequest({
      moduleName: "viewsource/ViewSourceModule",
      page_id: String(pageId),
    });

    const sourceMatch = /<div\s+class="page-source"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(
      resp.body
    );
    if (sourceMatch) return sourceMatch[1].trim();

    const fallback = /<div\s+class="page-source"[^>]*>([\s\S]*?)<\/div>/.exec(resp.body);
    return fallback ? fallback[1].trim() : resp.body.trim();
  }

  // ── 获取渲染后 HTML ─────────────────────────────────

  async getRenderedPage(fullname: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/${fullname}`, {
      headers: { "User-Agent": "WikidotAPIService/1.0" },
    });
    return res.text();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
