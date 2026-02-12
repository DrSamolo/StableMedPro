"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { initPerfTools, perfEnd, perfStart, recordNavigationMetricsOnce, setPerfRoute } from "@/lib/perf/metrics";

export function PerfObserver() {
  const pathname = usePathname();

  useEffect(() => {
    initPerfTools();
    setPerfRoute(pathname || window.location.pathname || "unknown");
    recordNavigationMetricsOnce(pathname || window.location.pathname || "unknown");
  }, []);

  useEffect(() => {
    setPerfRoute(pathname || "unknown");
    perfStart("route.commit");
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        perfEnd("route.commit");
      });
    });
    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
    };
  }, [pathname]);

  return null;
}
