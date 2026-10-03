import { PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { RequestForm } from "./request-form";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const { t } = await getT();
  return (
    <div>
      <PageHeader eyebrow={t("nav.requests")} title={t("req.title")} subtitle={t("req.sub")} />
      <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">
        <RequestForm />
      </div>
    </div>
  );
}
