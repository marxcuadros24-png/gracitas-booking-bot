FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp src/db/schema.sql dist/db/schema.sql && cp src/admin/dashboard.html dist/admin/dashboard.html

FROM node:22-alpine AS runtime

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/server.js"]
