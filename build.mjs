/**
 * Сборка продакшн-версии smit34.ru.
 *
 * Источник правды — index.html (React + JSX прямо в разметке, Tailwind по классам).
 * Скрипт убирает из рантайма две тяжёлые вещи:
 *   1. @babel/standalone — JSX компилируется здесь, браузер получает готовый js/app.js;
 *   2. cdn.tailwindcss.com — CSS собирается здесь, браузер получает css/app.css.
 *
 * Запуск:  node build.mjs        (результат — папка dist/)
 * Деплой:  bash deploy.sh
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const TOOLS = 'd:/tmp/smitbuild';
const require = createRequire(path.join(TOOLS, 'noop.js'));
const Babel = require('@babel/standalone');
const esbuild = require('esbuild');

const SRC = path.join(ROOT, 'index.html');
const DIST = path.join(ROOT, 'dist');

// --- 1. читаем исходник ---------------------------------------------------
let html = readFileSync(SRC, 'utf8');

// --- 2. вырезаем JSX и компилируем ---------------------------------------
const babelTag = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const m = html.match(babelTag);
if (!m) throw new Error('не найден <script type="text/babel">');

const jsx = m[1];
// те же пресеты, что и в рантайме (см. Babel.registerPreset('smit-classic') в index.html):
// env с modules:false, чтобы не появлялись import-ы, и classic JSX-runtime
const compiled = Babel.transform(jsx, {
  presets: [
    [Babel.availablePresets['env'], { modules: false }],
    [Babel.availablePresets['react'], { runtime: 'classic' }],
  ],
  filename: 'app.jsx',
}).code;

const minified = esbuild.transformSync(compiled, {
  minify: true,
  target: ['es2018'],
  loader: 'js',
}).code;

// --- 3. собираем Tailwind -------------------------------------------------
// Классы, которые строятся в рантайме через шаблонные строки, Tailwind в исходнике
// не увидит — перечисляем их явно.
const NEWS_COLORS = ['blue', 'cyan', 'emerald', 'orange', 'purple', 'teal'];
const safelist = [];
for (const c of NEWS_COLORS) {
  safelist.push(
    `bg-${c}-100`, `bg-${c}-500/80`, `bg-${c}-900/30`,
    `text-${c}-400`, `text-${c}-700`,
    `border-${c}-200`, `border-${c}-800`,
  );
}

mkdirSync(TOOLS + '/tw', { recursive: true });
writeFileSync(path.join(TOOLS, 'tw', 'tailwind.config.js'), `module.exports = {
  darkMode: 'class',
  content: ['${SRC.replace(/\\/g, '/')}', '${path.join(ROOT, 'aida-widget.js').replace(/\\/g, '/')}'],
  safelist: ${JSON.stringify(safelist)},
  theme: { extend: {} },
  plugins: [],
};`);
writeFileSync(path.join(TOOLS, 'tw', 'input.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');

execFileSync(process.execPath, [
  path.join(TOOLS, 'node_modules', 'tailwindcss', 'lib', 'cli.js'),
  '-c', path.join(TOOLS, 'tw', 'tailwind.config.js'),
  '-i', path.join(TOOLS, 'tw', 'input.css'),
  '-o', path.join(TOOLS, 'tw', 'output.css'),
  '--minify',
], { stdio: 'inherit' });

const css = readFileSync(path.join(TOOLS, 'tw', 'output.css'), 'utf8');

// --- 4. собираем dist/index.html -----------------------------------------
// чистим содержимое, а не саму папку: dist может быть текущей директорией терминала
mkdirSync(path.join(DIST, 'js'), { recursive: true });
mkdirSync(path.join(DIST, 'css'), { recursive: true });
for (const sub of ['js', 'css']) {
  for (const f of readdirSync(path.join(DIST, sub))) rmSync(path.join(DIST, sub, f), { force: true });
}

// хэш в имени файла — можно кэшировать навсегда
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const jsName = `app.${hash(minified)}.js`;
const cssName = `app.${hash(css)}.css`;

writeFileSync(path.join(DIST, 'js', jsName), minified);
writeFileSync(path.join(DIST, 'css', cssName), css);

let out = html
  // JSX-блок → внешний скрипт
  .replace(babelTag, `<script src="/js/${jsName}" defer></script>`)
  // Tailwind CDN больше не нужен
  .replace(/\s*<script src="https:\/\/cdn\.tailwindcss\.com"[^>]*><\/script>/g, '')
  .replace(/\s*<script>\s*tailwind\.config[\s\S]*?<\/script>/g, '')
  // Babel больше не нужен — вместе с регистрацией кастомного пресета
  .replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/g, '')
  .replace(/\s*<script>\s*if \(window\.Babel && Babel\.registerPreset\)[\s\S]*?<\/script>/g, '')
  // React грузим отложенно — app.js стоит с defer и выполнится после них
  .replace(/(<script src="https:\/\/unpkg\.com\/react[^"]*")(\s*><\/script>)/g, '$1 defer$2');

// подключаем собранный CSS вместо CDN
out = out.replace('</head>', `    <link rel="stylesheet" href="/css/${cssName}">\n</head>`);

writeFileSync(path.join(DIST, 'index.html'), out);

// вспомогательные файлы рядом с index.html
for (const f of ['aida-widget.js']) {
  if (existsSync(path.join(ROOT, f))) cpSync(path.join(ROOT, f), path.join(DIST, f));
}

const kb = (s) => Math.round(Buffer.byteLength(s) / 1024);
console.log(`\nготово:
  js/${jsName}   ${kb(minified)} KB
  css/${cssName}  ${kb(css)} KB
  index.html      ${kb(out)} KB (было ${kb(html)} KB)`);
