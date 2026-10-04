# CSMS OCPP 1.6-J do B2W Charge. Build: docker build services/ocpp-csms
# Segredos (SUPABASE_SERVICE_ROLE_KEY etc.) so por variavel de ambiente em tempo de execucao, nunca na imagem.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# imagem oficial do Node ja traz o usuario nao-root `node`
USER node
ENV PORT=9220
EXPOSE 9220
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
