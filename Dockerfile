FROM node:22-slim

WORKDIR /app

# Install dependencies first so this layer is cached until package files change
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

USER node
