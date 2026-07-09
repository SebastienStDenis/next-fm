import Link from "next/link";

export function HomeLink({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="text-sm text-gray-500 hover:underline">
      &larr; Home
    </Link>
  );
}
