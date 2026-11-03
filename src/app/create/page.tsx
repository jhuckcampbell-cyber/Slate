import { connection } from "next/server";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/page-skeleton";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/queries";
import { CreateWizard } from "./create-wizard";

export const metadata: Metadata = { title: "Start a tournament" };

export default function CreatePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Create />
    </Suspense>
  );
}

async function Create() {
  await connection(); // per-request: auth cookies + clock (Cache Components)
  const supabase = await createClient();
  const [{ data: events, error }, viewer] = await Promise.all([
    supabase
      .from("events")
      .select("id, sport_key, sport_title, home_team, away_team, commence_time")
      .eq("status", "scheduled")
      .gt("commence_time", new Date().toISOString())
      .order("commence_time")
      .limit(200),
    getViewer(),
  ]);

  if (error) throw error;

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-32">
      <CreateWizard events={events ?? []} defaultName={viewer?.profile?.display_name ?? ""} />
    </main>
  );
}
