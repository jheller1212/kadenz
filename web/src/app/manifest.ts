import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kadenz",
    short_name: "Kadenz",
    description: "Personal running training plan app",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Default theme is light; runtime theme-color is managed by ThemeProvider
    background_color: "#EEF0F4",
    theme_color: "#EEF0F4",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
