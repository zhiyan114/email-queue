import { consoleLoggingIntegration, extraErrorDataIntegration, init } from "@sentry/node-core";
import { config } from "dotenv";

config();
init({
  dsn: process.env["SENTRY_DSN"],
  sendDefaultPii: true,
  maxValueLength: 1000,
  integrations: [
    consoleLoggingIntegration({
      levels: ["error", "warn", "log"],
    }),
    extraErrorDataIntegration({
      depth: 5
    })
  ],
  enableLogs: true,
  beforeSendLog: (log) => {
    console.log("[%s]: %s", log.level, log.message);
    return log;
  },
  ignoreErrors: [
    "ETIMEDOUT",
    "EADDRINUSE",
    "ENOTFOUND",
    "TimeoutError",
    "AbortError",
    "NetworkError",
    "ECONNREFUSED",
    "ECONNRESET",
    "getaddrinfo"
  ],
});