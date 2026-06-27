FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy all files
COPY . .

# Install dependencies
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Build (if applicable)
RUN pnpm build 2>/dev/null || true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health 2>/dev/null || exit 1

EXPOSE 8787

# Use pnpm exec to run wrangler from node_modules
CMD ["pnpm", "exec", "wrangler", "dev", "--local", "--host", "0.0.0.0", "--port", "8787"]
