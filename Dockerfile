# Official Playwright image: Node.js plus Chromium and the system libraries it needs
# for PDF rendering. Keep the tag in sync with the "playwright" version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
CMD ["node", "dist/main"]
