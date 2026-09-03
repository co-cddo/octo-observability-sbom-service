FROM node:26-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146 AS build

RUN npm install -g pnpm@10.33.0

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM node:26-slim@sha256:c0753125a3789977aefe869cbebccf70e3cfd7ea84ca48547458f02e4f1d7146 AS release

RUN npm install -g pnpm@10.33.0

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
