import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["nano", "micro", "label", "caption", "subheading", "heading"],
      tracking: ["label-xs", "label", "label-sm", "label-lg", "caps"],
      leading: ["body-sm", "body", "label", "title"],
      shadow: ["card-inset", "card-lift"],
      spacing: [
        "inset-sm",
        "inset",
        "inset-lg",
        "control",
        "icon-lg",
        "row-md",
        "row-lg",
        "panel-min",
        "menu-offset",
        "auth-header",
        "sidebar-sm",
        "sidebar",
        "toast",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
