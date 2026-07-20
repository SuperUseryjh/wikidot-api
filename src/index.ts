/**
 * Wikidot API 服务入口
 *
 * 启动: bun src/index.ts
 * 服务端口: 3030（可通过 PORT 环境变量配置）
 */

import { handler } from "./routes.ts";

const PORT = parseInt(process.env.PORT || "3030");
const SITE = process.env.WIKIDOT_SITE || "mc-anomaly-archives";

console.log(`\n🚀 Wikidot API Service`);
console.log(`   Site: https://${SITE}.wikidot.com`);
console.log(`   Server: http://0.0.0.0:${PORT}\n`);

Bun.serve({ port: PORT, fetch: handler, idleTimeout: 255 });
