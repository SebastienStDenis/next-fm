import { HomeLink } from "../home-link";

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-xl p-8">
      <HomeLink />
      <h1 className="mt-2 mb-6 text-2xl font-semibold tracking-tight">About</h1>
      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-medium">What NextFM does</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            NextFM finds live music you would love but don’t know yet. Your
            Last.fm listening history tells NextFM what you like, concert
            listings tell it who is playing near you, and the overlap becomes
            a Spotify playlist of artists worth discovering while they’re in
            town.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">How suggested artists work</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            NextFM looks at who sounds similar to the artists you listen to
            most and keeps the strongest matches - each one shows its reason, like
            <q>because you listen to DIIV</q>. Artists you already
            know are left out, but an artist you’ve only played a few times can
            still be suggested.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Your playlist</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            A few top tracks from each suggested artist playing near your
            city. You can pin extra cities to follow concerts where you
            travel. Playlists in Spotify are automatically updated daily as
            your listening history and upcoming concerts change.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Playlist order</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Tracks are ordered by concert date, soonest first, and the playlist
            is capped at 100 tracks. To catch new concerts fastest, sort the
            playlist by <b className="font-medium">Date added</b> in Spotify:
            newly announced
            concerts and newly suggested artists will appear at the top.
          </p>
        </section>
        <section>
          <h2 className="text-sm font-medium">Contact</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Questions, feedback and bug reports are welcome at{" "}
            <a
              href="mailto:contact@nextfm.net"
              className="underline hover:text-foreground"
            >
              contact@nextfm.net
            </a>
            . NextFM’s source code lives on{" "}
            <a
              href="https://github.com/SebastienStDenis/next-fm"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
