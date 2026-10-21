FROM node:20-bookworm-slim

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm install
RUN npm run build -w @ytbot/web

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@ytbot/web"]
