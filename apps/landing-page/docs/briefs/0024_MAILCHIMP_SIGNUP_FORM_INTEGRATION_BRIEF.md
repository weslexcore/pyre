### Project overview / description
Update the website signup form to post directly to Mailchimp while keeping our existing custom UI/UX. We will replicate the behavior of Mailchimp’s embedded form using our own components, ensuring successful subscriptions into the correct audience with appropriate tagging and basic bot protection.

### Target audience
- Visitors to the Pyre Sauna site who want to subscribe to updates
- Marketing team managing lists, tags, and campaigns in Mailchimp

### Primary benefits / features
- **Seamless UX**: Maintain our custom styling, layout, and validation.
- **Direct list subscription**: Submissions go into the specified Mailchimp audience.
- **Tagging support**: Apply the provided tag value on signup for segmentation.
- **Bot protection**: Preserve honeypot behavior from Mailchimp embed.
- **Clear feedback**: Display success and error messages returned from the submit flow.

### High-level tech / architecture
Use the Mailchimp embed parameters to define what our custom form must submit. 

- **Mailchimp form details derived from embed code**
  - `action` (POST): `https://pyresauna.us18.list-manage.com/subscribe/post?u=daa865d22ae34a68a2959418a&id=2c14391071&f_id=0031b3e6f0`
  - Required field: `EMAIL` (type: email)
  - Hidden tag field: `tags` with value `3034577`
  - Honeypot field (must remain empty): `b_daa865d22ae34a68a2959418a_2c14391071`
  - Method: `POST`
  - Notes: `us18` is the Mailchimp data center; `u`, `id`, and `f_id` identify the audience/form.

- **Approach: Direct HTML form POST to Mailchimp**
  - Frontend form posts directly to the Mailchimp `action` URL.
  - Include fields: `EMAIL`, hidden `tags`, hidden honeypot field matching the exact name.
  - Only require frontend changes, do not add API routes or anything that requires adding infrastructure. 

- **Validation and UX**
  - Client-side: Email format validation and required checks.
  - Server/response handling: Show success confirmation and error states (e.g., already subscribed, invalid email).
  - Maintain the honeypot field in the UI (hidden) and drop submissions where it’s filled.

- **Non-functional**
  - Ensure accessibility for form fields and error messaging.
  - Respect privacy and clearly indicate what users are subscribing to.
  - Log minimal diagnostics for failures (without storing PII) for support/debug.
