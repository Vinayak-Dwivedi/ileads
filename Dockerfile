# --- Dependency Installation Stage ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package descriptors
COPY package.json package-lock.json ./

# Install all dependencies (needed for build and queue worker tsx execution)
RUN npm ci

# --- Builder Stage ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set up build arguments for Next.js base path config (if any)
ARG NEXT_PUBLIC_BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
ENV NODE_ENV=production

# Generate Prisma client and build the Next.js project
RUN npx prisma generate
RUN npm run build

# --- Runner Stage ---
FROM node:22-alpine AS runner
WORKDIR /app

# Install PM2 globally
RUN npm install -g pm2 && pm2 --version

# Set runtime environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010

# Copy necessary files and directories from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/ecosystem.config.js ./ecosystem.config.js
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/deploy ./deploy

# Create storage directory for local audio uploads (just in case they use provider=local)
RUN mkdir -p storage/audio

# Make sure entrypoint script is executable
RUN chmod +x ./deploy/docker-entrypoint.sh

# Expose Next.js server port
EXPOSE 3010

# Set entrypoint to run migrations and launch PM2
ENTRYPOINT ["sh", "./deploy/docker-entrypoint.sh"]
