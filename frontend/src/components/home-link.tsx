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
      // with the page content edge; w-fit keeps a flex parent from stretching
      // the button across the column.
      className="-ml-3 w-fit text-muted-foreground"
    >
      <Link href={href}>
        <ArrowLeft aria-hidden="true" />
        Home
      </Link>
    </Button>
  );
}
