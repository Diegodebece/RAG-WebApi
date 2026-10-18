# --- build: compile TypeScript to dist/ ---
FROM node:22-alpine AS build
WORKDIR /app

# dependencies first, so Docker reuses this layer while package files do not change
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime: only what the API needs to run ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY migrations ./migrations

# the official image includes an unprivileged "node" user
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]