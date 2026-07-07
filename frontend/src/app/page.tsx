import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">
        Music playlists
      </h1>
      <p className="max-w-md text-center text-lg text-zinc-600 dark:text-zinc-400">
        Live-music discovery through listening.
      </p>
      <div className="flex gap-4">
        <Link
          className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          href="/users"
        >
          Users
        </Link>
        <Link
          className="flex h-12 items-center justify-center rounded-full bg-foreground px-6 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          href="/artists"
        >
          Artists
        </Link>
      </div>
      <Link href="/about" className="text-sm text-gray-500 hover:underline">
        How it works
      </Link>
    </main>
  );
}
