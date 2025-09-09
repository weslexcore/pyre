### 0024 — Mailchimp Signup Form Integration (Frontend-only)

Brief: Update the website signup form to post directly to Mailchimp while keeping our existing custom UI/UX. Replicate Mailchimp’s embedded form behavior using our own components so that submissions flow into the correct audience with tagging, honeypot protection, and clear success/error feedback.

Verbatim Mailchimp parameters (from brief):
- action (POST): `https://pyresauna.us18.list-manage.com/subscribe/post?u=daa865d22ae34a68a2959418a&id=2c14391071&f_id=0031b3e6f0`
- Required field: `EMAIL` (type: email)
- Hidden tag field: `tags` with value `3034577`
- Honeypot field (must remain empty): `b_daa865d22ae34a68a2959418a_2c14391071`
- Method: `POST`

### Scope and approach
- Frontend-only changes. No new server/API logic.
- The form will submit directly to Mailchimp using the provided action URL and fields.
- Progressive enhancement for inline success/error feedback while preserving a no-JS fallback that posts to Mailchimp.
- Keep existing styling, layout, accessibility, and email validation UX.

### Files to change or create
- `src/components/SignupForm.astro`
- `src/lib/signupForm.ts`
- `src/lib/types.ts`
- (Optional/cleanup) `src/pages/api/subscribe.ts`

### Detailed changes

#### 1) `src/components/SignupForm.astro`
- Form submission wiring:
  - Change the form `action` to the Mailchimp action URL exactly as provided above.
  - Ensure `method="POST"` and remove usage of `/api/subscribe`.
  - Set `name` of the email input to `EMAIL` (Mailchimp requires exact casing).
  - Add hidden input: `name="tags"` with `value="3034577"`.
  - Add honeypot input: `type="text"`, `name="b_daa865d22ae34a68a2959418a_2c14391071"`, empty value, visually hidden, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`.
- Client-side validation:
  - Keep current email format validation and required checks; prevent submission on invalid format.
  - If honeypot has any value, drop the submission (silently ignore and do not POST).
- Progressive enhancement for inline feedback (no backend):
  - On valid submit with JS enabled, intercept and submit to Mailchimp’s JSONP endpoint to read result text without CORS issues:
    - Derive JSONP URL from action: replace `/subscribe/post` with `/subscribe/post-json` and add `&c=?` callback param.
    - Include query/body fields: `EMAIL`, `tags`, and ensure `u`, `id`, `f_id` parameters from the action URL are passed through.
    - Handle JSONP callback: if `result === 'success'`, show our existing success UI; if `result === 'error'`, render the returned `msg` into the error area.
  - If JS is unavailable or JSONP fails, allow the native HTML form POST to proceed to Mailchimp’s response page as a fallback.
- Accessibility and UX:
  - Continue to use the existing `aria-live` region for status updates, ensuring messages are announced.
  - Keep focus management on error; disable/enable submit button appropriately during async submit.

#### 2) `src/lib/signupForm.ts`
- Add a `mailchimp` config section so the component does not hardcode these values. Example fields to add (values taken from brief):
  - `action`: `https://pyresauna.us18.list-manage.com/subscribe/post?u=daa865d22ae34a68a2959418a&id=2c14391071&f_id=0031b3e6f0`
  - `audienceU`: `daa865d22ae34a68a2959418a`
  - `audienceId`: `2c14391071`
  - `fId`: `0031b3e6f0`
  - `tagId`: `3034577`
  - `honeypotFieldName`: `b_daa865d22ae34a68a2959418a_2c14391071`
  - Optionally derive `postJson` at runtime in the component from `action`, or store a `postJson` string as well.
- Keep copy (labels/messages) in this file per our “copy configs in `src/lib`” convention.

#### 3) `src/lib/types.ts`
- Extend `SignupFormContent` to include a `mailchimp` config object, e.g.:
  - `mailchimp: { action: string; audienceU: string; audienceId: string; fId: string; tagId: string; honeypotFieldName: string; }`
  - If planning to store `postJson`, include `postJson: string`.

#### 4) src/pages/api/subscribe.ts`
- Remove this route (no references from the component after changes). 

### Submit and response handling algorithm (progressive enhancement)
1. On form submit, read `EMAIL` and the honeypot value.
2. If `EMAIL` fails client-side validation, block submit and show inline error.
3. If the honeypot field is non-empty, block submit and do nothing further.
4. With JS enabled:
   - Prevent default submission.
   - Build a JSONP URL using the Mailchimp action params (`u`, `id`, `f_id`) and add `EMAIL`, `tags`, and `c=callbackName`.
   - Inject a `<script>` tag with this URL; define `window[callbackName]` to receive a payload shaped like `{ result: 'success' | 'error', msg: string }`.
   - On `success`, clear the input, render the success message in the existing status area, and optionally push `?subscribed=1` for bookmarkability.
   - On `error`, render the returned `msg` (sanitized) in the error area.
   - Clean up: remove the script tag and delete the temporary callback.
5. Without JS or if JSONP fails, allow the natural HTML form POST to Mailchimp (browser navigates to Mailchimp’s response page).

### Validation, accessibility, and security
- Keep the current `aria-live` pattern for feedback and ensure focus moves to the error on validation failure.
- Ensure the honeypot is visually hidden but present in the DOM and excluded from the tab order.
- Do not log or persist email addresses. For diagnostics, only log generic error states without PII.

### Test plan (manual)
- Valid email, empty honeypot: observe inline success message (JSONP path). With JS disabled, verify navigation to Mailchimp response page.
- Invalid email: client-side error; form not submitted.
- Honeypot filled (via devtools): submission is dropped; no request is sent.
- “Already subscribed” addresses: confirm inline error from Mailchimp `msg` is rendered.
- Confirm hidden `tags=3034577` is included in both JSONP and native POST submissions.
- Confirm accessibility: screen reader announces messages; keyboard focus is managed.

### Rollout
- Ship as a frontend-only change. No environment variables or server config required.
- After release, monitor for any regressions in form engagement and error rates.


