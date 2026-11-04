import type { MetadataRoute } from "next";

/**
 * Installable web app: "Add to Home Screen" opens Slate full-screen with its own icon.
 * Icons come from scripts/make-icons.mjs. Colors match layout.tsx's themeColor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Slate",
    short_name: "Slate",
    description: "Play-money betting tournaments with your friends. Blind picks, live sweat.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e1220",
    theme_color: "#0e1220",
    categories: ["games", "sports", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
