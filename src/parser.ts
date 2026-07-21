/**
 * Wikidot HTML 解析工具
 *
 * 用于解析 ListPagesModule、页面渲染 HTML 等输出。
 */

import type { PageMeta } from "./types.ts";

// ── ListPages 解析 ──────────────────────────────────

/**
 * 通过深度计数提取所有 <div class="list-pages-item"> 内容，
 * 正确处理嵌套 <div> 结构。
 */
export function extractListItems(html: string): string[] {
  const items: string[] = [];
  const startMarker = '<div class="list-pages-item"';
  const openTag = "<div";
  const closeTag = "</div>";
  let pos = 0;

  while (true) {
    const startIdx = html.indexOf(startMarker, pos);
    if (startIdx === -1) break;

    const contentStart = html.indexOf(">", startIdx) + 1;
    if (contentStart === 0) break;

    let depth = 1;
    let i = contentStart;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf(openTag, i);
      const nextClose = html.indexOf(closeTag, i);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 4;
      } else {
        depth--;
        i = nextClose + 6;
      }
    }

    if (depth === 0) {
      items.push(html.substring(contentStart, i - 6));
    }
    pos = i;
  }

  return items;
}

/**
 * 解析 ListPagesModule 的默认输出（无 module_body）。
 * 从 <div class="list-pages-item"> 中提取页面元数据。
 */
export function parseListPagesDefault(html: string): PageMeta[] {
  const pages: PageMeta[] = [];
  const items = extractListItems(html);
  const hasRating = items.some((item) => /page-rate-widget-box/i.test(item));
  if (!hasRating && items.length > 0) {
    console.log(
      `[parseListPages] 警告: ListPages 默认输出不包含评分组件，rating 将显示为 0`
    );
  }

  for (const itemHtml of items) {
    const linkMatch = /<a\s+href="\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(itemHtml);
    if (!linkMatch) continue;

    const fullname = decodeURIComponent(linkMatch[1]);
    const title = linkMatch[2].replace(/<[^>]+>/g, "").trim();

    const category = extractCategory(fullname);
    const ratingMatch = /<span\s+class="number\s+\w+"[^>]*>([+\-]?\d+(?:\.\d+)?)<\/span>/.exec(itemHtml);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    const tags = extractTagsFromHtml(itemHtml);

    const userLinks = itemHtml.match(/<a[^>]+>([^<]+)<\/a>\s*$/m);
    const created_by = userLinks?.[1]?.trim() || undefined;

    pages.push({
      fullname,
      category,
      name: fullname.includes("/") ? fullname.split("/").pop()! : fullname,
      title,
      tags,
      rating,
      votes_count: 0,
      comments_count: 0,
      size: 0,
      children_count: 0,
      revisions_count: 0,
      page_id: undefined,
      created_by,
    } as PageMeta);
  }

  return pages;
}

/**
 * 解析 ListPagesModule 的 pipe 格式输出。
 *
 * 支持两种格式：
 *   3 段：FULLNAME||TITLE||tag1 tag2 ...||
 *   4 段：FULLNAME||TITLE||tag1 tag2 ...||+5||
 *
 * 注意：title 本身可能包含 "||"（如 "Title || With || Pipes"），
 * 因此用正则精确匹配各部分，而不是盲目 split("||")。
 */
export function parseListPagesPipeFormat(html: string): PageMeta[] {
  const pages: PageMeta[] = [];
  const items = extractListItems(html);

  for (const itemHtml of items) {
    const pMatch = /<p>([\s\S]*?)<\/p>/i.exec(itemHtml);
    if (!pMatch) {
      // 没有 <p> 标签时，直接从 itemHtml 匹配 pipe 格式
      const directMatch = itemHtml.trim().match(/^(.+?)\|\|([\s\S]*?)\|\|(.*?)\|\|(.*?)\|\|?$/);
      if (!directMatch) continue;
      const fullname = decodeURIComponent(directMatch[1].trim());
      const title = directMatch[2].trim() || fullname;
      const tags: string[] = [];
      if (directMatch[3].trim()) {
        tags.push(...directMatch[3].trim().split(/\s+/).map((t) => t.trim()).filter(Boolean));
      }
      let rating = 0;
      if (directMatch[4].trim()) {
        const parsed = parseFloat(directMatch[4].trim());
        if (!isNaN(parsed)) rating = parsed;
      }
      const category = extractCategory(fullname);
      pages.push({
        fullname, category,
        name: fullname.includes("/") ? fullname.split("/").pop()! : fullname,
        title, tags, rating,
        votes_count: 0, comments_count: 0, size: 0, children_count: 0, revisions_count: 0, page_id: undefined,
      } as PageMeta);
      continue;
    }

    const content = pMatch[1].trim();
    // FULLNAME||TITLE||TAGS...||[RATING...]||
    const pipeMatch = content.match(/^(.+?)\|\|([\s\S]*?)\|\|(.*?)\|\|(.*?)\|\|?$/);
    if (!pipeMatch) continue;

    const fullname = decodeURIComponent(pipeMatch[1].trim());
    const title = pipeMatch[2].trim() || fullname;

    // 标签（第三部分，以空格分隔）
    const tags: string[] = [];
    if (pipeMatch[3].trim()) {
      tags.push(
        ...pipeMatch[3]
          .trim()
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean)
      );
    }

    // 评分（第四部分，可选）
    let rating = 0;
    if (pipeMatch[4].trim()) {
      const parsed = parseFloat(pipeMatch[4].trim());
      if (!isNaN(parsed)) rating = parsed;
    }

    const category = extractCategory(fullname);

    pages.push({
      fullname,
      category,
      name: fullname.includes("/") ? fullname.split("/").pop()! : fullname,
      title,
      tags,
      rating,
      votes_count: 0,
      comments_count: 0,
      size: 0,
      children_count: 0,
      revisions_count: 0,
      page_id: undefined,
    } as PageMeta);
  }

  return pages;
}

/**
 * 解析 ListPagesModule 的 @@@ 格式输出。
 * 格式: FULLNAME@@@TITLE@@@tag1 tag2 ...@@@
 * 用于 /api/tags 全量扫描，避免 || 分隔符与标题中的 | 冲突。
 */
export function parseListPagesAtatFormat(html: string): PageMeta[] {
  const pages: PageMeta[] = [];
  const items = extractListItems(html);

  for (const itemHtml of items) {
    const pMatch = /<p>([\s\S]*?)<\/p>/i.exec(itemHtml);
    if (!pMatch) continue;
    const content = pMatch[1].trim();
    // FULLNAME@@@TITLE@@@TAGS@@@
    const parts = content.split("@@@").filter(Boolean);
    if (parts.length < 2) continue;

    const fullname = decodeURIComponent(parts[0].trim());
    const title = parts[1].trim() || fullname;

    const tags: string[] = [];
    if (parts.length >= 3 && parts[2].trim()) {
      tags.push(
        ...parts[2]
          .trim()
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean)
      );
    }

    const category = extractCategory(fullname);

    pages.push({
      fullname,
      category,
      name: fullname.includes("/") ? fullname.split("/").pop()! : fullname,
      title,
      tags,
      rating: 0,
      votes_count: 0,
      comments_count: 0,
      size: 0,
      children_count: 0,
      revisions_count: 0,
      page_id: undefined,
    } as PageMeta);
  }

  return pages;
}

/**
 * 自动检测并使用合适的解析器。
 * 检测顺序：HTML+class 格式 → pipe 格式 → 默认格式。
 */
export function parseListPages(html: string): PageMeta[] {
  const items = extractListItems(html);
  if (items.length === 0) return [];

  const firstItem = items[0];
  const first200 = firstItem.slice(0, 200).replace(/\s+/g, " ");

  // 检测 pipe 格式（优先，Wikidot 可靠地保留 || 分隔符）
  const pTagContent = firstItem.match(/<p>([\s\S]*?)<\/p>/i);
  if (pTagContent && pTagContent[1].includes("||")) {
    console.log(`[parseListPages] detected pipe format`);
    return parseListPagesPipeFormat(html);
  }
  if (firstItem.includes("||")) {
    console.log(`[parseListPages] detected pipe format (direct)`);
    return parseListPagesPipeFormat(html);
  }

  // 检测 @@@ 格式
  if (firstItem.includes("@@@")) {
    console.log(`[parseListPages] detected @@@ format`);
    return parseListPagesAtatFormat(html);
  }

  // 检测 HTML+class 格式（<span class="lpfn">）
  if (/<span class="lpfn">/i.test(firstItem)) {
    console.log(`[parseListPages] detected HTML class format`);
    return parseListPagesHtmlFormat(html);
  }

  // 检测 @@@ 格式
  if (firstItem.includes("@@@")) {
    console.log(`[parseListPages] detected @@@ format`);
    return parseListPagesAtatFormat(html);
  }

  console.log(`[parseListPages] using default parser`);
  return parseListPagesDefault(html);
}

/** 从 fullname 提取分类名 */
function extractCategory(fullname: string): string {
  const sepIdx = Math.min(
    ...["-", ":"].map((c) => {
      const idx = fullname.indexOf(c);
      return idx === -1 ? Infinity : idx;
    })
  );
  return sepIdx < Infinity ? fullname.substring(0, sepIdx) : fullname;
}

/**
 * 从分页器 HTML 中提取总页数。
 */
export function getPagerTotal(html: string): number {
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

// ── 页面渲染 HTML 解析 ─────────────────────────────

/**
 * 从完整页面 HTML 中提取评分值。
 */
export function extractRatingFromHtml(html: string): number {
  const widgetMatch = /<div\s+class="page-rate-widget-box"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (widgetMatch) {
    const numMatch = /<span\s+class="number\s+\w+"[^>]*>([+\-]?\d+(?:\.\d+)?)<\/span>/i.exec(
      widgetMatch[1]
    );
    if (numMatch) return parseFloat(numMatch[1]) || 0;
  }
  return 0;
}

/**
 * 从任意 HTML 片段中提取标签列表。
 *
 * 查找 `<div class="page-tags">` 或 `page-tags-box` 内的 `<a>` 标签文本。
 */
export function extractTagsFromHtml(html: string): string[] {
  // 优先匹配 <div class="page-tags">
  const tagsMatch = /<div\s+class="page-tags"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (tagsMatch) {
    const links = tagsMatch[1].matchAll(/<a[^>]*>([^<]+)<\/a>/gi);
    return [...links]
      .map((m) => m[1].trim())
      .filter(Boolean)
      .map((t) => t.replace(/&nbsp;/g, "").trim())
      .filter(Boolean);
  }

  // 备选：找任意带有 rel="tag" 的 <a>
  const relTagLinks = html.matchAll(/<a[^>]*rel="tag"[^>]*>([^<]+)<\/a>/gi);
  const tags = [...relTagLinks]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .map((t) => t.replace(/&nbsp;/g, "").trim())
    .filter(Boolean);

  return tags;
}

// ── 工具 ────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
