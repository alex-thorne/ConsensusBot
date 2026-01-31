# Docker Deployment Guide

This guide covers building, testing, and deploying ConsensusBot using Docker.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building the Docker Image](#building-the-docker-image)
- [Running with Docker](#running-with-docker)
- [Using Docker Compose](#using-docker-compose)
- [Testing the Container](#testing-the-container)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- Docker Engine 20.10 or higher
- Docker Compose 2.0 or higher (if using docker-compose)
- A configured Slack App (see [LOCAL_SETUP.md](LOCAL_SETUP.md))

## Building the Docker Image

### Basic Build

```bash
docker build -t consensusbot:latest .
```

### Build with Specific Tag

```bash
docker build -t consensusbot:v0.1.0 .
```

### Build with No Cache

```bash
docker build --no-cache -t consensusbot:latest .
```

### Multi-Stage Build Details

The Dockerfile uses a multi-stage approach:

1. **Base Image**: Node.js 18 Alpine (minimal size)
2. **Dependencies**: Installs production dependencies only
3. **Application**: Copies source code
4. **Security**: Runs as non-root user
5. **Health Check**: Includes health check endpoint

## Running with Docker

### Basic Run

```bash
docker run -d \
  --name consensusbot \
  -p 3000:3000 \
  --env-file .env \
  consensusbot:latest
```

### Run with Environment Variables

```bash
docker run -d \
  --name consensusbot \
  -p 3000:3000 \
  -e SLACK_BOT_TOKEN="xoxb-your-token" \
  -e SLACK_SIGNING_SECRET="your-secret" \
  -e SLACK_APP_TOKEN="xapp-your-token" \
  -e PORT=3000 \
  -e NODE_ENV=production \
  consensusbot:latest
```

### Run with Volume Mount (Development)

```bash
docker run -d \
  --name consensusbot \
  -p 3000:3000 \
  -v $(pwd)/src:/app/src \
  --env-file .env \
  consensusbot:latest
```

### View Logs

```bash
# Follow logs in real-time
docker logs -f consensusbot

# View last 100 lines
docker logs --tail 100 consensusbot
```

### Stop Container

```bash
docker stop consensusbot
```

### Remove Container

```bash
docker rm consensusbot
```

## Using Docker Compose

Docker Compose simplifies container management and is recommended for development.

### Start Services

```bash
# Start in foreground
docker-compose up

# Start in background (detached)
docker-compose up -d

# Start with build
docker-compose up --build
```

### View Services Status

```bash
docker-compose ps
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f consensusbot
```

### Stop Services

```bash
# Stop services (keeps containers)
docker-compose stop

# Stop and remove containers
docker-compose down

# Stop and remove containers, volumes, and images
docker-compose down -v --rmi all
```

### Rebuild Services

```bash
# Rebuild without cache
docker-compose build --no-cache

# Rebuild and start
docker-compose up --build
```

## Testing the Container

### Health Check

The container includes a health check endpoint. Test it:

```bash
# From inside the container
docker exec consensusbot node -e "require('http').get('http://localhost:3000/health')"

# Check health status
docker inspect --format='{{.State.Health.Status}}' consensusbot
```

### Run Tests in Container

```bash
# Build test container
docker build -t consensusbot:test --target test .

# Run tests
docker run --rm consensusbot:test npm test
```

### Interactive Shell

```bash
# Open shell in running container
docker exec -it consensusbot sh

# Run container with shell
docker run -it --rm consensusbot:latest sh
```

## Production Deployment

### Best Practices

1. **Use Specific Versions**: Tag images with version numbers
2. **Environment Variables**: Never hardcode secrets
3. **Health Checks**: Enable health checks
4. **Logging**: Use appropriate log levels
5. **Resource Limits**: Set CPU and memory limits
6. **Restart Policies**: Configure auto-restart

### Production Docker Run

```bash
docker run -d \
  --name consensusbot-prod \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.production \
  --memory="512m" \
  --cpus="1.0" \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  --health-cmd "node -e \"require('http').get('http://localhost:3000/health')\"" \
  --health-interval=30s \
  --health-timeout=3s \
  --health-retries=3 \
  consensusbot:latest
```

### Production Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  consensusbot:
    image: consensusbot:${VERSION:-latest}
    container_name: consensusbot-prod
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health')"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s

networks:
  default:
    name: consensusbot-network
```

Deploy:

```bash
VERSION=v0.1.0 docker-compose -f docker-compose.prod.yml up -d
```

### Container Registry

#### Tag for Registry

```bash
docker tag consensusbot:latest your-registry.com/consensusbot:latest
docker tag consensusbot:latest your-registry.com/consensusbot:v0.1.0
```

#### Push to Registry

```bash
# Login
docker login your-registry.com

# Push
docker push your-registry.com/consensusbot:latest
docker push your-registry.com/consensusbot:v0.1.0
```

#### Pull and Run from Registry

```bash
docker pull your-registry.com/consensusbot:v0.1.0
docker run -d \
  --name consensusbot \
  -p 3000:3000 \
  --env-file .env \
  your-registry.com/consensusbot:v0.1.0
```

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker logs consensusbot
```

**Common issues:**
- Missing environment variables
- Port already in use
- Invalid Slack credentials

### Container Exits Immediately

**Check exit code:**
```bash
docker ps -a
```

**Run in foreground to see errors:**
```bash
docker run --rm consensusbot:latest
```

### Can't Connect to Slack

**Verify environment variables:**
```bash
docker exec consensusbot printenv | grep SLACK
```

**Check Socket Mode is enabled** in Slack app settings.

### High Memory Usage

**Check container stats:**
```bash
docker stats consensusbot
```

**Set memory limit:**
```bash
docker run -d --memory="512m" consensusbot:latest
```

### Permission Issues

The container runs as a non-root user (nodejs:1001). If you have permission issues with volumes:

```bash
# Fix ownership
sudo chown -R 1001:1001 ./data

# Or run as root (not recommended)
docker run -d --user root consensusbot:latest
```

### Network Issues

**Check container network:**
```bash
docker network inspect bridge
```

**Test connectivity:**
```bash
docker exec consensusbot ping -c 3 google.com
```

## Monitoring

### Container Stats

```bash
# Real-time stats
docker stats consensusbot

# One-time stats
docker stats --no-stream consensusbot
```

### Health Status

```bash
# Get health status
docker inspect --format='{{json .State.Health}}' consensusbot | jq

# Get last 5 health check results
docker inspect --format='{{range .State.Health.Log}}{{.Start}}: {{.Output}}{{end}}' consensusbot
```

### Logs

```bash
# Follow logs
docker logs -f consensusbot

# Last 100 lines
docker logs --tail 100 consensusbot

# Since timestamp
docker logs --since 2024-01-01T00:00:00 consensusbot
```

## Security Considerations

1. **Non-root User**: Container runs as user `nodejs` (UID 1001)
2. **Minimal Base Image**: Uses Alpine Linux for smaller attack surface
3. **No Secrets in Image**: Environment variables used for sensitive data
4. **Health Checks**: Regular health monitoring
5. **Read-only Filesystem**: Consider using `--read-only` flag
6. **Security Scanning**: Run `docker scan consensusbot:latest` regularly

## Cleanup

### Remove Unused Resources

```bash
# Remove stopped containers
docker container prune

# Remove unused images
docker image prune

# Remove everything unused
docker system prune -a
```

### Remove Specific Resources

```bash
# Remove container
docker rm consensusbot

# Remove image
docker rmi consensusbot:latest

# Remove volume
docker volume rm consensusbot_data
```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
- [Slack Bolt Framework](https://slack.dev/bolt-js/)
