FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/projector ./apps/projector
RUN pnpm install --frozen-lockfile
WORKDIR /repo/apps/projector
CMD ["pnpm", "start"]
