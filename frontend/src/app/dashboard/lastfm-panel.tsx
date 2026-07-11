"use client";

import { useActionState, useState } from "react";

import { linkLastfm, unlinkLastfm } from "./actions";
import { PencilMark } from "./pencil-mark";
import { Spinner } from "../spinner";
import { useTransientError } from "./use-transient-error";
import { XMark } from "./x-mark";

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
  const error = useTransientError(state);

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          name="username"
          placeholder="Last.fm username"
          required
          disabled={pending}
          autoFocus={hasAccount}
          className="min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-700"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Link account"
          title="Link"
          className="relative -m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
        >
          {/* Kept in the layout (just hidden) while pending so the button
              holds its size under the spinner. */}
          <span className={pending ? "invisible flex" : "flex"}>
            <LinkMark />
          </span>
          {pending && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Spinner />
            </span>
          )}
        </button>
        {hasAccount && (
          <button
            type="button"
            onClick={onDone}
            aria-label="Cancel"
            title="Cancel"
            className="-m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <XMark className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && !pending && (
        <p
          key={error.key}
          className="animate-fade-in-out text-xs text-red-600"
        >
          {error.message}
        </p>
      )}
    </form>
  );
}

// Chain link: the "connect this account" action.
function LinkMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6.5 9.5 3-3" />
      <path d="M7.75 4.5 9.25 3a2.475 2.475 0 0 1 3.5 3.5L11.25 8" />
      <path d="M8.25 11.5 6.75 13a2.475 2.475 0 0 1-3.5-3.5L4.75 8" />
    </svg>
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
  const error = useTransientError(unlinkState);

  return (
    <div>
      {/* Below 25rem the account details drop to a full-width row under the
          avatar; squeezed between the avatar and the icon buttons they'd
          overflow into overlapping columns. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 min-[25rem]:grid-cols-[auto_minmax(0,1fr)_auto]">
        {account.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatar_url}
            alt=""
            className="col-start-1 row-start-1 h-16 w-16 rounded-full"
          />
        )}
        <div className="col-span-full row-start-2 min-w-0 min-[25rem]:col-auto min-[25rem]:row-start-1">
          <p className="font-medium">{account.real_name ?? account.username}</p>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">Username</dt>
            <dd>
              {account.profile_url ? (
                <a
                  href={account.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {account.username}
                </a>
              ) : (
                account.username
              )}
            </dd>
            {account.country && (
              <>
                <dt className="text-gray-500">Country</dt>
                <dd>{account.country}</dd>
              </>
            )}
            {account.registered_at && (
              <>
                <dt className="text-gray-500">Registered</dt>
                <dd>{formatDate(account.registered_at)}</dd>
              </>
            )}
          </dl>
        </div>
        <div className="col-start-2 row-start-1 mt-1 flex items-center gap-2 justify-self-end min-[25rem]:col-start-3">
          <button
            type="button"
            onClick={onEdit}
            aria-label="Change Last.fm account"
            title="Change"
            className="-m-1 flex rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <PencilMark />
          </button>
          <form action={unlinkAction} className="flex">
            {unlinkPending ? (
              <span className="flex text-gray-500">
                <Spinner />
              </span>
            ) : (
              <button
                type="submit"
                aria-label="Unlink Last.fm account"
                title="Unlink"
                className="-m-1 flex rounded p-1 text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <XMark className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      </div>
      {error && !unlinkPending && (
        <p
          key={error.key}
          className="mt-2 animate-fade-in-out text-xs text-red-600"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
