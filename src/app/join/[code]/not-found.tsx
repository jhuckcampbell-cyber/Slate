import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { JoinCodeForm } from "@/components/tournament/join-code-form";
import { cn } from "@/lib/utils";

export default function TournamentNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 text-center">
      <p className="text-5xl">🤷</p>
      <h1 className="mt-4 text-2xl font-bold">No tournament with that code</h1>
      <p className="mt-2 text-muted-foreground">
        Double-check the link from your group chat, or type the code below.
      </p>
      <div className="mt-6 text-left">
        <JoinCodeForm />
      </div>
      <Link href="/create" className={cn(buttonVariants({ variant: "link" }), "mt-4")}>
        Or start your own
      </Link>
    </main>
  );
}
