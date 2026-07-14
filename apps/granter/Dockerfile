FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/granter ./apps/granter
RUN pnpm install --frozen-lockfile
WORKDIR /repo/apps/granter
CMD ["pnpm", "start"]
