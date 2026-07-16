import { InlineNav } from "./inline-nav";

export function IntroText({ className }: { className?: string }) {
  return (
    <p className={className}>
      NextFM finds upcoming concerts near you by artists that match your
      taste, and generates Spotify playlists for you to discover them. See{" "}
      <InlineNav href="/about">About</InlineNav>{" "}
      for more details.
    </p>
  );
}
