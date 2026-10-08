FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm test && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/engine packages/engine
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/src packages/server/src
COPY --from=build /app/packages/web/package.json packages/web/
COPY --from=build /app/packages/web/dist packages/web/dist
EXPOSE 3000
USER node
CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
