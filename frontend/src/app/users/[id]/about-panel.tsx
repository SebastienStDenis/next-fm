const sections: { title: string; body: React.ReactNode }[] = [
  {
    title: "What this app does",
    body: (
      <>
        It finds live music you would love but do not know yet. Your listening
        history tells us your taste, concert listings tell us who is playing
        near you, and the overlap becomes a Spotify playlist of artists worth
        discovering while they are in town.
      </>
    ),
  },
  {
    title: "Where your taste comes from",
    body: (
      <>
        Your linked Last.fm account: the artists you have played most over the
        last year, plus every track you have loved. These are your{" "}
        <strong>known artists</strong>.
      </>
    ),
  },
  {
    title: "How suggestions are made",
    body: (
      <>
        For each artist you clearly love, we look up who sounds similar. Every
        candidate gets a score that combines two things: how similar they are
        to one of your artists, and how much you love that artist. Being
        similar to several of your artists earns a small boost, but one strong
        connection beats many weak ones. The best couple hundred become your{" "}
        <strong>suggested artists</strong> - each shows the connection that
        earned it, like &ldquo;because you listen to Slowdive&rdquo;.
      </>
    ),
  },
  {
    title: "A few plays doesn't mean you know an artist",
    body: (
      <>
        An artist only counts as known once you have really spent time with
        them - roughly twenty plays, or a loved track. Someone you brushed
        past twice on the radio is still fair game for discovery, which is why
        an artist can sit in both tabs: technically in your listening history,
        but suggested anyway. It also means playing the playlist itself does
        not instantly turn every suggestion into a &ldquo;known&rdquo; artist.
        On the flip side, we never suggest an old favorite you simply have not
        played lately - a lifetime of listening is not a discovery.
      </>
    ),
  },
  {
    title: "Suggestions stay for the show",
    body: (
      <>
        If you fall for a suggested artist and play them a lot while their
        concert is still coming up, we do not swap them out mid-decision. They
        keep their spot until the show has passed - that is the whole point of
        the product working. Suggestions whose connections genuinely fade do
        leave, though.
      </>
    ),
  },
  {
    title: "Discovery mode",
    body: (
      <>
        By default, your concerts and playlist show <em>suggested artists
        only</em> - the app bets you already know when your favorites are in
        town. Flip &ldquo;Include artists I know&rdquo; in the Discovery
        setting to see everything.
      </>
    ),
  },
  {
    title: "How the playlist is built",
    body: (
      <>
        Every suggested artist with a show within about 50 km of your city
        contributes their three best tracks, soonest show first, up to 100
        tracks. Each sync rebuilds the playlist to match the current
        concert calendar - artists whose shows have passed drop out, newly
        announced shows come in. Pin extra cities to track shows where you
        travel.
      </>
    ),
  },
  {
    title: "Keeping things fresh",
    body: (
      <>
        The sync buttons feed each other, so run them in order when something
        looks stale: <strong>artists</strong> (your taste) &rarr;{" "}
        <strong>suggestions</strong> &rarr; <strong>concerts</strong> &rarr;{" "}
        <strong>playlists</strong>. Taste moves weekly; similarity moves
        slowly, so suggestion syncs are quick once warmed up.
      </>
    ),
  },
];

export function AboutPanel() {
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-medium">{section.title}</h3>
          <p className="mt-1 text-sm text-gray-500">{section.body}</p>
        </section>
      ))}
    </div>
  );
}
