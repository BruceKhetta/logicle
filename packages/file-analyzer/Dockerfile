# syntax=docker/dockerfile:1.5
FROM node:24-bookworm-slim AS builder
WORKDIR /build
RUN npm install -g pnpm@10.22.0
ENV PNPM_STORE_PATH=/pnpm/store

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY vendor/xlsx ./vendor/xlsx
COPY apps/backend/package.json ./apps/backend/package.json
COPY packages/file-analyzer/package.json ./packages/file-analyzer/package.json
RUN --mount=type=cache,id=pnpm-file-analyzer,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY tsup.file-analyzer.config.js ./
COPY packages/file-analyzer ./packages/file-analyzer
RUN pnpm exec tsup --config tsup.file-analyzer.config.js \
    && node packages/file-analyzer/scripts/stage-runtime.mjs /artifact/opt/logicle-file-analyzer \
    && install -m 755 packages/file-analyzer/bin/mcp-file-analyzer /artifact/mcp-file-analyzer

FROM node:24-bookworm-slim
WORKDIR /opt/logicle-file-analyzer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libreoffice-core-nogui libreoffice-impress-nogui libreoffice-writer-nogui libreoffice-calc-nogui \
    fonts-liberation fonts-dejavu-core fonts-noto-core \
    poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-ita \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /artifact/opt/logicle-file-analyzer/ /opt/logicle-file-analyzer/
COPY --from=builder /artifact/mcp-file-analyzer /mcp-file-analyzer
# These execute for each target architecture before the image can be published.
RUN /mcp-file-analyzer -help >/dev/null \
    && node -e "require('./node_modules/sharp')({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer().then(b=>{if(!b.length)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})" \
    && command -v soffice && command -v pdftoppm && command -v pdftotext \
    && command -v pdfinfo && command -v tesseract \
    && tesseract --list-langs | grep -qx ita

USER node
ENTRYPOINT ["/mcp-file-analyzer"]
