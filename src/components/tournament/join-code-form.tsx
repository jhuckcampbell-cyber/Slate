"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidCode, normalizeCode } from "@/lib/core/codes";

export function JoinCodeForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
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
        placeholder="TNF-8X29"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-12 font-mono text-base tracking-widest uppercase"
      />
      <Button type="submit" disabled={!valid} className="h-12 px-4" aria-label="Join">
        <ArrowRight />
      </Button>
    </form>
  );
}
