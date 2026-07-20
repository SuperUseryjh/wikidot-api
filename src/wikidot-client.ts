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
  page_id?: number;
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
    "fullname", "category", "name", "title", "page_id",
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

        if (["comments", "size", "children", "rating_votes", "revisions", "page_id"].includes(key)) {
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
    // 策略 1：通过 searchPages 搜索 ListPagesModule，尝试从模板变量 %page_id% 直接获取
    try {
      const category = fullname.includes(":") ? fullname.split(":")[0] : fullname.split("-")[0];
      console.log(`[getPageId] 策略1 searchPages category=${category}`);
      const pages = await this.searchPages({ category, perPage: 250 });
      const found = pages.find((p) => p.fullname === fullname);
      if (found && found.page_id) {
        console.log(`[getPageId] 策略1 成功, pageId=${found.page_id}`);
        return found.page_id;
      }
      if (found) {
        console.log(`[getPageId] 策略1 找到页面但 page_id 为空: ${JSON.stringify(found)}`);
      } else {
        console.log(`[getPageId] 策略1 在 category=${category} 下未找到, 改用全分类搜索`);
        // 再试全分类搜索
        const allPages = await this.searchPages({ category: "*", perPage: 250 });
        const foundAll = allPages.find((p) => p.fullname === fullname);
        if (foundAll && foundAll.page_id) {
          console.log(`[getPageId] 策略1 全分类搜索成功, pageId=${foundAll.page_id}`);
          return foundAll.page_id;
        }
        if (foundAll) {
          console.log(`[getPageId] 策略1 全分类找到页面但 page_id 为空: ${JSON.stringify(foundAll)}`);
        } else {
          console.log(`[getPageId] 策略1 全分类也未找到 fullname=${fullname}`);
          // 打印前20个fullname看看实际页面命名格式
          console.log(`[getPageId] 前20个页面: ${allPages.slice(0, 20).map(p => p.fullname).join(", ")}`);
        }
      }
    } catch (e: any) {
      console.log(`[getPageId] 策略1 异常: ${e.message}`);
    }

    // 策略 2：通过 PageFlowAction 直接查询
    const pageFlowUrl = `${this.baseUrl}/default/flow/PageFlowAction?pageName=${encodeURIComponent(fullname)}&norender=true&noredirect=true`;
    try {
      console.log(`[getPageId] 策略2 URL: ${pageFlowUrl}`);
      const res = await fetch(pageFlowUrl, {
        headers: { "User-Agent": "WikidotAPIService/1.0" },
      });
      const html = await res.text();
      console.log(`[getPageId] 策略2 状态=${res.status} 响应长度=${html.length}`);
      const idMatch = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (idMatch) {
        console.log(`[getPageId] 策略2 成功, pageId=${idMatch[1]}`);
        return parseInt(idMatch[1]);
      }
      const fallback = /page_id=(\d+)/.exec(html);
      if (fallback) {
        console.log(`[getPageId] 策略2 备选成功, pageId=${fallback[1]}`);
        return parseInt(fallback[1]);
      }
      console.log(`[getPageId] 策略2 未找到 pageId`);
    } catch (e: any) {
      console.log(`[getPageId] 策略2 异常: ${e.message}`);
    }

    // 策略 3：直接请求页面 URL
    try {
      const url3 = `${this.baseUrl}/${fullname}`;
      console.log(`[getPageId] 策略3 URL: ${url3}`);
      const res = await fetch(url3, {
        headers: { "User-Agent": "WikidotAPIService/1.0" },
      });
      const html = await res.text();
      console.log(`[getPageId] 策略3 状态=${res.status} 响应长度=${html.length}`);
      const idMatch = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (idMatch) {
        console.log(`[getPageId] 策略3 成功, pageId=${idMatch[1]}`);
        return parseInt(idMatch[1]);
      }
      const fallback = /page_id=(\d+)/.exec(html);
      if (fallback) {
        console.log(`[getPageId] 策略3 备选成功, pageId=${fallback[1]}`);
        return parseInt(fallback[1]);
      }
      console.log(`[getPageId] 策略3 未找到 pageId`);
    } catch (e: any) {
      console.log(`[getPageId] 策略3 异常: ${e.message}`);
    }

    // 策略 4：带 norender/noredirect 的 URL
    try {
      const url4 = `${this.baseUrl}/${fullname}/norender/true/noredirect/true`;
      console.log(`[getPageId] 策略4 URL: ${url4}`);
      const res = await fetch(url4, {
        headers: { "User-Agent": "WikidotAPIService/1.0" },
      });
      const html = await res.text();
      console.log(`[getPageId] 策略4 状态=${res.status} 响应长度=${html.length}`);
      const idMatch = /WIKIREQUEST\.info\.pageId\s*=\s*(\d+)\s*;/.exec(html);
      if (idMatch) {
        console.log(`[getPageId] 策略4 成功, pageId=${idMatch[1]}`);
        return parseInt(idMatch[1]);
      }
      const fallback = /page_id=(\d+)/.exec(html);
      if (fallback) {
        console.log(`[getPageId] 策略4 备选成功, pageId=${fallback[1]}`);
        return parseInt(fallback[1]);
      }
      console.log(`[getPageId] 策略4 未找到 pageId`);
    } catch (e: any) {
      console.log(`[getPageId] 策略4 异常: ${e.message}`);
    }

    console.log(`[getPageId] 所有策略均失败, fullname=${fullname}`);
    return null;
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
