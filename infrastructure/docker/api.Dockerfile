FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./
RUN pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "dev:api"]
