# Robô de monitoramento SAJ. Build: docker build services/saj-monitor
# Sem dependências npm: só Node 22 (fetch e crypto nativos).
# Segredos (SAJ_APP_SECRET, MONITOR_TOKEN) só por variável de ambiente no EasyPanel, nunca na imagem.

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
# imagem oficial do Node já traz o usuário não-root `node`
USER node
CMD ["node", "src/main.js"]
