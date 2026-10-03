import { Logo } from "@/components/brand";
import { PageHeader } from "@/components/ui";
import { COMPANY } from "@/lib/config";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const { t } = await getT();
  const pillars = [
    { t: t("about.mission.t"), d: t("about.mission.d") },
    { t: t("about.workflow.t"), d: t("about.workflow.d") },
    { t: t("about.accountability.t"), d: t("about.accountability.d") },
  ];
  return (
    <div>
      <PageHeader eyebrow={t("nav.about")} title={t("about.title")} subtitle={t("about.sub")} />
      <div className="mx-auto max-w-4xl space-y-8 px-5 py-8 sm:px-8">
        <Logo className="h-9 w-auto text-foreground" />
        <p className="max-w-2xl text-lg font-medium leading-relaxed tracking-tight">{t("about.lead")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {pillars.map((p) => (
            <div key={p.t} className="card p-5">
              <h2 className="text-sm font-semibold">{p.t}</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{p.d}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-5 text-sm text-muted-foreground">
          <div className="eyebrow mb-2">{t("about.contact")}</div>
          <div className="text-foreground">{COMPANY.name}</div>
          <div>{COMPANY.address}</div>
          <div>{COMPANY.email}</div>
        </div>
      </div>
    </div>
  );
}
