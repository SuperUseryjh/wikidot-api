/**
 * Wikidot Token 管理
 */

/**
 * 从站点页面获取真实 wikidot_token7。
 * 优先使用 Set-Cookie 头，其次搜索页面 HTML。
 */
export async function fetchToken(site: string): Promise<string> {
  const baseUrl = `https://${site}.wikidot.com`;
  const res = await fetch(baseUrl, {
    headers: { "User-Agent": "WikidotAPIService/1.0" },
  });
  const html = await res.text();

  // 1) Set-Cookie 头（最可靠）
  const cookieToken = (res.headers.get("set-cookie") || "").match(/wikidot_token7=([a-f0-9]+)/);
  if (cookieToken) return cookieToken[1];

  // 2) <input type="hidden" name="wikidot_token7" value="..." />
  const match1 = html.match(/name=["']wikidot_token7["'][^>]*value=["']([a-f0-9]+)["']/);
  if (match1) return match1[1];

  // 3) WIKIREQUEST.wikidot_token7 = "..."
  const match2 = html.match(/WIKIREQUEST\.wikidot_token7\s*=\s*["']([a-f0-9]+)["']/);
  if (match2) return match2[1];

  // 4) 备选页面
  const fallbackUrl = `${baseUrl}/_default`;
  try {
    const fbRes = await fetch(fallbackUrl, {
      headers: { "User-Agent": "WikidotAPIService/1.0" },
    });
    const fbCookie = (fbRes.headers.get("set-cookie") || "").match(/wikidot_token7=([a-f0-9]+)/);
    if (fbCookie) return fbCookie[1];
  } catch {
    // fallthrough
  }

  throw new Error("无法获取 wikidot_token7");
}
