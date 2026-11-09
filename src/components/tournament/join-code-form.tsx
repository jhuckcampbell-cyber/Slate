"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const placeholder = useTypedPlaceholder(touched);
  const code = normalizeCode(value);
  const valid = isValidCode(code);

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/join/${code}`);
      }}
    >
      <Input
        aria-label="Invite code"
        placeholder={placeholder}
        onFocus={() => setTouched(true)}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 rounded-xl bg-card font-mono text-base tracking-widest uppercase"
      />
      <Button type="submit" variant="outline" disabled={!valid} className="h-12 rounded-xl px-4" aria-label="Join">
        <ArrowRight />
      </Button>
    </form>
  );
}
