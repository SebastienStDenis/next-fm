"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn, hasVirtualKeyboard } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const dismissRef = React.useRef<HTMLButtonElement>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // The Radix content is a full-viewport scroll container and the
        // visible panel a centered child: a fixed panel can never be
        // scrolled into view, so when the panel's min-w floor exceeds a
        // sub-320px viewport this layer grows a horizontal scrollbar
        // instead of clipping the panel. The scroller must be the Radix
        // content, not a wrapper around it: react-remove-scroll only
        // permits wheel and touch scrolling inside the content subtree.
        className="fixed inset-0 z-50 flex overflow-auto p-4 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          // On touch devices, let the user's tap open the keyboard so the
          // browser scrolls the focused field above it; auto-focusing on open
          // pops the keyboard without that scroll, hiding the field.
          if (!event.defaultPrevented && hasVirtualKeyboard()) {
            event.preventDefault()
          }
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event)
          if (event.defaultPrevented || event.target !== event.currentTarget) {
            return
          }
          // The gutter around the panel belongs to this layer, so Radix
          // never sees a pointerdown "outside" and the light-dismiss it
          // gives the overlay must be re-created here. Presses on the
          // layer's own scrollbars also target it; only clicks inside the
          // client area dismiss.
          const content = event.currentTarget
          const rect = content.getBoundingClientRect()
          const inClientArea =
            event.clientX < rect.left + content.clientLeft + content.clientWidth &&
            event.clientY < rect.top + content.clientTop + content.clientHeight
          if (inClientArea) {
            dismissRef.current?.click()
          }
        }}
        {...props}
      >
        <div
          data-slot="dialog-panel"
          className={cn(
            "relative m-auto grid w-full min-w-[18rem] gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 sm:max-w-sm",
            className
          )}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              >
                <XIcon
                />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
        <DialogPrimitive.Close
          ref={dismissRef}
          tabIndex={-1}
          className="hidden"
        />
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
