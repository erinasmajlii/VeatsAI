import { handleAuth } from "@/lib/api";
import { RULES, STANDARD_FAMILIES, STANDARDS } from "@/lib/standards";

export async function GET() {
  return handleAuth(async () => ({ families: STANDARD_FAMILIES, standards: STANDARDS, rules: RULES }));
}
