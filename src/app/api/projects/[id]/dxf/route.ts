import { NextResponse } from "next/server";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/projects/:id/dxf — download the generated drawing as DXF (opens in AutoCAD / LibreCAD). */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/dxf">) {
  const p = await repo().getProject((await ctx.params).id);
  if (!p?.design?.cad) return NextResponse.json({ error: "CAD preview unavailable." }, { status: 404 });
  return new NextResponse(p.design.cad.dxf, {
    headers: { "content-type": "application/dxf", "content-disposition": `attachment; filename="veatsai-${p.id}.dxf"` },
  });
}
