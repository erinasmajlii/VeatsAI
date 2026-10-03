import { NextResponse } from "next/server";
import { RULES, STANDARD_FAMILIES, STANDARDS } from "@/lib/standards";

export function GET() {
  return NextResponse.json({ families: STANDARD_FAMILIES, standards: STANDARDS, rules: RULES });
}
