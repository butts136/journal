import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/auth";
import { addSearchTerm, removeSearchTerm } from "@/lib/store";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Acces refuse." }, { status: 401 });
  }

  const body = (await request.json()) as { label?: string };
  addSearchTerm(body.label ?? "");
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Acces refuse." }, { status: 401 });
  }

  const body = (await request.json()) as { id?: number };
  removeSearchTerm(Number(body.id));
  return NextResponse.json({ ok: true });
}
