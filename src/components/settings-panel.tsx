"use client";

import { useState, useTransition } from "react";
import { RotateCw, Trash2 } from "lucide-react";

import type { FeedRecord, SearchTermRecord } from "@/lib/store";

export function SettingsPanel({
  feeds,
  searchTerms,
  stats,
}: {
  feeds: FeedRecord[];
  searchTerms: SearchTermRecord[];
  stats: {
    readyCount: number;
    downloadingCount: number;
    feedCount: number;
    termCount: number;
  };
}) {
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [termLabel, setTermLabel] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function runAction(action: () => Promise<void>) {
    setError("");

    startTransition(async () => {
      try {
        await action();
        window.location.reload();
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Action impossible.");
      }
    });
  }

  async function postJson(url: string, payload?: unknown, method = "POST") {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const json = (await response.json()) as { error?: string };
      throw new Error(json.error ?? "Requete invalide.");
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Journaux prets", value: stats.readyCount },
          { label: "Imports actifs", value: stats.downloadingCount },
          { label: "Flux surveilles", value: stats.feedCount },
          { label: "Termes suivis", value: stats.termCount },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-[24px] border border-white/60 bg-white/88 px-5 py-5 shadow-[0_18px_60px_rgba(40,32,18,0.08)]"
          >
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-stone-500">{item.label}</p>
            <p className="mt-3 font-serif text-4xl text-stone-900">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => runAction(() => postJson("/api/admin/rescan"))}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          <RotateCw size={16} />
          Verifier maintenant
        </button>
        <button
          type="button"
          onClick={() => runAction(() => postJson("/api/admin/logout"))}
          disabled={isPending}
          className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800"
        >
          Fermer la session admin
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[28px] border border-white/60 bg-white/88 p-6 shadow-[0_18px_60px_rgba(40,32,18,0.08)]">
          <div className="space-y-2">
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-stone-500">Termes suivis</p>
            <h2 className="font-serif text-3xl text-stone-900">Mots ou expressions a surveiller</h2>
            <p className="text-sm leading-6 text-stone-600">
              La detection ignore les accents et la casse. “Journal de Montreal” matchera aussi
              “Journal de Montréal”.
            </p>
          </div>

          <form
            className="mt-5 flex gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              runAction(() => postJson("/api/admin/search-terms", { label: termLabel }));
            }}
          >
            <input
              value={termLabel}
              onChange={(event) => setTermLabel(event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none"
              placeholder="Exemple: Journal de Montreal"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white"
            >
              Ajouter
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {searchTerms.map((term) => (
              <div
                key={term.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-stone-900">{term.label}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
                    Cle normalisee: {term.normalizedLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    runAction(() =>
                      postJson("/api/admin/search-terms", { id: term.id }, "DELETE"),
                    )
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-stone-700"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/60 bg-white/88 p-6 shadow-[0_18px_60px_rgba(40,32,18,0.08)]">
          <div className="space-y-2">
            <p className="text-[0.72rem] uppercase tracking-[0.24em] text-stone-500">Flux RSS</p>
            <h2 className="font-serif text-3xl text-stone-900">Sources de surveillance</h2>
            <p className="text-sm leading-6 text-stone-600">
              Ajoute ou retire les endpoints RSS/Torznab a surveiller pour l&apos;ingestion.
            </p>
          </div>

          <form
            className="mt-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              runAction(() =>
                postJson("/api/admin/rss-feeds", { name: feedName, url: feedUrl }),
              );
            }}
          >
            <input
              value={feedName}
              onChange={(event) => setFeedName(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none"
              placeholder="Nom du flux"
            />
            <textarea
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
              className="min-h-28 w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 outline-none"
              placeholder="URL du flux RSS"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white"
            >
              Ajouter le flux
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {feeds.map((feed) => (
              <div
                key={feed.id}
                className="flex items-start justify-between gap-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">{feed.name}</p>
                  <p className="break-all text-sm leading-6 text-stone-600">{feed.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    runAction(() => postJson("/api/admin/rss-feeds", { id: feed.id }, "DELETE"))
                  }
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-700"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
