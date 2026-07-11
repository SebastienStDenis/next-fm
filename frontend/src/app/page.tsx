import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { IntroText } from "./intro-text";

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
      <h1 className="text-3xl font-semibold tracking-tight">
        NextFM
      </h1>
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-md text-center text-lg text-muted-foreground">
          Live-music discovery through listening.
        </p>
        <IntroText className="max-w-md text-center text-xs text-muted-foreground italic" />
      </div>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/login">Log in</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/signup">Sign up</Link>
        </Button>
      </div>
    </main>
  );
}
