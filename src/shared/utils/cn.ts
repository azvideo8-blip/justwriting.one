import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the design-system's custom font-size utilities (defined in index.css)
// so tailwind-merge treats them as font sizes. Otherwise a bespoke `text-label`
// can't override a primitive's default `text-sm`, leaking an oversized font.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "label-sm"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
