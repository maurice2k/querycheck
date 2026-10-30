ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

COPY jest.config.js tsconfig.json index.d.ts ./
COPY types/ ./types/
COPY src/ ./src/
COPY __tests__/ ./__tests__/
