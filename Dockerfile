FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci
COPY . .
RUN npm run check && npm test && npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/client/dist ./client/dist
COPY server.js start.sh ./
COPY domain ./domain
COPY lib ./lib
COPY middleware ./middleware
COPY migrations ./migrations
COPY routes ./routes
COPY services/GovernedBrokerService.js ./services/GovernedBrokerService.js
COPY scripts/migrate.js ./scripts/migrate.js
RUN mkdir -p /var/lib/quickbooks && chown -R node:node /app /var/lib/quickbooks && chmod 0555 /app/start.sh
USER node
EXPOSE 5010
CMD ["./start.sh"]
