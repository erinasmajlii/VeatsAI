import { redirect } from "next/navigation";

/** New requests are entered in the request portal of the engineer panel. */
export default function NewProjectPage() {
  redirect("/dashboard");
}
