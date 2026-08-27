FROM mcr.microsoft.com/playwright:v1.62.1-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER pwuser
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
