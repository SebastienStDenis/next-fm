"use client";

import { useActionState } from "react";

import { Collapse } from "../collapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { FormError } from "../form-error";
import { signUp } from "./actions";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
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
        />
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Spinner />}
          Sign up
        </Button>
      </div>
    </form>
  );
}
