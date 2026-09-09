// Defaults for a newsletter campaign: one send a month, named by month so
// the slugs sort (newsletter-2026-10), running the calendar month.

export interface NewsletterDefaults {
  name: string;
  startsAt: string;
  endsAt: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function newsletterDefaults(now: Date): NewsletterDefaults {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const lastDay = new Date(year, month + 1, 0).getDate();
  const ym = `${year}-${pad(month + 1)}`;
  return {
    name: `Newsletter ${ym}`,
    startsAt: `${ym}-01`,
    endsAt: `${ym}-${pad(lastDay)}`,
  };
}
