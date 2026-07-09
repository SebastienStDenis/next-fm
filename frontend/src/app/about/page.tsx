import { BackButton } from "../back-button";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <BackButton fallbackHref="/dashboard" />
      <h1 className="mt-2 mb-4 text-2xl font-semibold">About</h1>
      <div className="space-y-5">
        <section>
          <h2 className="text-sm font-medium">What Next.fm does</h2>
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
            know are left out; an artist you have only played a few times can
            still be suggested.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Your playlist</h2>
          <p className="mt-1 text-sm text-gray-500">
            A few top tracks from each suggested artist playing near your city,
            soonest concert first. Every sync rebuilds it against the current
            concert calendar, and you can pin extra cities to follow concerts
            where you travel. Your taste and playlists are regularly updated to
            stay up to date.
          </p>
        </section>
      </div>
    </main>
  );
}
