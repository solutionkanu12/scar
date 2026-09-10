"use client";

import { useEffect, useState } from "react";

import { ScarConsole } from "./scar-console";
import type { Surface } from "./types";
import { LandingPage } from "./views/landing-page";
import { LegalPage } from "./views/legal-page";

type PublicSurface = Exclude<Surface, "console">;

function surfaceForPath(pathname: string): PublicSurface {
  if (pathname === "/privacy") return "privacy";
  if (pathname === "/terms") return "terms";
  return "landing";
}

function pathForSurface(surface: Surface): string {
  if (surface === "privacy") return "/privacy";
  if (surface === "terms") return "/terms";
  return "/";
}

export function ScarApp({ initialSurface = "landing" }: { initialSurface?: PublicSurface }) {
  const [surface, setSurface] = useState<Surface>(initialSurface);

  useEffect(() => {
    function syncWithHistory() {
      setSurface(surfaceForPath(window.location.pathname));
    }

    window.addEventListener("popstate", syncWithHistory);
    return () => window.removeEventListener("popstate", syncWithHistory);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [surface]);

  function navigate(next: Surface) {
    const path = pathForSurface(next);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setSurface(next);
  }

  if (surface === "landing") {
    return <LandingPage onOpenConsole={() => navigate("console")} onOpenLegal={navigate} />;
  }

  if (surface === "privacy" || surface === "terms") {
    return <LegalPage type={surface} onHome={() => navigate("landing")} onOpenConsole={() => navigate("console")} onOpenLegal={navigate} />;
  }

  return <ScarConsole onHome={() => navigate("landing")} />;
}
