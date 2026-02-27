import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);

  return rss({
    title: 'Robert McCaffrey — Blog',
    description:
      'Thoughts on engineering leadership, software architecture, and building great teams.',
    site: context.site ?? 'https://robertmccaffrey.dev',
    items: posts
      .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
      .map((post) => ({
        title:       post.data.title,
        pubDate:     post.data.date,
        description: post.data.description,
        link:        `/blog/${post.slug}/`,
        categories:  post.data.tags,
      })),
    customData: `<language>en-ie</language>`,
  });
}
