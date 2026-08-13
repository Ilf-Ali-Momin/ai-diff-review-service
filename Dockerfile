# Multi stage: the TypeScript toolchain never reaches the running image.
#
# Node 20 rather than the newest release, because that is the runtime the
# service was written and tested against, and a scored window is the wrong
# place to discover a runtime difference.

FROM node:20-slim AS build
WORKDIR /app

# Copied before the sources so a source edit does not invalidate the
# dependency layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The image ships with an unprivileged `node` user. Nothing here needs root,
# and the process writes nothing to disk.
USER node

EXPOSE 3000

# Wired to the contract's own health endpoint, so the platform restarts a hung
# process rather than serving a dead port. Uses the runtime's built in fetch,
# which avoids adding curl to the image for one request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
