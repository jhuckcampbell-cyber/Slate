/**
 * Tapping odds tosses a small ink chip with the price on a short, straight line into the slip's count bubble
 * ([data-slip-target]), which then bumps. Reduced motion: no chip, just the bump. Browser-only, fire and forget.
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
        target.animate([{ transform: "scale(1)" }, { transform: "scale(1.35)" }, { transform: "scale(1)" }], {
          duration: 280,
          easing: "ease-out",
        });
      if (still) {
        bump();
        return;
      }
      const chip = document.createElement("span");
      chip.textContent = label;
      chip.setAttribute("aria-hidden", "true");
      chip.className =
        "num pointer-events-none fixed z-50 rounded-lg bg-foreground px-2 py-1 text-sm leading-none font-bold text-background";
      const x = start.left + start.width / 2;
      const y = start.top + start.height / 2;
      chip.style.left = `${x}px`;
      chip.style.top = `${y}px`;
      chip.style.transform = "translate(-50%, -50%)";
      document.body.appendChild(chip);
      const dx = end.left + end.width / 2 - x;
      const dy = end.top + end.height / 2 - y;
      const flight = chip.animate(
        [
          { transform: "translate(-50%, -50%) scale(1)" },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5)` },
        ],
        { duration: 320, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)" },
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
