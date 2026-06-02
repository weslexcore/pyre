# Meta App Setup — Instagram Comment Auto-Reply

Step-by-step to get the Pyre Instagram account wired up to the webhook at
`apps/automations/app/api/instagram/webhook/route.ts`.

By the end you'll have these six values to put in Vercel (and your local `.env.local`):

```
META_APP_SECRET=
META_VERIFY_TOKEN=
IG_PAGE_ACCESS_TOKEN=
IG_BUSINESS_ACCOUNT_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The last two come from Supabase (see `apps/supabase/`); everything else comes from the steps below.

---

## 1. Prep the Instagram account (5 min)

You can only use the Graph API with a **Business** or **Creator** account that's linked to a **Facebook Page**.

1. Open the Pyre Instagram app → **Settings → Account → Switch to Professional Account → Business**.
2. Pick a category (e.g. "Spa").
3. In Settings → **Accounts Center → Add Facebook account**. If Pyre doesn't have a Facebook Page yet, create one at https://facebook.com/pages/create — call it "Pyre" and pick the same category.
4. Confirm the link by going to the Facebook Page → **Settings → Linked Accounts → Instagram**. The Pyre IG handle should be listed.

If you ever see "Instagram Business Account not found" later, this step is the cause 90% of the time.

---

## 2. Create the Meta Developer App (10 min)

1. Go to https://developers.facebook.com and log in with the Facebook account that owns the Pyre Page.
2. Top right → **My Apps → Create App**.
3. **Use case**: "Other". **App type**: **Business**.
4. **App name**: `Pyre Automations`. **App contact email**: yours. **Business Account**: pick the one tied to the Pyre Page (or create one called "Pyre" when prompted).
5. After creation you land on the App Dashboard.

### Add the products

In the left sidebar → **Add Products**. Add these three:

- **Instagram Graph API** (sometimes shown as "Instagram" → "API setup with Instagram login" — pick the **Business Login / Graph API** variant, not Basic Display)
- **Webhooks**
- **Instagram Messaging** (the private-replies DM API lives here)

### Grab two values now

- **Settings → Basic** → copy **App Secret** (click "Show", enter your password) → this is your `META_APP_SECRET`.
- Pick any random string for the verify token, e.g. run `openssl rand -hex 24` locally → save as `META_VERIFY_TOKEN`. (You'll paste this same string into the Meta dashboard in Step 5.)

---

## 3. Request the permissions you need

**App Review → Permissions and Features** → request advanced access for each of:

- `instagram_basic` — read profile/media (standard access usually enough)
- `instagram_manage_comments` — required to reply to and like comments
- `instagram_manage_messages` — required to send the DM via Private Replies
- `pages_show_list`, `pages_read_engagement` — needed to enumerate the linked Page

For each, click **Request advanced access**. Meta will ask for:

- A **screencast** showing the full flow: user comments `SPRING` → bot replies on the comment → bot sends DM. Record this against your dev/test setup (Step 6) before submitting.
- A **business verification** (one-time per Meta Business Account — driver's license / business document upload). This unblocks all advanced permissions.
- A **data deletion URL** and **privacy policy URL**. Privacy policy can live on the marketing site (`landing-page` → `/privacy`); the deletion URL can return a static page explaining how to request deletion.

While you're waiting for review (1–10 business days typically), you can still develop and test using **development mode** — see Step 6.

---

## 4. Generate the Page Access Token + grab the IG Business Account ID

This is the most error-prone step. Do it in the **Graph API Explorer**: https://developers.facebook.com/tools/explorer

1. Top right → **Meta App**: select "Pyre Automations".
2. **User or Page Token** → **Get User Access Token**. Tick: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`. Click **Generate Access Token** and approve.
3. Query `GET /me/accounts` → in the response, find the Pyre Page and copy its `id` (call it `PAGE_ID`) and `access_token` (call it `SHORT_PAGE_TOKEN`).
4. Query `GET /{PAGE_ID}?fields=instagram_business_account` using `SHORT_PAGE_TOKEN`. The response contains `instagram_business_account.id` → that's your **`IG_BUSINESS_ACCOUNT_ID`**. Save it.
5. Convert the short-lived page token to a **long-lived (60-day) page token**. In a terminal:

   ```bash
   curl -G "https://graph.facebook.com/v21.0/oauth/access_token" \
     -d "grant_type=fb_exchange_token" \
     -d "client_id=<APP_ID>" \
     -d "client_secret=<META_APP_SECRET>" \
     -d "fb_exchange_token=<SHORT_PAGE_TOKEN>"
   ```

   `APP_ID` is on Settings → Basic. The returned `access_token` is your **`IG_PAGE_ACCESS_TOKEN`**. Save it.

> Page tokens minted from a long-lived user token don't expire as long as the user stays active, but plan to re-mint every ~50 days to be safe. Token refresh automation is out of scope for v1 (see plan).

---

## 5. Configure the webhook (after first deploy)

The webhook needs a public HTTPS URL, so deploy `apps/automations` to Vercel first and note the production domain (e.g. `https://pyre-automations.vercel.app`). Set all six env vars in Vercel project settings before this step or the GET handshake will 500.

1. In the App Dashboard → **Webhooks** product → **Instagram** → **Subscribe to this object**.
2. **Callback URL**: `https://<your-vercel-domain>/api/instagram/webhook`
3. **Verify token**: paste the exact value you chose for `META_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta hits the URL with a GET; our handler returns the challenge. If it fails:
   - Check Vercel logs for the GET — if you don't see it, your env vars aren't set.
   - If you see the GET but a 403 response, the verify token doesn't match.
5. Subscribe to the **`comments`** field. (Optional: also `messages` if you want to handle plain DMs later.)
6. Still in the dashboard → **Instagram Graph API** product → **Generate Token** or **Add Instagram Account** if prompted — make sure the Pyre IG account is listed as connected to the app.
7. Finally, subscribe the IG account to your app via the Graph API (one-time):

   ```bash
   curl -X POST "https://graph.facebook.com/v21.0/<IG_BUSINESS_ACCOUNT_ID>/subscribed_apps" \
     -d "subscribed_fields=comments" \
     -d "access_token=<IG_PAGE_ACCESS_TOKEN>"
   ```

   Expected response: `{"success": true}`. Without this, comments never get delivered even though the dashboard shows the field as subscribed.

---

## 6. Test in Development Mode (before App Review approval)

While `instagram_manage_messages` is in review you can still test the full flow against test users.

1. App Dashboard → **App Roles → Roles** → add yourself and any other testers as **Instagram Testers**.
2. Each tester accepts the invite from their Instagram app: **Settings → Apps and Websites → Tester Invites → Accept**.
3. Testers can now trigger the full flow against the live Pyre IG account (comment a keyword, get a reply + DM). Anyone *not* added as a tester won't trigger the webhook until the app is in Live mode (post-review).

Once review passes: App Dashboard → toggle the app from **Development** to **Live**.

---

## 7. Quick verification checklist

- [ ] `GET https://<your-domain>/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=test` returns `test`.
- [ ] `instagram_rules` table has a row with `keyword='SPRING'` and the right `ig_business_account_id`.
- [ ] Comment `SPRING` from a tester account on a Pyre post → reply appears within ~10s, comment gets liked, DM lands in inbox.
- [ ] One row added to `instagram_events` with `reply_status='sent'`, `like_status='sent'`, `dm_status='sent'`.
- [ ] Re-trigger Meta's test delivery for the same comment → no duplicate row, no duplicate reply.

---

## Common failures and fixes

| Symptom | Likely cause |
|---|---|
| Webhook verification fails with 403 | `META_VERIFY_TOKEN` mismatch between Vercel env and dashboard |
| Webhook verification fails with 500 | One of the six env vars not set in Vercel (the handler doesn't access env until invoked, but Next still imports the module) |
| Comments don't trigger the webhook | Forgot the `/{ig-id}/subscribed_apps` POST in Step 5.7, or the IG account isn't a Business account, or you're testing as a non-tester while app is in Dev mode |
| Reply works, DM fails with "user not eligible" | The commenter has blocked DMs from businesses they don't follow (Instagram setting) — nothing we can do |
| DM fails with "(#10) Application does not have permission" | `instagram_manage_messages` still pending App Review |
| `Graph API 400: Invalid OAuth access token` | Page token expired — re-run Step 4.5 |
