FROM node:24-alpine AS dependencies
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM dependencies AS migrate
COPY backend/db ./db
COPY deploy/backend-entrypoint.sh /usr/local/bin/backend-entrypoint
USER node
ENTRYPOINT ["sh", "/usr/local/bin/backend-entrypoint"]
CMD ["node", "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "--migrations-dir", "db/migrations", "up"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY backend/db ./db
COPY backend/scripts ./scripts
COPY deploy/backend-entrypoint.sh /usr/local/bin/backend-entrypoint
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/usr/local/bin/backend-entrypoint"]
CMD ["node", "src/server.ts"]
