import { BLOG_CONFIG } from './blog-config';

/**
 * Calculate reading time based on word count
 * @param text - The text content to analyze
 * @returns Reading time in minutes (rounded up)
 */
export function calculateReadingTime(text: string): number {
  // Remove markdown syntax, HTML tags, and extra whitespace
  const cleanText = text
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/`[^`]+`/g, '') // Remove inline code
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/[#*_~[\]()]/g, '') // Remove markdown formatting
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Count words (split by whitespace and filter empty strings)
  const wordCount = cleanText.split(/\s+/).filter((word) => word.length > 0).length;

  // Calculate reading time in minutes (round up to nearest minute)
  const readingTime = Math.ceil(wordCount / BLOG_CONFIG.readingSpeed);

  // Ensure minimum of 1 minute
  return Math.max(1, readingTime);
}

/**
 * Format reading time for display
 * @param minutes - Reading time in minutes
 * @returns Formatted string (e.g., "5 min read")
 */
export function formatReadingTime(minutes: number): string {
  return `${minutes} min read`;
}
