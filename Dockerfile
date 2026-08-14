# Codeman container image (root Dockerfile).
#
# Builds Codeman from the source on the current branch and runs the web server.
# node-pty compiles from source on Linux (no prebuilt binaries), so the builder
# stage carries the full C++ toolchain; the runtime stage stays slim.
#
# Note: .npmrc sets `include=dev`, so the explicit `--include=prod` on the prune
# step is what actually trims dev dependencies from the runtime stage.

FROM node:22-bookworm-slim AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      curl \
      ca-certificates \
      python3 \
      make \
      g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY scripts/postinstall.js scripts/postinstall.js
COPY packages packages

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      tmux \
      curl \
      ca-certificates \
      procps \
      openssh-client \
 && rm -rf /var/lib/apt/lists/*

ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app ./

RUN npm prune --include=prod

EXPOSE 3000

CMD ["node", "dist/index.js", "web"]
