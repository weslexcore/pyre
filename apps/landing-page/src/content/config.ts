import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      // Required fields
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      author: z.string(),
      tags: z.array(z.string()),

      // Optional fields
      image: image().optional(),
      draft: z.boolean().default(false),
    }),
});

export const collections = { blog };
