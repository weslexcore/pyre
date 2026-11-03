// Journey text blocks are Markdown (react-markdown + GFM, rendered in
// emails/templates/JourneyEmail.tsx). Only absolute web and mailto links make
// it into an email; anything else renders as its text.

export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}
