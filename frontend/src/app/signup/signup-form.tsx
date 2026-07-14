"use client";

import { useActionState, useState } from "react";
import { Check, X } from "lucide-react";

import { Collapse } from "../collapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { EMAIL_SHAPE } from "@/lib/validation";
import { FormError } from "../form-error";
import { signUp } from "./actions";

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Punish late, revalidate eagerly: the hints wait for their field's first
  // blur with content, then track every edit until resolved. Blurring an empty
  // password makes no claim, so it leaves the grace period intact.
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  const emailValid = EMAIL_SHAPE.test(email);
  const passwordMet = password.length >= 6;
  const passwordUnmet = passwordTouched && password !== "" && !passwordMet;
  const valid = name.trim() !== "" && emailValid && passwordMet;

  return (
    <form action={formAction} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <div>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => {
              if (email !== "") setEmailTouched(true);
            }}
          />
          <Collapse show={emailTouched && email !== "" && !emailValid}>
            <p className="pt-2 text-xs text-destructive">
              Enter a valid email address.
            </p>
          </Collapse>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => {
            if (password !== "") setPasswordTouched(true);
          }}
        />
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          At least 6 characters.
          {/* Check and X share one fixed slot and trade opacity, so
              the state swap crossfades without nudging the text. */}
          <span className="relative flex size-3 shrink-0">
            <Check
              aria-hidden
              className={cn(
                "absolute inset-0 size-3 text-success transition-opacity duration-300",
                passwordMet ? "opacity-100" : "opacity-0",
              )}
              strokeWidth={2.5}
            />
            <X
              aria-hidden
              className={cn(
                "absolute inset-0 size-3 text-destructive transition-opacity duration-300",
                passwordUnmet ? "opacity-100" : "opacity-0",
              )}
              strokeWidth={2.5}
            />
          </span>
        </p>
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button type="submit" disabled={pending || !valid} className="w-full">
          {pending && <Spinner />}
          Sign up
        </Button>
      </div>
    </form>
  );
}
