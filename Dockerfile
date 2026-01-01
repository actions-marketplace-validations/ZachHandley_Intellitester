FROM mcr.microsoft.com/playwright:v1.49.1-noble

# Install Inbucket
RUN apt-get update && apt-get install -y wget \
    && wget -q https://github.com/inbucket/inbucket/releases/download/v3.0.4/inbucket_3.0.4_linux_amd64.deb \
    && dpkg -i inbucket_3.0.4_linux_amd64.deb \
    && rm inbucket_3.0.4_linux_amd64.deb \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@10

# Set working directory
WORKDIR /autotester

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/vite-plugin-autotester/package.json ./packages/vite-plugin-autotester/
COPY packages/astro-integration/package.json ./packages/astro-integration/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# Make CLI globally available
RUN pnpm link --global

# Expose Inbucket ports
EXPOSE 9000 2500

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["autotester", "--help"]
