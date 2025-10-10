# Setup build image
FROM node:22-bookworm-slim AS buildenv
WORKDIR /source/
RUN npm install -g npm@latest

# Install system build tools
RUN apt-get update
RUN apt-get install python3 make g++ git -y

# Install npm packages
COPY package.json package-lock.json ./
RUN npm ci

# Setup Env Variables
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG ENVIRONMENT
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN}
ENV SENTRY_ORG=${SENTRY_ORG}
ENV SENTRY_PROJECT=${SENTRY_PROJECT}
ENV ENVIRONMENT=${ENVIRONMENT}


# Env Setup
COPY tsconfig.json ./
COPY scripts/ ./scripts
RUN chmod +x ./scripts/*

# Save commit hash to env
COPY .git/ ./.git/
RUN echo "COMMITHASH=$(git -C /source/ rev-parse HEAD)" >> .env_build

# Pre-Build Hook
RUN scripts/preHook.sh

# Build the source
COPY src/ ./src/
COPY public ./public/
COPY build.js ./build.js
RUN npm run build

# Post-Build Hook
RUN scripts/postHook.sh

# Build Cleanup
RUN find dist/ -type f -name '*.map' -delete
RUN npm prune --omit=dev


# Setup production image
FROM node:22-bookworm-slim

# Setup the environment?
WORKDIR /app/

# Install/upgrade some system packages
RUN npm install -g npm@latest
RUN apt-get update
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy files from the build env
COPY --from=buildenv /source/node_modules /app/node_modules/
COPY --from=buildenv /source/dist /app/

# Import build env
COPY --from=buildenv /source/.env_build /app/.env

# Exposed web server port
EXPOSE ${PORT}

CMD node -r ./sentryLoader.js ./index.js