import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Text formatting utilities
export function truncateToLines(text: string | undefined, maxLines: number = 2): string {
  if (!text) return '';
  
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return text;
  }
  
  return lines.slice(0, maxLines).join('\n') + '...';
}

export function formatMultilineText(text: string | undefined): string {
  if (!text) return '';
  return text;
}

// Small promise-based delay helper for sequencing UI updates
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
