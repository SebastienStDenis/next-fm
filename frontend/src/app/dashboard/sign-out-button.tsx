"use client";

import { useTransition } from "react";

import { signOut } from "./actions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => signOut())}>
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-muted-foreground"
      >
        {pending && <Spinner />}
        Sign out
      </Button>
    </form>
  );
}
