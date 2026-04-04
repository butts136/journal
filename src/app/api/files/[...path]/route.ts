import fs from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { resolveManagedPath } from "@/lib/storage";

export const runtime = "nodejs";

function getContentType(filePath: string) {
  if (filePath.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (filePath.endsWith(".png")) {
    return "image/png";
  }

  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const params = await context.params;
  const relativePath = params.path.join("/");

  try {
    const absolutePath = resolveManagedPath(relativePath);
    const stat = await fs.promises.stat(absolutePath);
    const stream = Readable.toWeb(fs.createReadStream(absolutePath)) as ReadableStream;

    return new Response(stream, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Length": stat.size.toString(),
        "Content-Type": getContentType(absolutePath),
      },
    });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }
}
