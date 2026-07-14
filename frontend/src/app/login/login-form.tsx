"use client";

import { useActionState, useState } from "react";

import { Collapse } from "../collapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { EMAIL_SHAPE } from "@/lib/validation";
import { FormError } from "../form-error";
import { logIn } from "./actions";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Punish late, revalidate eagerly: the format hint waits for the field's
  // first blur, then tracks every edit until resolved.
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(logIn, { error: null });

  const emailValid = EMAIL_SHAPE.test(email);

  return (
    <form action={formAction} noValidate className="grid gap-4">
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button
          type="submit"
          disabled={pending || !emailValid || password === ""}
          className="w-full"
        >
          {pending && <Spinner />}
          Log in
        </Button>
      </div>
    </form>
  );
}
