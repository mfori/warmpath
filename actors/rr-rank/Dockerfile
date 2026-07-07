FROM apify/actor-node:20
COPY --chown=myuser package*.json ./
RUN npm install --omit=dev --no-optional --no-audit --no-fund
COPY --chown=myuser . ./
CMD ["node", "src/main.js"]
