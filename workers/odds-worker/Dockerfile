# Build from repository root: docker build -f workers/odds-worker/Dockerfile .
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY supabase/functions/_shared ./supabase/functions/_shared
COPY supabase/functions/odds-sync ./supabase/functions/odds-sync
COPY workers/odds-worker ./workers/odds-worker
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "workers/odds-worker/index.mjs"]
