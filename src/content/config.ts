import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    image: z.string().optional(),
    imageAlt: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tech: z.array(z.string()).default([]),
    githubUrl: z.string().url().optional().or(z.literal('')),
    liveUrl: z.string().url().optional().or(z.literal('')),
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = { blog, projects };
