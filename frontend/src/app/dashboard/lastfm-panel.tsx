"use client";

import { useActionState } from "react";

import { linkLastfm, unlinkLastfm } from "./actions";

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
  if (account === null) {
    return <LinkForm />;
  }
  return <AccountCard account={account} />;
}

function LinkForm() {
  const [state, formAction, pending] = useActionState(linkLastfm, {
    error: null,
  });

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <input
          name="username"
          placeholder="Last.fm username"
          required
          className="flex-1 rounded border border-gray-300 bg-transparent px-3 py-1 text-sm dark:border-gray-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-3 py-1 text-sm font-medium text-background disabled:opacity-50"
        >
          {pending ? "Linking..." : "Link"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function AccountCard({ account }: { account: LastfmAccount }) {
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    unlinkLastfm,
    { error: null },
  );
  const error = unlinkState.error;

  return (
    <div>
      <div className="flex items-start gap-4">
        {account.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatar_url}
            alt=""
            className="h-16 w-16 rounded-full"
          />
        )}
        <div>
          <p className="flex min-h-16 items-center font-medium">
            {account.real_name ?? account.username}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">Username</dt>
            <dd>
              {account.profile_url ? (
                <a
                  href={account.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
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
        <form action={unlinkAction} className="ml-auto flex min-h-16 items-center">
          <button
            type="submit"
            disabled={unlinkPending}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-red-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            {unlinkPending ? "Unlinking..." : "Unlink"}
          </button>
        </form>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
