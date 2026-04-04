import { openEventStream } from "@/lib/events";
import { ensureBootstrap } from "@/lib/bootstrap";

export const runtime = "nodejs";

export async function GET() {
  await ensureBootstrap();

  return new Response(openEventStream(), {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
