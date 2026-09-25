"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Checks again every few seconds while plans are being written, up to about a minute. */
const INTERVAL_MS = 4000;
const MAX_TRIES = 15;

export function RefreshWhilePending({ pending }: { pending: number }) {
  const router = useRouter();
  useEffect(() => {
    if (pending === 0) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (tries > MAX_TRIES) clearInterval(timer);
      else router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending, router]);
  return null;
}
