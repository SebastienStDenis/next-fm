// The display face on a card title (docs/theme.md): worn by the artist and
// concert cards - the catalogue the app is for - and by nothing else.
// text-base holds the popover form at the size the card form gets from
// CardTitle, so a title reads the same whichever one it is in.
// font-[400], not a named step: Array is cut at 400/600/700 with nothing
// between, and a named step would land on its 600.
export const DISPLAY_TITLE_CLASS = "font-heading text-base font-[400]";
