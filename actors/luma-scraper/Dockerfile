# Playwright + Chromium preinstalled by Apify's base image.
FROM apify/actor-node-playwright-chrome:20

# Install deps (package-lock optional). Copy manifests first for layer caching.
COPY --chown=myuser package*.json ./
RUN npm install --omit=dev --no-optional --no-audit --no-fund \
    && echo "Installed:" && (npm ls || true)

# Copy the rest of the source.
COPY --chown=myuser . ./

CMD ["node", "src/main.js"]
