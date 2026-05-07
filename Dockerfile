FROM node:20-slim AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM node:20-slim AS release

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist dist/
COPY src/db/migrations/ dist/db/migrations/
COPY src/server/views/ dist/server/views/
COPY src/freshness/watchlist.yaml dist/freshness/watchlist.yaml
COPY --from=build /app/node_modules/govuk-frontend/dist/ public/govuk-frontend/

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
