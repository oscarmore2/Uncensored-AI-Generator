import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "玩玩可物 • AI Media Studio",
    short_name: "玩玩可物",
    description: "Turn a sentence or a single image into pictures, video, audio and 3D models.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#f97316",
    orientation: "any",
    categories: ["productivity", "photo", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
