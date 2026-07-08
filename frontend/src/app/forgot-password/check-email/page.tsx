import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <h1 className="mb-6 text-2xl font-semibold">Check your email</h1>
      <p className="text-sm text-gray-500">
        If an account exists for that address, we sent a link to reset your
        password. Click it to choose a new password.
      </p>
      <p className="mt-4 text-sm text-gray-500">
        <Link href="/login" className="underline hover:text-foreground">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
