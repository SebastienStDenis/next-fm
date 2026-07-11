"use client";

import { useActionState, useEffect, useState } from "react";

import { Link2, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { linkLastfm, unlinkLastfm } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export type LastfmAccount = {
  id: string;
  username: string;
  real_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  country: string | null;
  registered_at: string | null;
  last_synced_at: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function LastfmPanel({
  account,
}: {
  account: LastfmAccount | null;
}) {
  const [editing, setEditing] = useState(false);
  // A fresh server payload (a successful re-link included) closes the edit
  // form, same as the city panel.
  const [prevAccount, setPrevAccount] = useState(account);
  if (account !== prevAccount) {
    setPrevAccount(account);
    setEditing(false);
  }

  if (account === null || editing) {
    return (
      <LinkForm
        hasAccount={account !== null}
        onDone={() => setEditing(false)}
      />
    );
  }
  return <AccountCard account={account} onEdit={() => setEditing(true)} />;
}

function LinkForm({
  hasAccount,
  onDone,
}: {
  hasAccount: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(linkLastfm, {
    error: null,
  });

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="lastfm-username" className="sr-only">
          Last.fm username
        </Label>
        <Input
          id="lastfm-username"
          name="username"
          placeholder="Last.fm username"
          required
          disabled={pending}
          autoFocus={hasAccount}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label="Link account"
          title="Link"
          className="text-muted-foreground"
        >
          {pending ? <Spinner /> : <Link2 aria-hidden />}
        </Button>
        {hasAccount && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDone}
            aria-label="Cancel"
            title="Cancel"
            className="text-muted-foreground"
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      {state.error && !pending && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}

function AccountCard({
  account,
  onEdit,
}: {
  account: LastfmAccount;
  onEdit: () => void;
}) {
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    unlinkLastfm,
    { error: null },
  );
  // State-object identity changes with every attempt, so repeat failures
  // re-toast.
  useEffect(() => {
    if (unlinkState.error) {
      toast.error(unlinkState.error);
    }
  }, [unlinkState]);

  return (
    // Below 25rem the account details drop to a full-width row under the
    // avatar; squeezed between the avatar and the icon buttons they'd
    // overflow into overlapping columns.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 min-[25rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
      <Avatar className="col-start-1 row-start-1 size-16">
        {account.avatar_url && <AvatarImage src={account.avatar_url} alt="" />}
        <AvatarFallback className="text-xl">
          {account.username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="col-span-full row-start-2 min-w-0 min-[25rem]:col-auto min-[25rem]:row-start-1">
        <p className="font-medium">{account.real_name ?? account.username}</p>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Username</dt>
          <dd>
            {account.profile_url ? (
              <a
                href={account.profile_url}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-muted-foreground"
              >
                {account.username}
              </a>
            ) : (
              account.username
            )}
          </dd>
          {account.country && (
            <>
              <dt className="text-muted-foreground">Country</dt>
              <dd>{account.country}</dd>
            </>
          )}
          {account.registered_at && (
            <>
              <dt className="text-muted-foreground">Registered</dt>
              <dd>{formatDate(account.registered_at)}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="col-start-2 row-start-1 flex items-center gap-1 justify-self-end min-[25rem]:col-start-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label="Change Last.fm account"
          title="Change"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
        <form action={unlinkAction} className="flex">
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            disabled={unlinkPending}
            aria-label="Unlink Last.fm account"
            title="Unlink"
            className="text-destructive hover:text-destructive"
          >
            {unlinkPending ? <Spinner className="text-muted-foreground" /> : <X aria-hidden />}
          </Button>
        </form>
      </div>
    </div>
  );
}
