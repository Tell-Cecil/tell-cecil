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
# Set CECIL_PROJECT_KEY, CECIL_ORIGINS and one tracker's variables (GitHub, GitLab or Jira; see README) at run time.
CMD ["node", "dist/server.mjs"]
