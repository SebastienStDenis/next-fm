// The standard chip (docs/theme.md): an outline badge in muted text, its
// weight dialed back from the badge default so it reads as metadata.
export const CHIP_CLASS = "font-normal text-muted-foreground";

// A lowercase chip label centers on its x-height rather than the font box:
// Satoshi's tall ascent otherwise sits lowercase low with descenders crowding
// the border. The trim shrinks the box to the x-height, and the equal padding
// restores room for ascenders and descenders under `truncate`'s clip.
// Number-led chips skip it - digits are cap-height and already center.
export const CHIP_LABEL_CLASS =
  "truncate py-1 [text-box:trim-both_ex_alphabetic]";
