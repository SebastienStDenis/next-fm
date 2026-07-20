"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

// How far the page extends past each side of the window: below the 320px
// layout floor (body min-w-80) the page scrolls horizontally instead of
// narrowing, and popovers should keep colliding with the page's edges,
// not the window's. The total overhang splits across the two sides by the
// scroll position.
function subscribeToViewport(onChange: () => void) {
  window.addEventListener("resize", onChange)
  window.addEventListener("scroll", onChange)
  return () => {
    window.removeEventListener("resize", onChange)
    window.removeEventListener("scroll", onChange)
  }
}

function usePageOverhangX() {
  const left = React.useSyncExternalStore(
    subscribeToViewport,
    () => Math.max(0, window.scrollX),
    () => 0
  )
  const right = React.useSyncExternalStore(
    subscribeToViewport,
    () =>
      Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth -
          window.scrollX
      ),
    () => 0
  )
  return { left, right }
}

// The gap every popover keeps from the page's edges when it collides.
const popoverEdgeGap = 4

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

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = popoverEdgeGap,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // Radix collides against the window; negative side paddings push those
  // edges out to the page's edges when the window is narrower than the page.
  const overhang = usePageOverhangX()
  const basePadding =
    typeof collisionPadding === "number"
      ? {
          top: collisionPadding,
          right: collisionPadding,
          bottom: collisionPadding,
          left: collisionPadding,
        }
      : collisionPadding
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={{
          ...basePadding,
          left: (basePadding.left ?? 0) - overhang.left,
          right: (basePadding.right ?? 0) - overhang.right,
        }}
        className={cn(
          "z-50 flex w-72 origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 inset-shadow-[0_1px_0_var(--glass-edge)] glass:bg-popover/75 glass:backdrop-blur-xl glass:backdrop-saturate-125 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
