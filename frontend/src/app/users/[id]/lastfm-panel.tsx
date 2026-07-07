"use client";

import { useActionState } from "react";

import { linkLastfm, refreshLastfm, unlinkLastfm } from "./actions";

export type LastfmAccount = {
  id: string;
  username: string;
  real_name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  country: string | null;
  registered_at: string | null;
  playcount: number | null;
  artist_count: number | null;
  last_synced_at: string | null;
};

const numberFormat = new Intl.NumberFormat("en-US");

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function LastfmPanel({
  userId,
  account,
}: {
  userId: string;
  account: LastfmAccount | null;
}) {
  if (account === null) {
    return <LinkForm userId={userId} />;
  }
  return <AccountCard userId={userId} account={account} />;
}

function LinkForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(
    linkLastfm.bind(null, userId),
    { error: null },
  );

  return (
    <form action={formAction} className="space-y-2">
      <p className="text-sm text-gray-500">
        No Last.fm account linked. Link one to match concerts to listening
        history.
      </p>
      <div className="flex gap-2">
        <input
          name="username"
          placeholder="Last.fm username"
          required
          className="flex-1 rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "Linking..." : "Link"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function AccountCard({
  userId,
  account,
}: {
  userId: string;
  account: LastfmAccount;
}) {
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshLastfm.bind(null, userId),
    { error: null },
  );
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(
    unlinkLastfm.bind(null, userId),
    { error: null },
  );
  const error = refreshState.error ?? unlinkState.error;

  return (
    <div>
      <div className="flex items-center gap-4">
        {account.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatar_url}
            alt=""
            className="h-16 w-16 rounded-full"
          />
        )}
        <div>
          {account.profile_url ? (
            <a
              href={account.profile_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {account.username}
            </a>
          ) : (
            <span className="font-medium">{account.username}</span>
          )}
          {account.real_name && (
            <p className="text-sm text-gray-500">{account.real_name}</p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {account.playcount !== null && (
          <>
            <dt className="text-gray-500">Scrobbles</dt>
            <dd>{numberFormat.format(account.playcount)}</dd>
          </>
        )}
        {account.artist_count !== null && (
          <>
            <dt className="text-gray-500">Artists</dt>
            <dd>{numberFormat.format(account.artist_count)}</dd>
          </>
        )}
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

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-gray-500 italic">
          {account.last_synced_at
            ? `Last synced ${formatDateTime(account.last_synced_at)}`
            : "Never synced"}
        </p>
        <div className="flex gap-2">
          <form action={refreshAction}>
            <button
              type="submit"
              disabled={refreshPending}
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              {refreshPending ? "Refreshing..." : "Refresh"}
            </button>
          </form>
          <form action={unlinkAction}>
            <button
              type="submit"
              disabled={unlinkPending}
              className="rounded border border-gray-300 px-3 py-1 text-sm text-red-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              {unlinkPending ? "Unlinking..." : "Unlink"}
            </button>
          </form>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
