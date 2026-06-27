FROM mcr.microsoft.com/playwright:v1.45.1-jammy

WORKDIR /app
RUN npm install -g pnpm@9.5.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/session-vault/package.json packages/session-vault/package.json
COPY packages/provider-adapters/package.json packages/provider-adapters/package.json
COPY prisma prisma
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages
RUN pnpm exec prisma generate && pnpm --filter @uaiw/api... build
RUN mkdir -p /app/.data/browser-profiles && chown -R pwuser:pwuser /app/.data /app/prisma

ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ARG BUILD_SOURCE=docker

ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
ENV BUILD_SOURCE=$BUILD_SOURCE

USER pwuser
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
