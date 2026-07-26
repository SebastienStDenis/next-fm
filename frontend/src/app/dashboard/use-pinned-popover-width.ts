"use client"

import * as React from "react"

import { useOnScreen } from "@/components/on-screen"
import { popoverEdgeGap } from "@/components/ui/popover"

// Keeps an align="start" popover's left edge pinned to its trigger: the
// popover narrows down to minWidth rather than let the collision shift
// slide it off its trigger, and only below the floor does the shift take
// over, so a far-right trigger still gets a readable card. Radix reports
// available width only after shifting, so the cap that prevents the shift
// has to be measured from the trigger itself, against the page's right
// edge (the page, not the window: below the 320px layout floor the page
// scrolls horizontally).
export function usePinnedPopoverWidth(minWidth = 208) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  const [maxWidth, setMaxWidth] = React.useState<number>()
  // The popover unmounts with its surface; forget it was open so returning to
  // the surface doesn't bring it back.
  const onScreen = useOnScreen()
  if (!onScreen && open) setOpen(false)

  const measure = React.useCallback(() => {
    if (!triggerRef.current) return
    const available =
      document.documentElement.scrollWidth -
      window.scrollX -
      triggerRef.current.getBoundingClientRect().left -
      popoverEdgeGap
    setMaxWidth(Math.max(minWidth, available))
  }, [minWidth])

  const onOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) measure()
      setOpen(nextOpen)
    },
    [measure]
  )

  React.useEffect(() => {
    if (!open) return
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure)
    }
  }, [open, measure])

  return { triggerRef, open, onOpenChange, maxWidth }
}
