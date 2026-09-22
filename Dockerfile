# node:sqlite (used throughout server/) needs Node 22+ — see server/package.json engines.
FROM node:22-slim

# tar is required by server/lib/backup.js (bundles the DB snapshot + local
# document store into one archive); most Debian base images already carry
# it as an essential package, but this makes it an explicit dependency
# instead of an assumption.
RUN apt-get update && apt-get install -y --no-install-recommends tar && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package*.json server/
RUN cd server && npm install --omit=dev

COPY server server
COPY web web

ENV NODE_ENV=production
ENV PORT=4100
# DB, uploaded documents and local backups all live under server/data —
# mount that one directory as a volume to persist everything across
# container restarts (see docker-compose.yml).
VOLUME ["/app/server/data"]

EXPOSE 4100
WORKDIR /app/server
CMD ["node", "index.js"]
