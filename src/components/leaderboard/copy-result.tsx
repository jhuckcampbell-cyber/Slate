"use client";

import { Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies the plain-text result (plain-english resultText) so it pastes into any group chat. */
export function CopyResult({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Try again.");
    }
  }

  return (
    <Button variant="outline" className={className} onClick={copy}>
      {copied ? <Check /> : <ClipboardCopy />}
      {copied ? "Copied" : "Copy result"}
    </Button>
  );
}
