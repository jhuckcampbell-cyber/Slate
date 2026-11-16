"use client";

import { AppBar, DisplayTitle } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 pt-6 pb-10">
      <AppBar />
      <DisplayTitle>Let&apos;s try that again</DisplayTitle>
      <p role="alert" className="text-muted-foreground">We could not load this tournament. Try again in a moment.</p>
      <Button variant="outline" onClick={reset} className="press h-14 w-full border-2 border-foreground">Try again</Button>
    </main>
  );
}
