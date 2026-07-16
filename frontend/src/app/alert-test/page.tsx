// Throwaway alerting probe: forces a server-side runtime error so Sentry's
// onRequestError path fires in a production Vercel build. force-dynamic keeps
// the throw at request time instead of the build's static prerender. Delete
// this route once frontend runtime alerting is verified.
export const dynamic = "force-dynamic";

export default function AlertTest() {
  throw new Error("frontend-runtime-alert-test");
}
