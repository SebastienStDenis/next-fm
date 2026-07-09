import Link from "next/link";

export function HomeLink() {
  return (
    <Link href="/dashboard" className="text-sm text-gray-500 hover:underline">
      &larr; Home
    </Link>
  );
}
