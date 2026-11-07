import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import * as markdown from 'react-markdown';
import * as gfm from 'remark-gfm';

const require = createRequire(import.meta.url);
const mediaSource = readFileSync(new URL('../site-example/GuideVideo.tsx', import.meta.url), 'utf8');
const mediaCompiled = transformSync(mediaSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code;
const mediaModule = { exports: {} };
new Function('require', 'exports', 'module', mediaCompiled)(require, mediaModule.exports, mediaModule);
const source = readFileSync(new URL('../site-example/page.tsx', import.meta.url), 'utf8');
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022' }).code;
export const guide = {
  slug: 'requests', title: 'Requests', summary: 'Work on requests', as_of: '2026-09-29',
  video: 'https://example.test/guide.mp4', poster: null, video_seconds: 50,
  body_md: '![Choose a priority](asset:choice.mp4)\n\n![Request list](asset:shot.png)\n\n![](asset:quiet.mp4)',
  assets: { 'choice.mp4': 'https://example.test/choice.mp4?token=synthetic', 'shot.png': 'https://example.test/shot.png', 'quiet.mp4': 'https://example.test/quiet.mp4' },
};
// Execute the real TSX with the real React/Markdown renderers. Stub only host-app
// auth and data: no Next app, DB credentials, signed URLs or service calls needed.
export async function pageElement(guides = [guide], userId = 'synthetic-user') {
  const module = { exports: {} };
  new Function('require', 'exports', 'module', compiled)(id => {
    if (id === './guides.css') return {};
    if (id === './GuideVideo') return mediaModule.exports;
    if (id === 'next/navigation') return { redirect: () => { throw new Error('redirect /login'); } };
    if (id === 'react-markdown') return { ...markdown, __esModule: true };
    if (id === 'remark-gfm') return { ...gfm, __esModule: true };
    if (id === '@/lib/auth') return { sessionUserId: async () => userId };
    if (id === '@/lib/guides') return {
      loadGuides: async () => guides, runningTime: () => '50 s', asOfLabel: () => 'Sep 29, 2026',
      assetUrl: (src, signed) => src.startsWith('asset:') ? signed[src.slice(6)] || '' : src,
      isVideo: src => /\.(mp4|webm|mov)$/i.test(src.split('?')[0]),
    };
    return require(id);
  }, module.exports, module);
  return await module.exports.default();
}
