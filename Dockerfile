# Codeman container image (root Dockerfile).
#
# Builds Codeman from the source on the current branch and runs the web server.
# node-pty compiles from source on Linux (no prebuilt binaries), so the builder
# stage carries the full C++ toolchain; the runtime stage stays slim.
#
# Note: .npmrc sets `include=dev` for the builder's `npm ci`. The deploy stage
# deliberately does NOT copy .npmrc — its `include=dev` would otherwise cancel
# out `--omit=dev` on the prune step and leave the dev tree in the image.

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

# Trims node_modules down to production-only BEFORE the runtime COPY, so the
# deleted dev/optional bytes never land in a final image layer (pruning after
# the COPY, as the previous Dockerfile did, left them in the layer underneath).
FROM node:22-bookworm-slim AS deploy

WORKDIR /app

# No .npmrc here on purpose (see the note at the top): its `include=dev` would
# defeat `--omit=dev`. `--ignore-scripts` keeps the prune from running the root
# postinstall (which needs scripts/postinstall.js, not shipped to this stage).
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# `--omit=dev --omit=optional` drops the ~1GB dev tree + the ~75MB @remotion/
# @rspack build-only native deps. The workspace symlinks point into packages/
# (build-time only; their output is bundled into dist/web/public/vendor) and
# @mediapipe is an orphaned dep of the gesture-control workspace — none are
# needed at runtime, so drop them along with the dangling links.
RUN npm prune --omit=dev --omit=optional --ignore-scripts \
 && rm -f node_modules/codeman-gesture-control node_modules/xterm-zerolag-input \
 && rm -rf node_modules/@mediapipe

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
# Self-update (git pull + npm build + systemd/launchd restart) is a host-only
# feature; this image is immutable and runs no supervisor, so disable the dead
# UI path instead of advertising a button that cannot work in a container.
ENV CODEMAN_DISABLE_SELF_UPDATE=1

WORKDIR /app

# Only what `node dist/index.js web` actually loads at runtime:
#   node_modules            -> production deps (node-pty, fastify, ws, ...)
#   dist/                   -> compiled app + frontend static assets
#   package.json            -> version reads (require('../../package.json'))
#   skills/codeman          -> agent-skill install feature
#   docker/agent.Dockerfile -> Docker-cases agent base image
COPY --from=deploy /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/docker ./docker

# Source maps + type declarations are debug/build artifacts never read at
# runtime; strip them to keep the image lean.
RUN find dist \( -name '*.map' -o -name '*.d.ts' \) -delete

EXPOSE 3000

CMD ["node", "dist/index.js", "web"]
