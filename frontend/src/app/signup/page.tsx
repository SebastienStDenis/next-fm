import Link from "next/link";

import { HomeLink } from "../home-link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <h1 className="mt-2 mb-6 text-2xl font-semibold">Sign up</h1>
      <SignupForm />
      <p className="mt-4 text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="underline hover:text-foreground">
          Log in
        </Link>
      </p>
    </main>
  );
}
