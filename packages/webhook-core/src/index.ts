// @pyre/webhook-core — shared webhook infrastructure consumed by both the
// integrations service (writer) and the landing-page admin dashboard (reader).
//
// IMPORTANT: execution-store.ts defines the Redis key contract
// (`webhook:exec:{id}` + `webhook:executions` sorted set). Both deployables read
// and write the SAME Upstash instance, so this package is the single source of
// truth for that schema — do not fork it.

export { getRedis } from './redis';
export {
  getExecution,
  getExecutionSummariesSince,
  getRecentExecutions,
  recordExecution,
  type WebhookExecution,
  type WebhookExecutionSummary,
} from './execution-store';
export {
  appendDailyStats,
  backfillDailyStats,
  type DailyStat,
  getDailyStats,
  STATS_TIMEZONE,
  type StatsInput,
} from './webhook-stats';
export {
  type CampaignPatch,
  type CampaignStatus,
  type CampaignType,
  type CampaignWithLinks,
  type CreateCampaignInput,
  type CreateCampaignResult,
  createCampaign,
  deleteCampaign,
  deleteLink,
  type DestinationKind,
  getCampaign,
  getCampaignBySlug,
  getCampaignWithLinks,
  getLink,
  listCampaigns,
  listCampaignsWithLinks,
  normalizeCampaignRecord,
  normalizeLinkRecord,
  saveLink,
  slugifyCampaign,
  updateCampaign,
  updateLink,
  type UtmCampaign,
  utmCampaignOfUrl,
  type UtmLink,
  utmSourceOfUrl,
} from './utm-campaign-store';
export {
  codeExists,
  createShortLink,
  type CreateShortLinkInput,
  deleteShortLink,
  deleteShortLinks,
  getShortLink,
  getShortLinks,
  incrementClickCount,
  isValidAlias,
  listShortLinks,
  type ShortLink,
  ShortLinkError,
  updateShortLinkLabel,
} from './shortlinks';
export { type TraceStep, WebhookTracer } from './tracer';
export { createWebhookLogger, type WebhookLogger } from './logger';
export {
  listTags,
  type MailchimpTag,
  setSubscriberStatus,
  setSubscriberTags,
  type SubscriberAddress,
  type SubscriberTag,
  updateSubscriberAddress,
  upsertSubscriber,
  type UpsertSubscriberParams,
} from './mailchimp';
