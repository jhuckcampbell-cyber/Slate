# W5 correctness audit

Severity-ranked findings (source locations before fixes):

1. **High** ? `supabase/migrations/20261103000006_lock_reveal.sql:504`: join holds FOR SHARE, allowing concurrent callers to pass the 100-player count. Serialize joins with FOR UPDATE (0039).
2. **High** ? `supabase/migrations/20261110000029_self_settling_props.sql:225`: finalized stats without provider identity remain mutable, potentially contradicting irreversible results. Preserve final rows and audit attempted corrections (0039).
3. **Medium** ? `supabase/migrations/20261110000030_event_status_voids.sql:41`: changed finals are silently ignored. Preserve finality but retain deduplicated review evidence, visible to hosts after reveal (0039).
4. **Medium** ? `supabase/migrations/20261110000029_self_settling_props.sql:109`: host mistypes cannot be corrected even when affected parlays remain pending. Permit audited corrections only while every affected wager is pending; reject irreversible payouts, including zero payouts (0040).

Reviewed settlement (`0008:90`), grade_event (`0008:121`), current_payout (`0030`), place core and wrappers (`0005/0013/0022/0025/0026`), cancel (`0025:199`), replace (`0005:324`), probability (`0016/0030`) and core odds/slip/props. Settlement locks the wager and checks pending before credit; replace is transactional; void/push legs drop from the exact numeric product; cap 1001 and floor apply after 4dp rounding. Tied ranks intentionally share a rank; 0039 orders equal rows by participant_id without breaking shared ranks. House-rule failures remain below qualified rows.

## Correction policy
Finals stay final. Provider score/stat changes create review records and never re-grade or credit again. Host stat corrections use grade_prop only before every affected wager is irreversible. DNP corrections require manual review because DNP spans every market for that player. Public prop_results retains the accepted result; review records retain previous and proposed values. No automatic balance adjustment is offered.

## UTC budget month
Budget month boundaries are calendar months in UTC, not the host or device timezone. This note changes no budget code.

## Coverage added

`27_correctness.test.sql` exercises real booking against 24 vectors shared with core tests, integer-cents accounting through cancel/replace/grade/void, push/void leg removal, final corrections and deduplication, pre-lock review RLS, pending host corrections, disqualification and deterministic shared ranks. `concurrency-correctness.test.ts` races overspending, cancellation, joins at capacity, and repeated finals; generated stake cases compare SQL booking and settlement with core payout math. Core tests also check 2,000 deterministic generated rational products.

0039 preserves the concurrent 0036 rate limits and 0037 removal-identity predicate. 0040 preserves the host RPC signature and rate enforcement. No unrelated files were edited.

## Verification handoff
No Docker is available here. Claude must reset/apply migrations, regenerate database types, run the full pgTAP suite and integration suite against the local stack. Node checks do not validate SQL execution or races.

Latest Node validation: lint passed (one unrelated postcss warning), typecheck passed, 33 test files / 306 tests passed. UI screenshot verification is deferred under the command restriction; Claude should inspect the correction form at mobile width.
