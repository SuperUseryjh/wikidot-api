# Wikidot API

基于 [Bun](https://bun.sh) 的 Wikidot RESTful API 服务，提供对 Wikidot 站点内容的程序化访问。

在线示例：[https://wiki-api.yaoonion.fun](https://wiki-api.yaoonion.fun)

## 功能

- **页面搜索** — 按分类、标签、排序搜索 Wikidot 站点页面
- **页面详情** — 获取页面元数据、Wiki 源代码、渲染后 HTML
- **分类/标签枚举** — 获取站点所有分类和标签列表
- **站点统计** — 页面总数、分类分布、总大小等统计信息
- **多站点支持** — 通过 `?wiki=` 参数查询任意 Wikidot 站点
- **速率限制** — 内置基于 IP 的速率限制（100 RPM）
- **自动限速** — AMC 请求间自动间隔，避免触发 Wikidot 反爬机制
- **Token 管理** — 自动获取和刷新 `wikidot_token7`，支持过期重试
- **自文档化** — 根路径 `/` 提供交互式 API 文档页面

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | API 文档 |
| GET | `/api/pages` | 搜索文章列表 |
| GET | `/api/pages/:fullname` | 文章详情（含源代码、评分、标签） |
| GET | `/api/pages/:fullname/source` | Wiki 源代码 |
| GET | `/api/pages/:fullname/rendered` | 渲染后 HTML |
| GET | `/api/categories` | 所有分类 |
| GET | `/api/tags` | 所有标签 |
| GET | `/api/stats` | 站点统计 |

所有端点（除 `/` 外）支持通用查询参数 `?wiki=` 指定目标站点。

## 快速开始

### 前置要求

- [Bun](https://bun.sh) >= 1.0

### 安装与运行

```bash
# 安装依赖
bun install

# 启动开发模式（文件变化自动重启）
bun run dev

# 或直接启动
bun run start
```

服务默认监听 `http://0.0.0.0:3030`。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3030` | 服务监听端口 |
| `WIKIDOT_SITE` | `mc-anomaly-archives` | 默认 Wikidot 站点名 |

### Docker

```bash
# 构建
docker compose build

# 启动
docker compose up -d
```

## 使用示例

```bash
# 搜索文章
curl "http://localhost:3030/api/pages?category=co&limit=5"

# 指定非默认站点
curl "http://localhost:3030/api/pages?wiki=scp-wiki&category=scp&limit=3"

# 获取文章详情
curl "http://localhost:3030/api/pages/co-1"

# 获取 Wiki 源代码
curl "http://localhost:3030/api/pages/co-1/source"

# 获取所有标签
curl "http://localhost:3030/api/tags"

# 站点统计
curl "http://localhost:3030/api/stats"
```

## 项目结构

```
wikidot-api/
├── src/
│   ├── index.ts       # 服务入口
│   ├── routes.ts      # 路由定义 & API 文档页面
│   ├── client.ts      # Wikidot 高级 API 客户端
│   ├── amc.ts         # AMC 传输层（限速、Token、HTTP POST）
│   ├── auth.ts        # Token 获取与刷新
│   ├── parser.ts      # HTML 解析工具
│   ├── rate-limit.ts  # 基于 IP 的速率限制
│   └── types.ts       # 类型定义
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```
