"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { TabSwitch } from "@/components/tab-switch";
import { cn } from "@/lib/utils";

type Tab = "leaderboard" | "games";

/**
 * After lock: Leaderboard | Games. The tab lives in `?tab=games` so a refresh (and Realtime's router.refresh()) keeps
 * it; switching only rewrites the URL (no server round trip). Both panels stay mounted, so open dropdowns survive.
 */
export function PostLockTabs({
  leaderboard,
  games,
  className,
}: {
  leaderboard: React.ReactNode;
  games: React.ReactNode;
  className?: string;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "games" ? "games" : "leaderboard");

  function choose(next: Tab) {
    setTab(next);
    const q = new URLSearchParams(params.toString());
    if (next === "games") q.set("tab", "games");
    else q.delete("tab");
    const s = q.toString();
    window.history.replaceState(null, "", s ? `${pathname}?${s}` : pathname);
  }

  return (
    <div className={cn("mt-6", className)}>
      <TabSwitch<Tab>
        label="Leaderboard or games"
        value={tab}
        onChange={choose}
        options={[
          { value: "leaderboard", label: "Leaderboard" },
          { value: "games", label: "Games" },
        ]}
      />
      <div role="tabpanel" aria-label="Leaderboard" hidden={tab !== "leaderboard"}>
        {leaderboard}
      </div>
      <div role="tabpanel" aria-label="Games" hidden={tab !== "games"} className="pt-5">
        {games}
      </div>
    </div>
  );
}
