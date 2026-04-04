import fs from "node:fs/promises";
import path from "node:path";

import { createCanvas } from "@napi-rs/canvas";

import { ensureDir } from "@/lib/utils";

export async function generatePdfArtifacts(pdfPath: string, thumbnailPath: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    verbosity: 0,
  });

  const document = await loadingTask.promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1.45 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");

  await page.render({
    canvas: canvas as never,
    canvasContext: context as never,
    viewport,
  }).promise;

  await ensureDir(path.dirname(thumbnailPath));
  await fs.writeFile(thumbnailPath, await canvas.encode("png"));

  return {
    pageCount: document.numPages,
  };
}
