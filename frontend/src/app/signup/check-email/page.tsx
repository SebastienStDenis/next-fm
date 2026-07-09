import Link from "next/link";

import { HomeLink } from "../../home-link";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <h1 className="mt-2 mb-6 text-2xl font-semibold">Check your email</h1>
      <p className="text-sm text-gray-500">
        We sent you a confirmation link. Click it to finish setting up your
        account, then you&apos;ll be signed in.
      </p>
      <p className="mt-4 text-sm text-gray-500">
        Already confirmed?{" "}
        <Link href="/login" className="underline hover:text-foreground">
          Log in
        </Link>
      </p>
    </main>
  );
}
