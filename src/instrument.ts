import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN;

// bun test loads .env too; keep its deliberate failures out of Sentry.
if (dsn && process.env.NODE_ENV !== "test") {
  Sentry.init({
    dsn,
    environment: "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
