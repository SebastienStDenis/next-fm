import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Source maps upload only when SENTRY_AUTH_TOKEN, SENTRY_ORG, and
// SENTRY_PROJECT are all set, and the build still succeeds without them, so
// local and CI builds need no Sentry credentials. Setting them in Vercel is
// what turns minified frontend stack traces back into readable ones.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
});
