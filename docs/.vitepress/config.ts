import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Lightback',
  description: 'Point at the problem. Send the context. In-app feedback for your own backend.',
  base: '/lightback/',
  // Internal implementation plans stay in the repository, outside the public guide.
  srcExclude: ['ARCHITECTURE.md', 'DECISIONS.md', 'ROADMAP.md', 'HANDOFF.md', 'AGENTS.md'],
  themeConfig: {
    nav: [
      { text: 'Demo', link: 'https://aleandros.github.io/lightback/demo/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Payload', link: '/guide/payload' },
    ],
    sidebar: [{ text: 'Guide', items: [
      { text: 'Getting started', link: '/guide/getting-started' },
      { text: 'Customization', link: '/guide/customization' },
      { text: 'Backend', link: '/guide/backend' },
      { text: 'Texts and i18n', link: '/guide/texts-and-i18n' },
      { text: 'Payload reference', link: '/guide/payload' },
    ] }],
    socialLinks: [{ icon: 'github', link: 'https://github.com/aleandros/lightback' }],
    search: { provider: 'local' },
    editLink: { pattern: 'https://github.com/aleandros/lightback/edit/main/docs/:path' },
    footer: { message: 'MIT licensed. Your app, your backend, your feedback.' },
  },
});
