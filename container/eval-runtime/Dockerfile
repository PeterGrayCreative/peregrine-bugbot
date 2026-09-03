FROM node:22.22.1-bookworm-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d

ARG SOURCE_REVISION=unknown

LABEL org.opencontainers.image.title="Peregrine evaluation runtime" \
      org.opencontainers.image.description="Provider CLIs for externally contained Peregrine evaluation attempts" \
      org.opencontainers.image.source="https://github.com/PeterGrayCreative/peregrine-bugbot" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      io.peregrine.node.version="22.22.1" \
      io.peregrine.claude-code.version="2.1.252" \
      io.peregrine.codex.version="0.152.0"

ENV NODE_ENV=production \
    PATH=/opt/peregrine-provider/node_modules/.bin:${PATH} \
    HOME=/home/peregrine \
    XDG_CONFIG_HOME=/home/peregrine/xdg-config \
    XDG_CACHE_HOME=/home/peregrine/xdg-cache \
    XDG_DATA_HOME=/home/peregrine/xdg-data \
    TMPDIR=/tmp \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    DISABLE_AUTOUPDATER=1 \
    DISABLE_UPDATES=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/peregrine-provider
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && claude --version | grep --fixed-strings '2.1.252' \
    && codex --version | grep --fixed-strings '0.152.0'

RUN mkdir -p /home/peregrine /workspace /opt/peregrine /output \
    && chown node:node /home/peregrine /output \
    && chmod 0555 /workspace /opt/peregrine

COPY --chmod=0555 containment-probe.mjs /usr/local/bin/peregrine-containment-probe

USER node
WORKDIR /workspace

CMD ["peregrine-containment-probe", "--check"]
