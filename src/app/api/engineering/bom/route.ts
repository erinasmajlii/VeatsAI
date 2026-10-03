import { handle } from "@/lib/api";
import { bomWarnings, finalizeBom, generateBaseBom } from "@/lib/bom";
import { repo } from "@/lib/db";
import { calculateDesign } from "@/lib/engineering/calculate";
import { inputsFromBody } from "@/lib/engineering/from-body";

/** POST /api/engineering/bom — calculation + component selection + inventory check. */
export async function POST(req: Request) {
  return handle(async () => {
    const calc = calculateDesign(inputsFromBody(await req.json()));
    const products = await repo().listProducts();
    const bom = finalizeBom(generateBaseBom(calc, products), {}, [], products);
    return { calculation: calc, bom, warnings: bomWarnings(bom, calc, products) };
  });
}
