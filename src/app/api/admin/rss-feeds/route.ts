import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/auth";
import { addFeed, removeFeed } from "@/lib/store";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Acces refuse." }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string; url?: string };
  addFeed(body.name ?? "", body.url ?? "");
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Acces refuse." }, { status: 401 });
  }

  const body = (await request.json()) as { id?: number };
  removeFeed(Number(body.id));
  return NextResponse.json({ ok: true });
}
