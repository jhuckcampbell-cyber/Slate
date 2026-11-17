/**
 * Tapping odds tosses an ink poker chip (dashed white ring) on a short arc into the slip's count bubble
 * ([data-slip-target]), spinning as it goes; the bubble bumps and settles. The price itself presses in (pressed ink).
 * Reduced motion: no chip, just the bump. Browser-only, fire and forget. `label` names the chip for debugging only.
 */
export function flyToSlip(from: HTMLElement, label: string): void {
  if (typeof window === "undefined") return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const start = from.getBoundingClientRect();
  // The slip bar may only render after this pick lands in the store: look for it two frames later.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[data-slip-target]");
      if (!target) return;
      const end = target.getBoundingClientRect();
      if (end.width === 0) return;
      const bump = () =>
        target.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.45)", offset: 0.35 },
            { transform: "scale(0.9)", offset: 0.65 },
            { transform: "scale(1)" },
          ],
          { duration: 380, easing: "ease-out" },
        );
      if (still) {
        bump();
        return;
      }
      const chip = document.createElement("span");
      chip.dataset.chip = label;
      chip.setAttribute("aria-hidden", "true");
      chip.className =
        "pointer-events-none fixed z-50 size-6 rounded-full border-2 border-dashed border-background bg-foreground outline-2 outline-foreground";
      const x = start.left + start.width / 2;
      const y = start.top + start.height / 2;
      chip.style.left = `${x}px`;
      chip.style.top = `${y}px`;
      chip.style.transform = "translate(-50%, -50%)";
      document.body.appendChild(chip);
      const dx = end.left + end.width / 2 - x;
      const dy = end.top + end.height / 2 - y;
      // A toss, not a slide: up and over (peak 70px above the higher end), spinning, shrinking into the bubble.
      const lift = Math.min(0, dy) - 70;
      const flight = chip.animate(
        [
          { transform: "translate(-50%, -50%) scale(0.6) rotate(0deg)" },
          { transform: "translate(-50%, -50%) scale(1.1) rotate(40deg)", offset: 0.12 },
          { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% + ${lift}px)) scale(1.1) rotate(180deg)`, offset: 0.5 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6) rotate(340deg)` },
        ],
        { duration: 520, easing: "cubic-bezier(0.33, 0, 0.4, 1)" },
      );
      flight.finished.then(
        () => {
          chip.remove();
          bump();
        },
        () => chip.remove(),
      );
    }),
  );
}
