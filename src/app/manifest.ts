import type { MetadataRoute } from "next";

/** Lets phones install Sideout as a home-screen app that opens full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sideout Fantasy Volleyball",
    short_name: "Sideout",
    description: "Private OUA women's volleyball fantasy league",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#131419",
    theme_color: "#131419",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
