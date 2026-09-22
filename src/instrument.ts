import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
