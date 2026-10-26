# The zero isolation box: the same zero engines, built for Linux, with the
# toolchains most projects need to set up and verify (git, Node, Python, C).
FROM node:22-bookworm

RUN npm install -g @openai/codex && npm cache clean --force

WORKDIR /opt/zero
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY agents ./agents

RUN mkdir -p /work /home/zero && chmod 1777 /home/zero
ENV HOME=/home/zero \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=*

USER node
WORKDIR /work
