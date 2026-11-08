# The sync server only; the web app is static files on a host such as Cloudflare Pages.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which writes the client into server/generated.
RUN npm ci
COPY server ./server
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER node
CMD ["node", "--import", "tsx", "server/main.ts"]
