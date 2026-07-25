// The product name, always set in the display face - wherever it appears,
// including mid-sentence in body copy, it reads as the mark rather than as
// another word in the line.
//
// not-italic: the explanatory asides are italic and Array has no italic cut,
// so the mark inside one would be slanted by the browser rather than drawn.
// The mark is a fixed thing; it does not lean with the sentence around it.
export function Brand() {
  return <span className="font-heading not-italic">NextFM</span>;
}
