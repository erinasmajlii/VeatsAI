import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/projects/:id/dxf — download the generated single-line drawing as DXF (opens in AutoCAD / LibreCAD). */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/dxf">) {
  try {
    await requireUser();
    const p = await repo().getProject((await ctx.params).id);
    if (!p?.design?.cad) return NextResponse.json({ error: "CAD preview unavailable." }, { status: 404 });
    return new NextResponse(p.design.cad.dxf, {
      headers: { "content-type": "application/dxf", "content-disposition": `attachment; filename="veatsai-${p.id}.dxf"` },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
