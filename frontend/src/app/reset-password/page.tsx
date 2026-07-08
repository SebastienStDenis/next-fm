import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <h1 className="mb-6 text-2xl font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </main>
  );
}
