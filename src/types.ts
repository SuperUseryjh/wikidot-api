/**
 * Wikidot API 类型定义
 */

/** 页面元数据（来自 ListPagesModule） */
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

/** 页面详情（含源代码和渲染 HTML） */
export interface PageDetail extends PageMeta {
  source?: string;
  rendered_html?: string;
  page_id?: number;
}

/** searchPages 选项 */
export interface SearchPagesOptions {
  category?: string;
  tags?: string | string[];
  order?: string;
  offset?: number;
  limit?: number;
  perPage?: number;
  maxPages?: number;
  /** 自定义 module_body（仅用于 /api/tags 全量扫描，会影响 category/tags 过滤） */
  moduleBody?: string;
}

/** AMC 响应体 */
export interface AMCResponse {
  status: string;
  body: string;
  message?: string;
  CURRENT_TIMESTAMP?: number;
}
