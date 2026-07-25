import Link from "next/link";

import { Haze } from "@/components/haze";
import { Button } from "@/components/ui/button";

// The root not-found renders for any unmatched URL as well as for `notFound()`
// anywhere without a nearer boundary. It sits inside the root layout, so the
// soundwave field, theme and faces come with it; without this file Next.js
// serves its own unbranded page instead.
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Haze>
        <h1 className="text-2xl font-semibold tracking-tight">
          Page not found
        </h1>
      </Haze>
      <Haze>
        <p className="max-w-md text-center text-muted-foreground">
          This page doesn’t exist. The link may be wrong or out of date.
        </p>
      </Haze>
      <Haze>
        <Button asChild size="lg">
          <Link href="/">Home</Link>
        </Button>
      </Haze>
    </main>
  );
}
