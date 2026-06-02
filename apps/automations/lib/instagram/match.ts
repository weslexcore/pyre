export type Rule = {
  id: string;
  keyword: string;
  comment_reply: string;
  dm_message: string;
  is_active: boolean;
  ig_business_account_id: string;
};

// Whole-word, case-insensitive match — "SPRING" matches "spring" but not "springboard".
export function findRule(commentText: string, rules: Rule[]): Rule | null {
  const tokens = new Set(
    commentText
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  for (const rule of rules) {
    if (!rule.is_active) continue;
    if (tokens.has(rule.keyword.toLowerCase())) return rule;
  }
  return null;
}
