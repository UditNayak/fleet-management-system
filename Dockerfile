FROM node:22-slim

WORKDIR /app

# Silence the util._extend deprecation warning from http-proxy
ENV NODE_OPTIONS=--disable-warning=DEP0060

# Install dependencies first so this layer is cached until package files change
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

USER node
