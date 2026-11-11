export type CaptchaTokenProvider = () => Promise<string>;

/** Keep unconfigured development environments entirely CAPTCHA-free. */
export async function guestCaptchaToken(
  siteKey: string | undefined,
  getToken?: CaptchaTokenProvider,
): Promise<string | undefined> {
  if (!siteKey?.trim()) return undefined;
  const token = await getToken?.();
  if (!token?.trim()) throw new Error("CAPTCHA_FAILED");
  return token;
}
