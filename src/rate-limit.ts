/**
 * 基于 IP 的速率限制（固定窗口）
 *
 * 策略：每个 IP 每分钟最多 100 次请求，超过返回 429。
 * 过期条目每 60s 自动清理，防止内存泄漏。
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // unix ms
}

const WINDOW_MS = 60_000; // 1 分钟窗口
const MAX_RPM = 100;

const counters = new Map<string, { count: number; resetAt: number }>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of counters) {
      if (now >= entry.resetAt) counters.delete(ip);
    }
    // 如果全清空了，取消定时器
    if (counters.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, WINDOW_MS);
}

/**
 * 检查给定 IP 是否允许请求。
 * 如果超过限制，返回 allowed=false，并携带重置时间。
 */
export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  let entry = counters.get(ip);

  // 无记录 或 窗口已过 → 新建窗口
  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS };
    counters.set(ip, entry);
    ensureCleanup();
    return { allowed: true, remaining: MAX_RPM - 1, resetAt: entry.resetAt };
  }

  entry.count++;

  if (entry.count > MAX_RPM) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: MAX_RPM - entry.count,
    resetAt: entry.resetAt,
  };
}
