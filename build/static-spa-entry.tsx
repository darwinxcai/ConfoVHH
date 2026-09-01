/**
 * Browser entry point for the static single-page build.
 *
 * The Cloudflare Worker path mounts app/page.tsx through the framework router.
 * ConfoVHH has exactly one route and no server rendering requirements, so the
 * static path mounts the same client component directly.
 */
import { createRoot } from "react-dom/client";

import "@/app/globals.css";
import ConfoVHHPage from "@/app/page";

const container = document.getElementById("confovhh-root");

if (!container) {
  throw new Error(
    "ConfoVHH could not start: the #confovhh-root mount point is missing from index.html.",
  );
}

createRoot(container).render(<ConfoVHHPage />);
