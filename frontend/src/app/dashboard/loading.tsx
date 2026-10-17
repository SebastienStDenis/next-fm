import { Settings as SettingsIcon } from "lucide-react";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";

import { DEFAULT_TAB } from "./dashboard-tabs";
import { SkeletonTabs } from "./skeleton-tabs";
import { TAB_COOKIE } from "./tab-cookie";

// The dashboard's own frame drawn for real, so nothing moves when the page
// arrives; only the parts that depend on the user's data are placeholders.
export default async function Loading() {
  const lastTab = (await cookies()).get(TAB_COOKIE)?.value;
  return (
    <main aria-busy className="mx-auto w-full max-w-5xl p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="min-w-0 font-heading text-2xl font-semibold">NextFM</h1>
        <Button variant="outline" size="sm" className="shrink-0" inert>
          <SettingsIcon aria-hidden />
          Settings
        </Button>
      </div>
      <section className="mt-6">
        <SkeletonTabs defaultTab={lastTab ?? DEFAULT_TAB} />
      </section>
    </main>
  );
}
