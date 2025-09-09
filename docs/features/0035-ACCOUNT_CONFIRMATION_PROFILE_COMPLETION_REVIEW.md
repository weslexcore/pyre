# 0035 — Account Confirmation & Profile Completion — Code Review

## Summary

Implementation substantially matches the PRD: email confirmation flow with resend support, profile completion page collecting required fields, server-side enforcement via middleware and route-protection, storage of profile data in Supabase user metadata, and redirect to the schedule after completion. A few issues need attention (one logic bug, an out‑of‑scope validation, missing tests, and incomplete integration of the blocking modal).

## What Looks Good

- Email confirmation flow
  - Sign-up redirects to a confirmation success page with resend support: `apps/booking-system/components/sign-up-form.tsx` and `apps/booking-system/app/auth/sign-up-success/page.tsx`.
  - Confirmation handler redirects to `next` (defaults to `/`): `apps/booking-system/app/auth/confirm/route.ts`.
- Profile completion
  - Dedicated page gated by email confirmation: `apps/booking-system/app/complete-profile/page.tsx` uses `requireEmailConfirmation()`.
  - Form collects required fields, validates, saves to metadata, and redirects to schedule: `apps/booking-system/components/complete-profile-form.tsx`.
  - Server and client helpers are consistent and clear: `apps/booking-system/lib/utils/profile.ts`, `apps/booking-system/lib/supabase/{queries.ts,client-queries.ts}`.
- Enforcement
  - Middleware + route protection centralizes checks and cleanly separates concerns: `apps/booking-system/lib/supabase/middleware.ts`, `apps/booking-system/lib/utils/route-protection.ts`.
  - Public routes include `/schedule`; protected routes include `/account`, `/admin`, etc.
- Account page integrates profile editing with metadata: `apps/booking-system/components/account-form.tsx`.

## Issues & Gaps

- Out-of-scope age validation (contradicts PRD Non-Goals)
  - PRD marks “Age validation or minimum age requirements” as out of scope, but DOB validation enforces 18+ and the UI displays this requirement.
    - Code: `apps/booking-system/lib/utils/profile.ts:112` (`validateDateOfBirth`) and copy in
      - `apps/booking-system/components/complete-profile-form.tsx:141`
      - `apps/booking-system/components/account-form.tsx:196`
  - Recommendation: remove the 18+ check and related copy for this iteration, or feature-flag it and update the PRD accordingly.

- Missing tests promised in Tasks
  - The tasks specify tests for the complete profile page, form component, modal, and utils, but no `*.test.*` files are present.
    - Expected (from tasks):
      - `apps/booking-system/app/complete-profile/page.test.tsx`
      - `apps/booking-system/components/complete-profile-form.test.tsx`
      - `apps/booking-system/components/profile-completion-modal.test.tsx`
      - `apps/booking-system/lib/utils/profile.test.ts`
    - Search: no test files found under `apps/booking-system`.
  - Recommendation: add at least unit tests for `validateProfileData`, smoke test for form rendering/validation, and modal behavior.

- Blocking modal not actually triggered by the guard
  - The `ProfileCompletionGuard` renders the modal but never opens it; `isOpen` defaults to `false` and `showModal()` isn’t called.
    - Files:
      - `apps/booking-system/components/profile-completion-guard.tsx:48` (uses `useProfileCompletionModal()`)
      - `apps/booking-system/components/profile-completion-guard.tsx` (no `useEffect` invoking `showModal()` when requirements aren’t met)
  - Recommendation: add a `useEffect` to call `showModal()` when requirements aren’t met so the modal appears automatically on hydration.

- Potential bug: spreading `undefined` in profile metadata creation
  - `createProfileMetadata` spreads `metadata.preferences` which is initially `undefined`, causing a runtime error if `preferences` is provided.
    - Code: `apps/booking-system/lib/utils/profile.ts:63`
  - Fix: use a safe default: `metadata.preferences = { ...(metadata.preferences || {}), ...profileData.preferences }` or simply `metadata.preferences = { ...profileData.preferences }`.

- Tasks checklist out of sync with code
  - Tasks 5.1–5.4 are unchecked, but `apps/booking-system/components/account-form.tsx` appears to implement the required fields with metadata and validation.
  - Recommendation: update the tasks doc to reflect current state, or complete any remaining deltas if intended.

## Data Alignment Checks

- Profile keys: consistent snake_case (`first_name`, `last_name`, `date_of_birth`) across utils, client/server queries, and form payloads.
- Metadata usage: client updates via `supabase.auth.updateUser({ data })` are correct, using `createProfileMetadata` to shape payloads.
- Route protection: server middleware and server-component guards use consistent logic; public vs protected paths are explicit. Unknown paths default to auth-required (conservative).

## Style/Design Notes

- Good separation: infra (middleware, route config), server queries, client hooks, and UI components are cleanly separated.
- The `ConditionalAccess` and `ProfileCompletionStatus` components are thoughtful and ready for gradual integration into UI.
- Consider integrating `ProfileCompletionStatus` somewhere visible (e.g., account or header) to guide users.

## Suggested Fixes (Actionable)

- Remove out-of-scope age validation
  - Delete the 18+ rule and copy for this release.
    - `apps/booking-system/lib/utils/profile.ts:112` → drop age check; keep basic validity/future-date checks if desired.
    - `apps/booking-system/components/complete-profile-form.tsx:141` and `apps/booking-system/components/account-form.tsx:196` → remove the “You must be at least 18…” copy.

- Fix metadata preferences spread bug
  - `apps/booking-system/lib/utils/profile.ts:63`
    - Replace with: `metadata.preferences = { ...profileData.preferences }` (or the safe OR pattern).

- Make ProfileCompletionGuard actually open the modal
  - `apps/booking-system/components/profile-completion-guard.tsx`
    - Add:
      
      useEffect(() => {
        if (!requirementsMet) {
          showModal();
        } else {
          closeModal();
        }
      }, [requirementsMet, showModal, closeModal]);


- Add missing tests per tasks
  - `profile.test.ts` for `validateProfileData`, `isProfileDataComplete`, and `createProfileMetadata` edge cases.
  - Component tests for form validation messages and modal progression.

## Minor Observations (Optional)

- Admin check in navigation (`apps/booking-system/components/navigation.tsx`) queries `auth.users`, which typically requires elevated privileges; consider relying solely on `user_metadata.is_super_admin` already present on the user object (or a dedicated public table with RLS).
- `validateUserRouteAccess` defaults unknown routes to auth-required; ensure this aligns with product expectations for any new public routes.

## Verdict

The core flow is in good shape and aligns with the PRD. Address the age validation scope creep, fix the metadata preferences bug, wire up the modal guard to actually block, and add the missing tests to reach production readiness.

