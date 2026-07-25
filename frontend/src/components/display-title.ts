// The display face on a card title (docs/theme.md): worn by the artist and
// concert cards - the catalogue the app is for - and by nothing else.
// text-base holds the popover form at the size the card form gets from
// CardTitle, and leading-snug restates the line height CardTitle sets: a
// font-size utility overrides any leading-* before it, so appending text-base
// would otherwise drop it.
// font-[400], not a named step: Array is cut at 400/600/700 with nothing
// between, and a named step would land on its 600.
export const DISPLAY_TITLE_CLASS = "font-heading text-base leading-snug font-[400]";

// What a score pill or status dot sits in when it rides a title row. The box
// is exactly the title's first line (22px: text-base at leading-snug) and
// centres its contents in it, so each rider lands level with the words beside
// it whatever its own height - and, in a row set to items-start, stays on that
// first line when a long name wraps below it.
export const TITLE_RIDER_CLASS = "flex min-h-[22px] shrink-0 items-center";
