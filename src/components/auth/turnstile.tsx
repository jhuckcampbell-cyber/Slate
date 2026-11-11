"use client";

import Script from "next/script";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

type TurnstileApi = {
  render(container: HTMLElement, options: {
    sitekey: string;
    appearance: "interaction-only";
    "response-field": boolean;
    callback: (token: string) => void;
    "error-callback": () => void;
    "expired-callback": () => void;
    "timeout-callback": () => void;
  }): string;
  remove(id: string): void;
};

export type TurnstileHandle = { getToken(): Promise<string> };

/** Managed widgets stay invisible unless Cloudflare requires interaction. */
export function Turnstile({ ref }: { ref: Ref<TurnstileHandle> }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const container = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => () => cancel.current?.(), []);

  useImperativeHandle(ref, () => ({
    getToken: () => new Promise<string>((resolve, reject) => {
      cancel.current?.();
      const api = (window as Window & { turnstile?: TurnstileApi }).turnstile;
      if (!siteKey || !api || !container.current) {
        reject(new Error("CAPTCHA_FAILED"));
        return;
      }
      let widget: string | undefined;
      let settled = false;
      const finish = (token?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancel.current = null;
        // Leave render() before removing a widget, including synchronous errors.
        queueMicrotask(() => { if (widget !== undefined) api.remove(widget); });
        if (token) resolve(token);
        else reject(new Error("CAPTCHA_FAILED"));
      };
      const timer = setTimeout(() => finish(), 60_000);
      cancel.current = () => finish();
      try {
        widget = api.render(container.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          "response-field": false,
          callback: (token) => finish(token),
          "error-callback": () => finish(),
          "expired-callback": () => finish(),
          "timeout-callback": () => finish(),
        });
      } catch {
        finish();
      }
    }),
  }), [siteKey]);

  if (!siteKey) return null;
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" />
      <div ref={container} aria-label="Security verification" />
    </>
  );
}
