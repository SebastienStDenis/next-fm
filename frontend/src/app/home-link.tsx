import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Haze } from "./haze";

export function HomeLink({ href = "/dashboard" }: { href?: string }) {
  return (
    // The scrim keeps the soundwave dots from showing behind the ghost button
    // on the pages that render them.
    <Haze className="self-start">
      <Button
        asChild
        variant="ghost"
        size="sm"
        // -ml-3 cancels the ghost padding so the label stays optically aligned
        // with the page content edge.
        className="-ml-3 text-muted-foreground"
      >
        <Link href={href}>
          <ArrowLeft aria-hidden="true" />
          Home
        </Link>
      </Button>
    </Haze>
  );
}
