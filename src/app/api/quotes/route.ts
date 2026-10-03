import { handle } from "@/lib/api";
import { repo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => repo().listQuotes());
}
