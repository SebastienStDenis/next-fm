import * as Sentry from "@sentry/nextjs";

import { sharedOptions } from "@/sentry.shared";

Sentry.init({
  ...sharedOptions,
  // Nothing calls console.* in src/ today. This is the wiring that means the
  // first one added starts flowing to Sentry Logs without further setup.
  // Levels below info are dropped, matching the backend's threshold.
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] }),
  ],
});
