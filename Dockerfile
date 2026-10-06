# Один сервис: шлюз отдаёт собранный интерфейс, REST, WebSocket и MQTT поверх WebSocket.
# Имитаторы стартуют вместе с ним (SIMULATORS=on), но ходят в шлюз по сети, как настоящие системы.
FROM node:22-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/twin-core/package.json packages/twin-core/
COPY packages/simulators/package.json packages/simulators/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @allur/web build

ENV NODE_ENV=production \
    PORT=10000 \
    SIMULATORS=on \
    START_SPEED=60 \
    START_STAGE=1
EXPOSE 10000
CMD ["pnpm", "start"]
