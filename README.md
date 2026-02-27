# Robert McCaffrey — Portfolio

Personal portfolio site built with [Astro 4](https://astro.build), [Tailwind CSS 3](https://tailwindcss.com), and TypeScript.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server  (http://localhost:4321)
npm run dev

# 3. Build for production  → dist/
npm run build

# 4. Preview the production build locally
npm run preview
```

---

## File tree

```
portfolio/
├── public/
│   ├── cv/                          ← place Robert_McCaffrey_CV.pdf here
│   ├── photos/                      ← place photo images here
│   ├── profile.jpg                  ← your profile photo (square recommended)
│   └── favicon.svg
├── src/
│   ├── content/
│   │   ├── config.ts                ← Zod schemas for collections
│   │   ├── blog/                    ← blog posts (.md / .mdx)
│   │   ├── projects/                ← project entries (.md)
│   │   ├── photos.json              ← photo metadata
│   │   └── music.json               ← music metadata
│   ├── components/
│   │   ├── Navbar.astro
│   │   ├── Footer.astro
│   │   ├── ThemeToggle.astro
│   │   ├── BlogCard.astro
│   │   └── ProjectCard.astro
│   ├── layouts/
│   │   └── Layout.astro             ← global HTML shell + SEO tags
│   ├── pages/
│   │   ├── index.astro              ← / (home)
│   │   ├── blog/
│   │   │   ├── index.astro          ← /blog
│   │   │   └── [slug].astro         ← /blog/:slug
│   │   ├── projects/
│   │   │   └── index.astro          ← /projects
│   │   ├── cv.astro                 ← /cv
│   │   ├── photography.astro        ← /photography
│   │   ├── music.astro              ← /music
│   │   ├── contact.astro            ← /contact
│   │   └── rss.xml.ts               ← /rss.xml (auto-generated feed)
│   └── env.d.ts
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
├── .env.example
└── package.json
```

---

## Content guide

### Adding a blog post

Create a `.md` or `.mdx` file in `src/content/blog/`:

```mdx
---
title: "Post title"
date: 2024-06-01
description: "One-sentence summary (used for SEO and card previews)."
tags: ["engineering", "leadership"]
draft: false          # set true to hide from listing
---

Your Markdown content here.
```

The filename becomes the URL slug: `my-first-post.mdx` → `/blog/my-first-post`.
MDX lets you import and use Astro/React components inside posts if needed.

---

### Adding a project

Create a `.md` file in `src/content/projects/`:

```md
---
title: "Project Name"
description: "What it does and why it matters."
tech: ["TypeScript", "Node.js", "Postgres"]
githubUrl: "https://github.com/you/project"   # leave "" to hide button
liveUrl: "https://yourproject.com"             # leave "" to hide button
featured: true    # true → appears on the homepage and at top of /projects
order: 1          # lower numbers appear first among featured projects
---
```

---

### Adding photos

1. **Copy images** into `public/photos/` (JPEG / PNG / WebP, any resolution).

2. **Add metadata** to `src/content/photos.json`:

```json
[
  {
    "filename": "dublin-dawn.jpg",
    "title": "Dublin at Dawn",
    "location": "Dublin, Ireland",
    "date": "2024-05-10",
    "camera": "Sony A7 IV"
  }
]
```

All fields except `filename` and `title` are optional.
Photos appear in a CSS masonry grid with a click-to-open lightbox.

---

### Adding music

Edit `src/content/music.json`:

```json
[
  {
    "title": "Track or playlist name",
    "description": "Brief description.",
    "embedUrl": "https://open.spotify.com/embed/track/TRACK_ID?utm_source=generator",
    "linkUrl": "https://open.spotify.com/track/TRACK_ID"
  }
]
```

**Getting a Spotify embed URL:**
Track / playlist → ⋯ menu → Share → Embed → copy the `src` value from the `<iframe>`.

Leave `embedUrl` as `""` to show only a text link instead of a player.

---

### Adding your CV PDF

Drop the file at:

```
public/cv/Robert_McCaffrey_CV.pdf
```

It is automatically:
- embedded in an `<iframe>` on the `/cv` page
- available for download via the "Download PDF" button
- served statically at `/cv/Robert_McCaffrey_CV.pdf`

---

## Configuration

### Personal details to update

| What | File | Where |
|---|---|---|
| Name / headline / bio | `src/pages/index.astro` | Hero section |
| Email address | `src/pages/contact.astro` | `const email` at top |
| GitHub URL | `src/components/Footer.astro` | `href` on GitHub link |
| LinkedIn URL | `src/components/Footer.astro` + `src/pages/index.astro` | LinkedIn links |
| Site URL (SEO / sitemap / RSS) | `astro.config.mjs` | `site:` field |
| CV highlights (experience etc.) | `src/pages/cv.astro` | `experience` / `education` / `skills` arrays |

### Profile photo

Replace `public/profile.jpg` with your own image.
Square crop recommended — it renders at 240 × 240 px in a circle.

---

## Contact form options

### Option 1 — Formspree (easiest for static hosting)

1. Sign up at [formspree.io](https://formspree.io) and create a new form.
2. Copy the endpoint URL (looks like `https://formspree.io/f/xabcdefg`).
3. Create `.env` from the example and paste it in:

```bash
cp .env.example .env
# Edit .env:
PUBLIC_FORMSPREE_ENDPOINT=https://formspree.io/f/xabcdefg
```

4. Rebuild — the form will now POST to Formspree.

### Option 2 — Netlify Forms

Deploy to Netlify. Leave `PUBLIC_FORMSPREE_ENDPOINT` unset.
The form already has `data-netlify="true"` and `name="contact"` — Netlify picks this up automatically and emails you on submission.

### Option 3 — Mailto fallback

If neither is configured, the form action is a `mailto:` link. Works without any backend but depends on the visitor's email client being set up.

---

## Newsletter + Admin

The portfolio now includes newsletter signup forms on:
- `/` (home)
- `/blog`
- `/blog/:slug` (end of each post)

Admin UI:
- `/newsletter-admin`
- `https://admin.robertmccaffrey.ie` (redirects to `/newsletter-admin` after nginx + DNS config)

Required server-side env vars (set in `personal-app-terraform/.env` on the server):
- `POSTMARK_SERVER_TOKEN`
- `PORTFOLIO_ADMIN_USERNAME`
- `PORTFOLIO_ADMIN_PASSWORD`
- `PORTFOLIO_ADMIN_SESSION_SECRET`

---

## Dark mode

Defaults to the visitor's OS preference. Persists across sessions via `localStorage`. Toggle via the sun/moon icon in the navbar.

---

## SEO

- `<title>`, `<meta name="description">`, canonical `<link>` on every page.
- Open Graph + Twitter Card tags in `src/layouts/Layout.astro`.
- Sitemap at `/sitemap-index.xml` (generated by `@astrojs/sitemap`).
- RSS feed at `/rss.xml` (generated by `@astrojs/rss`).

Update `site` in `astro.config.mjs` to your production domain before deploying.

---

## Deployment

### Netlify (recommended for this stack)

```bash
npm run build        # outputs to dist/
```

In Netlify dashboard:
- Build command: `npm run build`
- Publish directory: `dist`

### Vercel

```bash
npx vercel           # follows prompts; auto-detects Astro
```

### Any static host (GitHub Pages, Cloudflare Pages, S3…)

Upload the contents of `dist/` after running `npm run build`.

---

## Tech stack

| Package | Purpose |
|---|---|
| [astro ^4.16](https://astro.build) | Static site generator, content collections, MDX |
| [@astrojs/tailwind](https://docs.astro.build/en/guides/integrations-guide/tailwind/) | Tailwind CSS integration |
| [@astrojs/mdx](https://docs.astro.build/en/guides/integrations-guide/mdx/) | MDX support for blog posts |
| [@astrojs/rss](https://docs.astro.build/en/guides/rss/) | RSS feed generation |
| [@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/) | Sitemap generation |
| [tailwindcss ^3.4](https://tailwindcss.com) | Utility-first CSS |
| [@tailwindcss/typography](https://tailwindcss.com/docs/typography-plugin) | Prose styles for blog post bodies |
| [typescript ^5.6](https://www.typescriptlang.org) | Type safety throughout |
