"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function LiveJournalRefresh() {
  const router = useRouter();
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [lastSignal, setLastSignal] = useState("Synchronisation en cours");

  useEffect(() => {
    const events = new EventSource("/api/events");

    events.addEventListener("connected", () => {
      setStatus("live");
      setLastSignal("Surveillance active");
    });

    events.addEventListener("journal-updated", () => {
      setStatus("live");
      setLastSignal("Nouveau journal disponible");
      router.refresh();
    });

    events.addEventListener("journal-error", () => {
      setStatus("live");
      setLastSignal("Un journal n'a pas pu etre importe");
      router.refresh();
    });

    events.onerror = () => {
      setStatus("offline");
      setLastSignal("Connexion temps reel interrompue");
    };

    return () => {
      events.close();
    };
  }, [router]);

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-stone-300/70 bg-white/80 px-4 py-2 text-xs uppercase tracking-[0.24em] text-stone-600 backdrop-blur">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          status === "live"
            ? "bg-emerald-500"
            : status === "connecting"
              ? "bg-amber-400"
              : "bg-stone-400"
        }`}
      />
      <span>{lastSignal}</span>
    </div>
  );
}
