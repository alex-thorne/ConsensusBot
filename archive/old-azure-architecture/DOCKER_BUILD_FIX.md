# Docker Build Fix for better-sqlite3

## Issue
The Docker build was failing with the following error:
```
npm error gyp ERR! find Python 
npm error gyp ERR! find Python Python is not set from command line or npm configuration
npm error gyp ERR! cwd /app/node_modules/better-sqlite3
```

## Root Cause
`better-sqlite3` is a native Node.js module that requires compilation during installation. The compilation process uses `node-gyp`, which requires:
- Python (for build scripts)
- make (build automation tool)
- g++ (C++ compiler)

The Alpine Linux base image (`node:18-alpine`) is intentionally minimal and doesn't include these build tools by default.

## Solution
The Dockerfile was updated to install the required build dependencies before running `npm ci`, then remove them after the native module is compiled to keep the final image size small.

### Changes to Dockerfile
```dockerfile
# Install build dependencies required for native modules (better-sqlite3)
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Remove build dependencies to reduce image size
RUN apk del python3 make g++
```

## Why This Works
1. **Install Build Tools**: The `apk add` command installs Python 3, make, and g++ from Alpine's package repository
2. **Compile Native Module**: When `npm ci` runs, it compiles `better-sqlite3` using the available build tools
3. **Clean Up**: The compiled binary is stored in `node_modules/better-sqlite3`, so we can safely remove the build tools
4. **Small Image**: Final image doesn't include the ~100MB of build tools, keeping it lean

## Best Practices Followed
- **Layer Caching**: Build tools are installed before copying package files for better cache utilization
- **Minimal Image Size**: Build dependencies are removed after compilation
- **Production Dependencies Only**: Using `npm ci --only=production` to avoid installing dev dependencies
- **Documentation**: Added comments explaining why each step is necessary

## Alternative Approaches Considered

### Multi-Stage Build
Could use a multi-stage build to completely separate the build environment:
```dockerfile
FROM node:18-alpine AS builder
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine
COPY --from=builder /app/node_modules ./node_modules
```
**Decision**: Not necessary for this case as removing build deps is simpler and achieves the same result.

### Keep Build Dependencies
Could leave python3, make, and g++ installed:
```dockerfile
RUN apk add --no-cache python3 make g++
```
**Decision**: Rejected to keep image size minimal (saves ~100MB).

### Use better-sqlite3-multiple-ciphers
Could switch to a fork that provides pre-compiled binaries:
**Decision**: Not necessary; adding build deps is a standard solution.

## Testing
The fix can be verified by running:
```bash
docker build -t consensusbot:test .
```

The build should complete successfully, and the resulting image should:
1. Contain the compiled better-sqlite3 binary
2. NOT contain python3, make, or g++ in the final layer
3. Be able to run the application successfully

## References
- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3)
- [node-gyp Requirements](https://github.com/nodejs/node-gyp#installation)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Alpine Package Management](https://wiki.alpinelinux.org/wiki/Alpine_Package_Keeper)
