import { handleAuth } from "@/lib/api";
import { calculateDesign } from "@/lib/engineering/calculate";
import { inputsFromBody } from "@/lib/engineering/from-body";

/** POST /api/engineering/calculate — deterministic engineering calculation from explicit inputs. */
export async function POST(req: Request) {
  return handleAuth(async () => calculateDesign(inputsFromBody(await req.json())));
}
