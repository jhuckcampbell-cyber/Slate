# Accounts

Guests keep the same user ID when they save with email (`updateUser`) or Google
(`linkIdentity`). Existing tournaments, bets and bankrolls stay attached to that ID.
Confirm the email link before relying on access from another device. Google linking
requires manual linking enabled. A Google identity already owned by another user
cannot be linked to this guest.

Returning players choose **Sign in to an existing account** on the account page,
then email or Google. Email sign-in does not create a new account. This switches
sessions; Supabase cannot automatically merge two user IDs. Save the current guest
with a separate, unused identity before switching if it has data worth keeping.
Neither signing in nor linking transfers another account's tournament history.

## Configuration

Required app environment names:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- NEXT_PUBLIC_TURNSTILE_SITE_KEY
- SUPABASE_SECRET_KEY (service role, server only)

Required Supabase environment names:
- SUPABASE_AUTH_CAPTCHA_SECRET
- SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
- SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET

Google is disabled by default. These are environment references, not credentials.
Set the Google credentials and enable `auth.external.google` only after registering
the Supabase Auth provider callback URL in Google. Allow the app's exact
`/auth/callback` URLs in Supabase, including the production HTTPS origin.
Hosted projects need equivalent dashboard settings; config.toml configures local CLI.
Enable manual linking, email confirmation and Turnstile there too. Configure SMTP
for production email delivery. Email sends are capped at 10/hour, anonymous sessions
at 10/hour/IP, with a 60-second email resend interval.

CAPTCHA is enabled in config.toml: unset keys will prevent sign-in. For local tests
use Cloudflare's documented test key pair, or explicitly disable CAPTCHA in the
caller's local Supabase configuration. Never use test keys in production.

## Deletion and privacy

The server action verifies the user with Auth, calls `delete_my_account` as that
user, and deletes only that verified Auth ID using the server-only service role.
No caller-supplied user ID is accepted. Open, locked and draft hosts must delete or
hand over tournaments first. There is currently no handover UI; locked hosts must
wait until the tournament advances. Live and settled tournaments remain intact.
The final Auth-delete trigger rechecks the guard in its own transaction, serialized
against tournament changes. Profiles lose their Auth cascade so deleting credentials
cannot erase participants, bets or final standings. Retained names become
`Deleted player` and avatars are cleared. No email is stored in profiles.
Preparation anonymizes immediately; if Auth deletion fails, retry deletion.
Profile metadata is owner-only; roster/leaderboard helpers expose display names.

New stable RPC error: ACCOUNT_HOSTS_ACTIVE_TOURNAMENT. The account action translates
it locally; the owner of src/lib/errors.ts can add the shared mapping if needed.

## Caller verification

Apply migration **20261111000038_accounts.sql**, regenerate database types (outside
this task's ownership), then run pgTAP and auth Playwright tests against the local
stack. Run the mobile screenshot tour. Verify email delivery/confirmation with
local SMTP, Google linking and returning Google sign-in with configured credentials,
Turnstile rejection, same-ID preservation, active-host deletion refusal and settled
standings after actual admin deletion. No DB, browser or Docker checks ran here.

Integration: concurrent migration 0039 recreates the leaderboard with a direct
profiles join. Its owner must replace `pr.display_name` with
`private.profile_display_name(p.user_id) as display_name` and remove the profiles
join, preserving its other changes. Otherwise owner-only profile RLS hides other
players' standings. The 26_accounts pgTAP suite checks this after all migrations.
