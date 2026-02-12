"use client";

import { useEffect, useRef } from "react";

import { perfEnd, perfStart } from "@/lib/perf/metrics";

export function useSectionPerf(sectionName: string, isLoading: boolean) {
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      perfStart(`section.interactive.${sectionName}`);
      startedRef.current = true;
    }
  }, [sectionName]);

  useEffect(() => {
    if (!startedRef.current || endedRef.current) return;
    if (isLoading) return;

    perfEnd(`section.interactive.${sectionName}`);
    endedRef.current = true;
  }, [isLoading, sectionName]);
}

