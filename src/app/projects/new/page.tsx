import { aiConfigured } from "@/lib/ai/analyze";
import { DEMO_REQUEST } from "@/lib/config";
import { STANDARD_FAMILIES } from "@/lib/standards";
import { PageHeader, SafetyBanner } from "@/components/ui";
import { NewProjectForm } from "./form";

export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  return (
    <div>
      <PageHeader title="New Project" subtitle="Describe your electrical project in plain language. VeatsAI turns it into a structured engineering design." />
      <div className="mx-auto max-w-3xl space-y-6 p-8">
        <SafetyBanner />
        <NewProjectForm demoRequest={DEMO_REQUEST} prefillDemo={demo === "1"} aiConfigured={aiConfigured()} families={STANDARD_FAMILIES} />
      </div>
    </div>
  );
}
