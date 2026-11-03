"use client";

import { Check, MessageSquare, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  code: string;
  /** Absolute invite URL, built on the server from NEXT_PUBLIC_SITE_URL. */
  url: string;
  title: string;
  bankrollLabel: string;
  className?: string;
};

export function shareText(title: string, bankrollLabel: string) {
  return `${title}: ${bankrollLabel} in play money, picks stay hidden till kickoff. You in?`;
}

export function ShareButton({ code, url, title, bankrollLabel, className }: Props) {
  const [copied, setCopied] = useState(false);
  const text = shareText(title, bankrollLabel);

  async function onShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return; // user dismissed sheet
      }
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={className}>
      <div className="flex gap-2">
        <Button className="h-12 flex-1 text-base" onClick={onShare}>
          {copied ? <Check /> : <Share2 />}
          {copied ? "Link copied" : "Invite the squad"}
        </Button>
        <a
          aria-label="Share by text message"
          href={`sms:?&body=${encodeURIComponent(`${text} ${url}`)}`}
          className="inline-flex size-12 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted"
        >
          <MessageSquare className="size-5" />
        </a>
      </div>
      <p className="mt-2 text-center font-mono text-sm tracking-widest text-muted-foreground">
        {code}
      </p>
    </div>
  );
}
