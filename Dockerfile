FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV PORT=8787
EXPOSE 8787
USER node
# Set CECIL_GITHUB_TOKEN, CECIL_GITHUB_REPO, CECIL_PROJECT_KEY and CECIL_ORIGINS at run time.
CMD ["node", "dist/server.mjs"]
