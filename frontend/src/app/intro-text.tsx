import { InlineNav } from "./inline-nav";

export function IntroText({ className }: { className?: string }) {
  return (
    <p className={className}>
      NextFM finds upcoming concerts near you by artists that match your
      listening history, and generates Spotify playlists for you to discover
      them. Playlists update daily.
      <span className="mt-1.5 block">
        <InlineNav href="/about" className="h-5 px-1.5">
          About
        </InlineNav>
      </span>
    </p>
  );
}
