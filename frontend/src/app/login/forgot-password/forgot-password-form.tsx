"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { requestPasswordReset } from "./actions";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  // Punish late, revalidate eagerly: the format hint waits for the field's
  // first blur, then tracks every edit until resolved.
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(requestPasswordReset, {
    error: null,
  });

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
        />
        {emailTouched && email !== "" && !EMAIL_SHAPE.test(email) && (
          <p className="text-xs text-destructive">
            Enter a valid email address.
          </p>
        )}
      </div>
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button
        type="submit"
        disabled={pending || !EMAIL_SHAPE.test(email)}
        className="w-full"
      >
        {pending && <Spinner />}
        Send reset link
      </Button>
    </form>
  );
}
