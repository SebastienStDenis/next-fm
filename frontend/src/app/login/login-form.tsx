"use client";

import { useActionState } from "react";

import { Collapse } from "../collapse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { logIn } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(logIn, { error: null });

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
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <p className="pb-3 text-sm text-destructive">{state.error}</p>
        </Collapse>
        <Button type="submit" disabled={pending} className="w-full">
          {pending && <Spinner />}
          Log in
        </Button>
      </div>
    </form>
  );
}
