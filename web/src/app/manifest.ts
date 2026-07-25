import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "玩玩可物 • AI Media Studio",
    short_name: "玩玩可物",
    description: "AI image and video generation platform for text-to-image, text-to-video and image-to-video creation.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#8b5cf6",
    orientation: "any",
    categories: ["productivity", "photo", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
