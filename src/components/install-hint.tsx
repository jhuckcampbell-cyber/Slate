"use client";

import { Download, Share, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { installMode } from "@/lib/install";
import { cn } from "@/lib/utils";

type InstallPromptEvent = Event & { prompt: () => Promise<void> };

const KEY = "squadbets:install-dismissed";
/** Shown once: through the first visit it appears on (this tab's session), then never again. */
const SEEN = "squadbets:install-seen";
const THIS_VISIT = "squadbets:install-this-visit";
const noopSubscribe = () => () => {};

function wasDismissed() {
  try {
    if (localStorage.getItem(KEY) === "1") return true;
    return localStorage.getItem(SEEN) === "1" && sessionStorage.getItem(THIS_VISIT) !== "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN, "1");
    sessionStorage.setItem(THIS_VISIT, "1");
  } catch {
    // storage blocked: it shows again next visit
  }
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** "Put Slate on your home screen": iPhone gets Share-sheet instructions, Chrome/Android a button. */
export function InstallHint({ className }: { className?: string }) {
  const onClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the browser's mini-bar away; we show our own button
      setPrompt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const mode = onClient
    ? installMode({
        userAgent: navigator.userAgent,
        standalone: isStandalone(),
        canPrompt: prompt !== null,
        dismissed: dismissed || wasDismissed(),
      })
    : "none";
  useEffect(() => {
    if (mode !== "none") markSeen();
  }, [mode]);
  if (mode === "none") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: it just shows again next visit
    }
    setDismissed(true);
  };

  return (
    <aside
      aria-label="Install Slate"
      className={cn("flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border", className)}
    >
      <LogoMark className="size-9 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Get the app</p>
        {mode === "ios" ? (
          <p className="text-muted-foreground">
            Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then{" "}
            <span className="text-foreground">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-muted-foreground">One tap to your home screen. No store needed.</p>
        )}
      </div>
      {mode === "prompt" && (
        <Button
          variant="secondary"
          className="h-11"
          onClick={async () => {
            await prompt?.prompt();
            setPrompt(null);
          }}
        >
          <Download /> Install
        </Button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
