import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <Link href="/" className="text-sm text-gray-500 hover:underline">
        &larr; Home
      </Link>
      <h1 className="mt-2 mb-4 text-2xl font-semibold">About</h1>
      <div className="space-y-5">
        <section>
          <h2 className="text-sm font-medium">What this app does</h2>
          <p className="mt-1 text-sm text-gray-500">
            It finds live music you would love but do not know yet. Your
            Last.fm listening tells us your taste, concert listings tell us who
            is playing near you, and the overlap becomes a Spotify playlist of
            artists worth discovering while they are in town.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">How suggestions work</h2>
          <p className="mt-1 text-sm text-gray-500">
            We look at who sounds similar to the artists you listen to most and
            keep the strongest matches - each one shows its reason, like
            &ldquo;because you listen to Slowdive&rdquo;. Artists you already
            know are left out; a name you have only brushed past is fair game.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Discovery mode</h2>
          <p className="mt-1 text-sm text-gray-500">
            By default your concerts and playlist show suggested artists only -
            the app bets you already know when your favorites are in town. The
            &ldquo;Include artists I know&rdquo; setting shows everything.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Your playlist</h2>
          <p className="mt-1 text-sm text-gray-500">
            A few top tracks from each suggested artist playing near your city,
            soonest show first. Every sync rebuilds it against the current
            concert calendar, and you can pin extra cities to follow shows
            where you travel. When something looks stale, sync in order:
            artists, then suggestions, then concerts, then playlists.
          </p>
        </section>
      </div>
    </main>
  );
}
