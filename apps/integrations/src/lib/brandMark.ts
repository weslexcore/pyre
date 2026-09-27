// The color of the Pyre wave mark wherever the admin shows it — the favicon
// and the header logo. Deployments of the staging branch use brand sage
// instead of gold so a staging tab is easy to tell apart from production at a
// glance. Values mirror --pyre-gold / --pyre-sage in styles/admin.css.
export const isStagingDeploy = import.meta.env.VERCEL_GIT_COMMIT_REF === 'staging';

export const MARK_COLOR = isStagingDeploy ? '#839770' : '#dbb155';
