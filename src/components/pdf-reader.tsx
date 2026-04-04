"use client";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ChevronLeft, ChevronRight, Minus, Plus, Rows3, ScrollText } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type ReaderMode = "vertical" | "horizontal";

export function PdfReader({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [mode, setMode] = useState<ReaderMode>("vertical");
  const [zoom, setZoom] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1200);
  const deferredZoom = useDeferredValue(zoom);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      setViewportWidth(entry.contentRect.width);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pageWidth = Math.max(
    280,
    Math.floor(
      (mode === "vertical" ? Math.min(viewportWidth - 56, 1120) : Math.min(viewportWidth * 0.74, 920)) *
        deferredZoom,
    ),
  );

  const pages = Array.from({ length: numPages }, (_, index) => index + 1);

  return (
    <div className="space-y-4">
      <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/60 bg-white/88 px-4 py-3 shadow-[0_20px_60px_rgba(40,33,18,0.08)] backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startTransition(() => setMode("vertical"))}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${
              mode === "vertical" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"
            }`}
          >
            <Rows3 size={16} />
            Vertical
          </button>
          <button
            type="button"
            onClick={() => startTransition(() => setMode("horizontal"))}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm ${
              mode === "horizontal" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700"
            }`}
          >
            <ScrollText size={16} />
            Horizontal
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(0.75, Number((current - 0.1).toFixed(2))))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-800"
          >
            <Minus size={16} />
          </button>
          <div className="min-w-20 text-center text-sm font-medium text-stone-700">
            {Math.round(deferredZoom * 100)}%
          </div>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(1.8, Number((current + 0.1).toFixed(2))))}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-800"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="rounded-[32px] border border-stone-200/70 bg-[linear-gradient(180deg,#efe3cf_0%,#f7f1e7_100%)] p-4 shadow-[0_24px_100px_rgba(54,42,24,0.08)]"
      >
        <Document
          file={fileUrl}
          loading={<div className="py-24 text-center text-stone-500">Chargement du PDF…</div>}
          onLoadSuccess={({ numPages: nextNumPages }) => setNumPages(nextNumPages)}
          error={<div className="py-24 text-center text-red-600">Impossible de charger ce PDF.</div>}
        >
          <div
            className={
              mode === "vertical"
                ? "grid gap-10"
                : "flex snap-x snap-mandatory gap-8 overflow-x-auto pb-4"
            }
          >
            {pages.map((pageNumber) => (
              <div
                key={pageNumber}
                className={
                  mode === "vertical"
                    ? "mx-auto"
                    : "snap-center shrink-0 rounded-[24px] bg-white/60 p-3 shadow-[0_18px_50px_rgba(35,26,13,0.08)]"
                }
              >
                <Page
                  pageNumber={pageNumber}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  loading={<div className="h-32 animate-pulse rounded-[20px] bg-stone-200/70" />}
                />
                <div className="mt-3 flex items-center justify-center gap-3 text-xs uppercase tracking-[0.24em] text-stone-500">
                  {mode === "horizontal" ? <ChevronLeft size={12} /> : null}
                  <span>Page {pageNumber}</span>
                  {mode === "horizontal" ? <ChevronRight size={12} /> : null}
                </div>
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
