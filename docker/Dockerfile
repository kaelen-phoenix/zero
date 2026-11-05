# The factory in a container: zero on Node 22 with git, gh, the Docker client and
# only the AI CLIs named in ZERO_CLIS. Built from the repository's root:
#   docker compose build    (ZERO_CLIS=claude,codex to add more)
FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim

# Comma-separated: claude, codex. Nothing else is installed afterwards: changing it means rebuilding.
ARG ZERO_CLIS=""

# The Docker client only talks to the host's runtime when compose.box.yaml connects it; the image has no daemon.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg git; \
    install -m 0755 -d /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg; \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list; \
    echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh docker-ce-cli; \
    rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    for cli in $(echo "$ZERO_CLIS" | tr ',' ' '); do \
      case "$cli" in \
        claude) npm install -g @anthropic-ai/claude-code ;; \
        codex) npm install -g @openai/codex ;; \
        *) echo "ZERO_CLIS: no conozco $cli (claude, codex)" >&2; exit 1 ;; \
      esac; \
    done; \
    npm cache clean --force

# What `zero box setup` builds the box image from (see CONTEXT in src/box/image.ts).
WORKDIR /opt/zero
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /src/dist ./dist
COPY agents ./agents
COPY box/Dockerfile ./box/Dockerfile
RUN chmod +x dist/cli.js && ln -s /opt/zero/dist/cli.js /usr/local/bin/zero

# Volumes may belong to other users, and pushes to GitHub over https use zero's token. Remotes over ssh have no key here.
RUN git config --system safe.directory '*' \
    && git config --system credential.https://github.com.helper '!zero git-credential'

RUN mkdir -p /data/home /data/user /repos && chown -R node:node /data /repos
ENV ZERO_CONTAINER=1 \
    ZERO_HOME=/data/home \
    HOME=/data/user

EXPOSE 4848
USER node
WORKDIR /repos
ENTRYPOINT ["node", "/opt/zero/dist/cli.js"]
CMD ["start"]
