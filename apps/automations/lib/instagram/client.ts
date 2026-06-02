const GRAPH_BASE = "https://graph.facebook.com/v21.0";

async function graphPost(
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<unknown> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Graph API ${res.status} ${path}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

export function replyToComment(
  commentId: string,
  message: string,
  accessToken: string,
): Promise<unknown> {
  return graphPost(`/${commentId}/replies`, { message }, accessToken);
}

// Likes the comment as the IG business account.
export function likeComment(
  commentId: string,
  accessToken: string,
): Promise<unknown> {
  return graphPost(`/${commentId}`, { like: true }, accessToken);
}

// Private Replies API: send a DM in response to a public comment.
// Bypasses the 24h messaging window because the comment is the user-initiated trigger.
export function sendPrivateReply(
  igBusinessAccountId: string,
  commentId: string,
  message: string,
  accessToken: string,
): Promise<unknown> {
  return graphPost(
    `/${igBusinessAccountId}/messages`,
    {
      recipient: { comment_id: commentId },
      message: { text: message },
    },
    accessToken,
  );
}
