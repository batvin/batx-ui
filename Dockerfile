FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=8787 \
    DATA_DIR=/app/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data

USER node
CMD ["node", "--env-file-if-exists=.env", "server.mjs"]
