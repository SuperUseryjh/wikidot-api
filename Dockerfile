FROM oven/bun:1 AS build

WORKDIR /app

# 先安装依赖（利用 Docker 缓存）
COPY package.json tsconfig.json ./
RUN bun install --frozen-lockfile

# 复制源码
COPY src/ ./src/

# 直接运行 TypeScript，Bun 原生支持
EXPOSE 3030

CMD ["bun", "src/index.ts"]
