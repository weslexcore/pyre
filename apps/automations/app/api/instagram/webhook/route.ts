import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";
import { verifySignature } from "@/lib/instagram/verifySignature";
import { findRule, type Rule } from "@/lib/instagram/match";
import {
  likeComment,
  replyToComment,
  sendPrivateReply,
} from "@/lib/instagram/client";

export const runtime = "nodejs";

// Subscription handshake. Meta calls this once when we configure the webhook.
export function GET(req: NextRequest): NextResponse {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token === env.META_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

type CommentChangeValue = {
  id: string;
  text?: string;
  from?: { id: string; username?: string };
  media?: { id: string };
};

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: CommentChangeValue }>;
  }>;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, env.META_APP_SECRET)) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  // Always 200 to Meta. We process best-effort and log failures in Supabase.
  try {
    const payload = JSON.parse(rawBody) as WebhookPayload;
    await Promise.all(
      (payload.entry ?? []).flatMap((entry) =>
        (entry.changes ?? [])
          .filter((c) => c.field === "comments" && c.value)
          .map((c) => handleComment(c.value as CommentChangeValue)),
      ),
    );
  } catch (err) {
    console.error("[ig-webhook] processing error:", err);
  }
  return NextResponse.json({ ok: true });
}

async function handleComment(value: CommentChangeValue): Promise<void> {
  const commentId = value.id;
  const fromId = value.from?.id;
  // Ignore comments from our own account so we don't loop on our own replies.
  if (fromId && fromId === env.IG_BUSINESS_ACCOUNT_ID) return;

  const supabase = getServiceClient();

  // Idempotency: skip if we've already processed this comment_id.
  const { data: existing } = await supabase
    .from("instagram_events")
    .select("id")
    .eq("comment_id", commentId)
    .maybeSingle();
  if (existing) return;

  const { data: rulesData } = await supabase
    .from("instagram_rules")
    .select("id,keyword,comment_reply,dm_message,is_active,ig_business_account_id")
    .eq("ig_business_account_id", env.IG_BUSINESS_ACCOUNT_ID)
    .eq("is_active", true);

  const rules = (rulesData ?? []) as Rule[];
  const rule = value.text ? findRule(value.text, rules) : null;

  const baseEvent = {
    comment_id: commentId,
    rule_id: rule?.id ?? null,
    media_id: value.media?.id ?? null,
    ig_user_id: fromId ?? null,
    username: value.from?.username ?? null,
    comment_text: value.text ?? null,
  };

  if (!rule) {
    await supabase.from("instagram_events").insert({
      ...baseEvent,
      reply_status: "skipped",
      dm_status: "skipped",
      like_status: "skipped",
    });
    return;
  }

  const token = env.IG_PAGE_ACCESS_TOKEN;
  const [replyResult, likeResult, dmResult] = await Promise.allSettled([
    replyToComment(commentId, rule.comment_reply, token),
    likeComment(commentId, token),
    sendPrivateReply(env.IG_BUSINESS_ACCOUNT_ID, commentId, rule.dm_message, token),
  ]);

  await supabase.from("instagram_events").insert({
    ...baseEvent,
    reply_status: replyResult.status === "fulfilled" ? "sent" : "error",
    reply_error:
      replyResult.status === "rejected" ? String(replyResult.reason) : null,
    like_status: likeResult.status === "fulfilled" ? "sent" : "error",
    like_error:
      likeResult.status === "rejected" ? String(likeResult.reason) : null,
    dm_status: dmResult.status === "fulfilled" ? "sent" : "error",
    dm_error: dmResult.status === "rejected" ? String(dmResult.reason) : null,
  });
}
