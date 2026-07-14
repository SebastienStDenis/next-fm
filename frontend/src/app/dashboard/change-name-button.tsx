"use client";

import { startTransition, useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { changeName } from "./actions";
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

export function ChangeNameButton({ currentName }: { currentName: string }) {
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
          aria-label="Change name"
          title="Change name"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change name</DialogTitle>
        </DialogHeader>
        <ChangeNameForm
          key={session}
          currentName={currentName}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChangeNameForm({
  currentName,
  onDone,
}: {
  currentName: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(currentName);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changeName(prev, formData);
      if (!result.error) {
        onDone();
        toast.success("Name updated.");
      }
      return result;
    },
    { error: null },
  );

  const trimmed = name.trim();
  const unchanged = trimmed === currentName;

  return (
    // Drive the action manually rather than via the form's `action` prop: on a
    // successful `<form action>` React auto-resets the form, which blanks these
    // controlled fields at the DOM level. Since the dialog stays mounted for its
    // close animation, that blanked form would flash before it dismisses.
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="new-name">Name</Label>
        <Input
          id="new-name"
          name="name"
          type="text"
          required
          maxLength={50}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button type="submit" disabled={pending || trimmed === "" || unchanged}>
          {pending && <Spinner />}
          Save
        </Button>
      </div>
    </form>
  );
}
