"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidCode, normalizeCode } from "@/lib/core/codes";

const EXAMPLE = "TNF-8X29";

/** The example code types itself out once after load (skipped for reduced motion). The server renders it whole. */
function useTypedPlaceholder(stop: boolean) {
  const [shown, setShown] = useState(EXAMPLE);
  useEffect(() => {
    if (stop || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let timer = window.setTimeout(function step() {
      i += 1;
      setShown(EXAMPLE.slice(0, i));
      if (i < EXAMPLE.length) timer = window.setTimeout(step, 110);
    }, 400);
    return () => {
      window.clearTimeout(timer);
      setShown(EXAMPLE);
    };
  }, [stop]);
  return shown;
}

export function JoinCodeForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState(false);
  const placeholder = useTypedPlaceholder(touched);

  return (
    <form
      className="flex gap-2" aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeCode(String(new FormData(e.currentTarget).get("code") ?? ""));
        if (isValidCode(code)) startTransition(() => router.push(`/join/${code}`));
        else toast.error("Enter the invite code your friend sent you.");
      }}
    >
      <Input
        aria-label="Invite code"
        placeholder={placeholder}
        onFocus={() => setTouched(true)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        name="code"
        defaultValue=""
        required
        className="h-12 rounded-xl bg-card font-mono text-base tracking-widest uppercase"
      />
      <Button type="submit" variant="outline" disabled={pending} className="press h-12 rounded-xl px-4" aria-label={pending ? "Opening invite" : "Join"}>
        {pending ? <Loader2 className="motion-safe:animate-spin" /> : <ArrowRight />}
      </Button>
    </form>
  );
}
