"use client";

import { startTransition, useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { changeEmail } from "./actions";
import type { ActionState } from "./actions";
import { Collapse } from "../collapse";
import { FormError } from "../form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ChangeEmailButton() {
  const [open, setOpen] = useState(false);
  // Bumped on each open so the form remounts fresh: field state and the
  // useActionState error (which has no reset) don't linger from a prior open.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setSession((n) => n + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Change email"
          title="Change email"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
        </DialogHeader>
        <ChangeEmailForm key={session} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ChangeEmailForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  // Punish late, revalidate eagerly: the format hint waits for the field's
  // first blur, then tracks every edit until resolved.
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changeEmail(prev, formData);
      // On success close the dialog; the change needs confirming from both
      // inboxes, so the toast spells that out.
      if (!result.error) {
        onDone();
        toast.success("Confirmation links sent.", {
          description:
            "Confirm from both your current and new address to finish.",
        });
      }
      return result;
    },
    { error: null },
  );

  return (
    // Drive the action manually rather than via the form's `action` prop: on a
    // successful `<form action>` React auto-resets the form, which blanks these
    // controlled fields at the DOM level. Since the dialog stays mounted for its
    // close animation, that blanked form would flash before it dismisses.
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="new-email">New email</Label>
        <div>
          <Input
            id="new-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
          />
          <Collapse
            show={emailTouched && email !== "" && !EMAIL_SHAPE.test(email)}
          >
            <p className="pt-2 text-xs text-destructive">
              Enter a valid email address.
            </p>
          </Collapse>
        </div>
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button type="submit" disabled={pending || !EMAIL_SHAPE.test(email)}>
          {pending && <Spinner />}
          Send confirmation links
        </Button>
      </div>
    </form>
  );
}
