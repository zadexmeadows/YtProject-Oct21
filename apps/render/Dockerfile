FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm install
RUN npm run db:generate

EXPOSE 10000

CMD ["sh", "-c", "npm run db:migrate && npm run db:seed && npx concurrently --restart-tries -1 --restart-after 5000 -n api,worker -c blue,green \"npm run start -w @ytbot/api\" \"npm run start -w @ytbot/worker\""]
