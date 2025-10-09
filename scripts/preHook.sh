#!/bin/bash

# Pre-Build Script #



# Shareable Values
SRCENV=${ENVIRONMENT:=????}
RELSTR="${SRCENV:0:4}-${RAILWAY_GIT_COMMIT_SHA:0:7}"

# Sentry Deploy Begin
if [ -n "$SENTRY_AUTH_TOKEN" ] && [ -n "$SENTRY_ORG" ] && [ -n "$SENTRY_PROJECT" ]; then
  if [ -n "$ENVIRONMENT" ] && [ "$ENVIRONMENT" != "????" ]; then
    npx sentry-cli releases new "$RELSTR"
    echo "SENTRY_RELEASE=$RELSTR" >> .env_build
    echo "SENTRY_ENVIRONMENT=$SRCENV" >> .env_build

    echo "Sentry Release Created for $RELSTR..."
  else
    echo "No Sentry Release Created due to missing 'ENVIRONMENT' variable"
  fi
else
  echo "No Sentry Release Created due to missing required Sentry-Cli variables";
fi
