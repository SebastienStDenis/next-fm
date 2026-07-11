import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function HomeLink({ href = "/dashboard" }: { href?: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      // -ml-3 cancels the ghost padding so the label stays optically aligned
      // with the page content edge.
      className="-ml-3 self-start text-muted-foreground"
    >
      <Link href={href}>
        <ArrowLeft aria-hidden="true" />
        Home
      </Link>
    </Button>
  );
}
