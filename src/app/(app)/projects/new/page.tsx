import { redirect } from "next/navigation";

/** New requests are entered in the Requests Portal. */
export default function NewProjectPage() {
  redirect("/requests");
}
