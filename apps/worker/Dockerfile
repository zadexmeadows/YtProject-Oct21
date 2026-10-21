FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm install
RUN npm run db:generate

CMD ["npm", "run", "start", "-w", "@ytbot/worker"]
