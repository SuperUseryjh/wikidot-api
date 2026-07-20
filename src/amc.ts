/**
 * AMC (Ajax Module Connector) 传输层
 *
 * 处理：限速、token 自动刷新、HTTP POST 到 AMC 端点。
 */

import type { AMCResponse } from "./types.ts";
import { fetchToken } from "./auth.ts";
import { sleep } from "./parser.ts";

export class AmcTransport {
  private site: string;
  private amcUrl: string;
  private lastRequestTime = 0;
  private rateLimitMs: number;
  private token: string | null = null;

  constructor(site: string, rateLimitMs = 300) {
    this.site = site;
    this.amcUrl = `https://${site}.wikidot.com/ajax-module-connector.php`;
    this.rateLimitMs = rateLimitMs;
  }

  /** 获取或刷新 token */
  async refreshToken(): Promise<void> {
    this.token = await fetchToken(this.site);
  }

  private async ensureToken(): Promise<void> {
    if (!this.token) {
      await this.refreshToken();
    }
  }

  /** 发送 AMC POST 请求 */
  async request(params: Record<string, string>): Promise<AMCResponse> {
    await this.ensureToken();

    // 限速
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await sleep(this.rateLimitMs - elapsed);
    }

    params["wikidot_token7"] = this.token!;

    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      formBody.append(k, v);
    }

    const res = await fetch(this.amcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "WikidotAPIService/1.0",
        Cookie: `wikidot_token7=${this.token}`,
      },
      body: formBody.toString(),
    });

    this.lastRequestTime = Date.now();

    if (!res.ok) {
      throw new Error(`AMC HTTP ${res.status}`);
    }

    const data = (await res.json()) as AMCResponse;

    // token 过期，刷新后重试一次
    if (data.status === "wrong_token7") {
      console.log("[AMC] token 过期，刷新重试...");
      await this.refreshToken();
      return this.request({ ...params, wikidot_token7: this.token! });
    }

    if (data.status === "try_again") {
      await sleep(2000);
      return this.request(params);
    }
    if (data.status !== "ok") {
      throw new Error(
        `AMC error: ${data.status}${data.message ? " - " + data.message : ""}`
      );
    }

    return data;
  }
}
