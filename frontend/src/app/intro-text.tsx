import Link from "next/link";

export function IntroText({ className }: { className?: string }) {
  return (
    <p className={className}>
      We find upcoming concerts near you by artists that match your listening
      history, and generate Spotify playlists for you to discover them. See{" "}
      <Link
        href="/about"
        className="underline underline-offset-4 hover:text-foreground"
      >
        About
      </Link>{" "}
      for more details.
    </p>
  );
}
