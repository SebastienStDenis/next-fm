import { HomeLink } from "../home-link";

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <HomeLink />
      <h1 className="mt-2 mb-4 text-2xl font-semibold">About</h1>
      <div className="space-y-5">
        <section>
          <h2 className="text-sm font-medium">What Next.fm does</h2>
          <p className="mt-1 text-sm text-gray-500">
            It finds live music you would love but do not know yet. Your
            Last.fm listening history tells us what you like, concert listings
            tell us who is playing near you, and the overlap becomes a Spotify
            playlist of artists worth discovering while they are in town.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">How suggested artists work</h2>
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
            soonest concert first. You can pin extra cities to follow concerts
            where you travel. Tracklists are automatically updated every day
            as your listening history and upcoming concerts change.
          </p>
        </section>
      </div>
    </main>
  );
}
