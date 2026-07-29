FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV DATABASE_URL=postgresql://localhost:5432/synapse_build

RUN apt-get update -y \
	&& apt-get install -y --no-install-recommends openssl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN pnpm install --frozen-lockfile

COPY backend backend

RUN pnpm --filter @synapse/backend db:generate
RUN pnpm --filter @synapse/backend build
RUN pnpm --filter @synapse/backend deploy --prod --legacy /app/deploy
RUN cp -R backend/dist /app/deploy/dist
RUN cp -R backend/prisma /app/deploy/prisma
RUN cp backend/prisma.config.ts /app/deploy/prisma.config.ts
RUN cd /app/deploy && pnpm exec prisma generate --schema=prisma/schema.prisma

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN apt-get update -y \
	&& apt-get install -y --no-install-recommends openssl \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/deploy ./

EXPOSE 4000

CMD ["node", "dist/index.js"]
