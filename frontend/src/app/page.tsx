import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { IntroText } from "./intro-text";

// A feathered wash of the page background, sized to whatever it wraps, so the
// copy stays legible over the animated dots without a hard-edged card. A blurred
// rounded rectangle (rather than a radial gradient) covers wide text evenly to
// the edges; the tight vertical inset keeps dots showing through the gaps
// between blocks. Applied per element.
function Haze({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-4 -inset-y-0.5 rounded-3xl bg-background blur-md"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Haze>
        <h1 className="text-3xl font-semibold tracking-tight">NextFM</h1>
      </Haze>
      {/* Tagline and intro get their own washes so each hugs its own width.
          The tagline's bottom padding extends its wash down and the intro's
          negative margin pulls its wash up, so the two solid cores overlap and
          no dots peek through between them - the text keeps its normal spacing. */}
      <div className="flex flex-col items-center">
        <Haze>
          <p className="max-w-md text-center text-lg text-muted-foreground pb-6">
            Live-music discovery through listening.
          </p>
        </Haze>
        <div className="-mt-5">
          <Haze>
            <IntroText className="max-w-md text-center text-xs text-muted-foreground italic" />
          </Haze>
        </div>
      </div>
      <Haze>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href="/login">Log in</Link>
          </Button>
          {/* The dark outline fill (--input) is translucent, so the dots show
              through it even over the haze; force an opaque surface here. */}
          <Button
            asChild
            variant="outline"
            size="lg"
            className="dark:bg-background dark:hover:bg-muted dark:active:bg-muted"
          >
            <Link href="/signup">Sign up</Link>
          </Button>
        </div>
      </Haze>
    </main>
  );
}
