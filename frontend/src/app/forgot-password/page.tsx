import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <h1 className="mb-2 text-2xl font-semibold">Reset password</h1>
      <p className="mb-6 text-sm text-gray-500">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>
      <ForgotPasswordForm />
      <p className="mt-4 text-sm text-gray-500">
        <Link href="/login" className="underline hover:text-foreground">
          Back to log in
        </Link>
      </p>
    </main>
  );
}
