import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Touch devices scroll a focused field above the virtual keyboard only when
// the user taps it; focusing programmatically pops the keyboard without that
// scroll, leaving the field hidden behind it. A coarse primary pointer is the
// signal to skip auto-focus and let the user's tap trigger the native scroll.
export function hasVirtualKeyboard() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true
  )
}
