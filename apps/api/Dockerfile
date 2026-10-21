FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm install
RUN npm run db:generate

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@ytbot/api"]
