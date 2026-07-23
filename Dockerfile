# Build context = repository root (Railway Root Directory empty / ".")
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

FROM base AS deps
COPY web/package.json web/package-lock.json ./
COPY web/prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY web/ .
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
RUN AUTH_SECRET="build-time-placeholder-secret-min-32-chars" \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DEMO_MODE="true" \
    npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["sh", "-c", "npx prisma db push && npm start"]
