import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function HomeLink({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Home
    </Link>
  );
}
