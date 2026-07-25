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
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
      </Haze>
      <Haze>
        <Button asChild size="lg">
          <Link href="/">Home</Link>
        </Button>
      </Haze>
    </main>
  );
}
