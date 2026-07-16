import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "@/sentry.shared";

Sentry.init({
  ...sharedOptions,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
  ],
});
