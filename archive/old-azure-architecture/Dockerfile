# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install build dependencies required for native modules (better-sqlite3)
# These packages are needed to compile better-sqlite3 during npm install
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY package*.json ./

# Install dependencies
# Use npm ci for cleaner, faster, and more reliable installs in CI/CD
RUN npm ci --only=production

# Remove build dependencies to reduce image size
# Note: better-sqlite3 binary is already compiled, so we can safely remove these
RUN apk del python3 make g++

# Copy application source code
COPY src/ ./src/
COPY config/ ./config/

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (default Slack app port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/index.js"]
