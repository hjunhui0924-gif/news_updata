FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# Build-time placeholders only. The runtime stage receives its own mandatory secrets.
RUN APP_MODE=live APP_URL=http://127.0.0.1:3000 \
    BETTER_AUTH_SECRET=build-only-placeholder-never-use-for-login \
    ALLOWED_GITHUB_USER_IDS=0 pnpm build \
    && pnpm prune --prod

FROM postgres:17-alpine AS backup
RUN mkdir -p /backups && chown postgres:postgres /backups
USER postgres

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone/ ./
COPY --from=build --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=build --chown=node:node /app/dist/ ./dist/
COPY --from=build --chown=node:node /app/drizzle/ ./drizzle/
COPY --from=build --chown=node:node /app/deploy/healthcheck.mjs ./deploy/healthcheck.mjs
USER node
EXPOSE 3000
CMD ["node", "server.js"]
