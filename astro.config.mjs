import { defineConfig, passthroughImageService } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://robertmccaffrey.ie',
  image: {
    // We use plain <img> tags — no need for sharp image processing.
    service: passthroughImageService(),
  },
  integrations: [
    tailwind(),
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/newsletter-admin'),
    }),
  ],
});
