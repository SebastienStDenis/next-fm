import Link from "next/link";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
      <LoginForm />
      <p className="mt-4 text-sm text-gray-500">
        No account?{" "}
        <Link href="/signup" className="underline hover:text-foreground">
          Sign up
        </Link>
      </p>
    </main>
  );
}
