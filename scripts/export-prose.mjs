import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import AdmZip from 'adm-zip';

const PROSE_IMAGE_KEY = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
const WIKI_ICON_KEY = /^[a-f0-9]{32}\.(png|jpe?g|webp)$/;
const documentPath = /^pages\/([a-z0-9][a-z0-9_-]{0,127})\/(general|specific)\/([a-z0-9][a-z0-9_-]{0,127})\.json$/i;
const segment = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const license = { id: 'CC-BY-SA-3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/', file: 'PROSE-LICENSE.txt' };
const attributionFile = 'image-attribution.json';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: '.' },
    ref: { type: 'string', default: 'HEAD' },
    repository: { type: 'string', default: 'FinnHornhoover/OpenFusionWikiProse' },
    'site-url': { type: 'string', default: 'https://fusionfall.wiki' },
    output: { type: 'string' },
  },
});
if (!values.output) throw new Error('Provide --output <ZIP path>.');
if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(values.repository)) throw new Error('Expected owner/repository for --repository.');
const site = new URL(values['site-url']);
if (!['https:', 'http:'].includes(site.protocol) || site.href !== site.origin + '/') throw new Error('Expected an HTTP(S) origin for --site-url.');

function git(...args) {
  return execFileSync('git', ['-C', values.source, ...args]);
}

const commit = git('rev-parse', '--verify', '--end-of-options', values.ref + '^{commit}').toString().trim();
const files = new Map();
for (const entry of git('ls-tree', '-rz', '--full-tree', commit, '--', 'pages/', 'LICENSE', attributionFile).toString().split('\0')) {
  const tab = entry.indexOf('\t');
  if (tab < 0) continue;
  const path = entry.slice(tab + 1);
  if (path !== 'LICENSE' && path !== attributionFile && !documentPath.test(path)) continue;
  const [mode, type, object] = entry.slice(0, tab).split(' ');
  if ((mode !== '100644' && mode !== '100755') || type !== 'blob') throw new Error(`Expected a regular file at ${path}.`);
  files.set(path, object);
}
const pages = [...files.keys()].filter((path) => documentPath.test(path)).sort();
if (!pages.length) throw new Error('The selected commit contains no prose documents.');

function read(path) {
  return git('cat-file', 'blob', files.get(path));
}

function imageReferences(doc, path) {
  function readBlock(block) {
    if (block?.kind === 'markdown' && typeof block.source === 'string') return [];
    if (block?.kind === 'scope' && Array.isArray(block.blocks)) return block.blocks.flatMap(readBlock);
    if (block?.kind === 'image' && block.image) return [block.image];
    throw new Error(`Invalid prose block in ${path}.`);
  }
  function readSection(section) {
    if (typeof section?.title !== 'string' || !Array.isArray(section.blocks) || !Array.isArray(section.sections)) {
      throw new Error(`Invalid prose section in ${path}.`);
    }
    return [...section.blocks.flatMap(readBlock), ...section.sections.flatMap(readSection)];
  }
  if (doc?.version !== 1 || !Array.isArray(doc.sections)) throw new Error(`Invalid prose document ${path}.`);
  return doc.sections.flatMap(readSection);
}

async function request(path, optional = false) {
  const url = new URL(path, site);
  for (let attempt = 0; attempt < 3; attempt++) {
    let result;
    try {
      result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt === 2) throw new Error(`Could not fetch ${url.pathname}.`, { cause: error });
      continue;
    }
    if (optional && (result.status === 404 || (result.ok && result.headers.get('Content-Type')?.includes('text/html')))) {
      await result.body?.cancel();
      return;
    }
    if (result.ok) return result;
    await result.body?.cancel();
    if (result.status === 429 || result.status >= 500) {
      if (attempt < 2) {
        await new Promise((done) => setTimeout(done, 750 * (attempt + 1)));
        continue;
      }
    }
    throw new Error(`Could not fetch ${url.pathname} (HTTP ${result.status}).`);
  }
}

const archive = new AdmZip();
const timestamp = new Date(git('show', '-s', '--format=%cI', commit).toString().trim());
function addFile(path, bytes) {
  archive.addFile(path, Buffer.from(bytes));
  archive.getEntry(path).header.time = timestamp;
}

const assets = new Map();
const documents = new Map();
const legacy = new Map();
const attribution = files.has(attributionFile) ? JSON.parse(read(attributionFile)) : {};
if (!attribution || typeof attribution !== 'object' || Array.isArray(attribution)) throw new Error(`Invalid ${attributionFile}.`);

function registerImage(kind, key) {
  const uploaded = kind === 'upload';
  if (!(uploaded ? PROSE_IMAGE_KEY : WIKI_ICON_KEY).test(key ?? '')) throw new Error(`Invalid ${kind} image key.`);
  const path = `images/${uploaded ? 'uploads' : 'icons'}/${key}`;
  assets.set(path, { kind, url: (uploaded ? '/api/prose/images/' : '/icons/') + key, key });
  return path;
}

const repositoryLicense = files.has('LICENSE') ? 'repository/LICENSE' : undefined;
if (repositoryLicense) addFile(repositoryLicense, read('LICENSE'));
for (const path of pages) {
  const bytes = read(path);
  const doc = JSON.parse(bytes);
  const contributors = new Map();
  for (const person of [...(doc?.contributors ?? []), ...(doc?.editedBy ? [doc.editedBy] : [])]) {
    if (!Number.isSafeInteger(person?.id) || typeof person.login !== 'string' || !person.login) {
      throw new Error(`Invalid contributor credit in ${path}.`);
    }
    contributors.set(person.id, { id: person.id, login: person.login, url: 'https://github.com/' + encodeURIComponent(person.login) });
  }
  const uploads = new Map();
  const icons = new Map();
  const aliases = new Map();
  for (const image of imageReferences(doc, path)) {
    if (image.kind === 'upload') uploads.set(image.key, registerImage('upload', image.key));
    else if (image.kind === 'icon') icons.set(image.key, registerImage('icon', image.key));
    else if (image.kind === 'wiki' && typeof image.asset === 'string' && image.asset) aliases.set(image.asset, new Map());
    else throw new Error(`Invalid image reference in ${path}.`);
  }
  if (aliases.size) legacy.set(path, aliases);
  addFile(path, bytes);
  documents.set(path, {
    contributors: [...contributors.values()],
    images: { uploads: Object.fromEntries(uploads), icons: Object.fromEntries(icons) },
  });
}

if (legacy.size) {
  const builds = await (await request('/builds.json')).json();
  if (!Array.isArray(builds)) throw new Error('Invalid wiki build manifest.');
  const types = new Set([...legacy.keys()].map((path) => documentPath.exec(path)[1]));
  for (const { slug } of builds) {
    if (!segment.test(slug ?? '')) throw new Error('Invalid wiki build slug.');
    for (const type of types) {
      const response = await request(`/data/${slug}/prose/${type}.json`, true);
      if (!response) continue;
      for (const [route, entry] of Object.entries(await response.json())) {
        for (const scope of ['general', 'specific']) {
          const aliases = legacy.get(`pages/${type}/${scope}/${entry[scope]}.json`);
          if (!aliases || !entry.wikiImages) continue;
          for (const [name, variants] of aliases) {
            if (!Object.hasOwn(entry.wikiImages, name)) continue;
            const icon = /^\/icons\/([^/]+)$/.exec(entry.wikiImages[name]);
            if (!icon) throw new Error(`Invalid wiki icon for ${type}/${route}, ${name}.`);
            const routes = variants.get(slug) ?? new Map();
            routes.set(route, registerImage('icon', icon[1]));
            variants.set(slug, routes);
          }
        }
      }
    }
  }
  for (const [path, aliases] of legacy) {
    for (const [name, variants] of aliases) {
      if (!variants.size) throw new Error(`Unresolved wiki image “${name}” in ${path}.`);
    }
    documents.get(path).images.wiki = Object.fromEntries([...aliases].map(([name, builds]) => [
      name, Object.fromEntries([...builds].map(([build, routes]) => [build, Object.fromEntries(routes)])),
    ]));
  }
}

const archivedAssets = {};
for (const [path, { kind, url, key }] of [...assets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const response = await request(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const hash = kind === 'upload' ? sha256 : createHash('md5').update(bytes).digest('hex');
  if (hash !== key.split('.')[0]) throw new Error(`Image digest does not match ${url}.`);
  const credit = Object.hasOwn(attribution, path) ? attribution[path] : undefined;
  if (credit !== undefined && (!credit || typeof credit !== 'object' || Array.isArray(credit))) {
    throw new Error(`Invalid attribution for ${path}.`);
  }
  archivedAssets[path] = {
    kind, sha256, downloadUrl: new URL(url, site).href, license: credit?.license ?? null, attribution: credit,
  };
  addFile(path, bytes);
}

const manifest = {
  version: 1,
  source: { repository: `https://github.com/${values.repository}`, commit, licenseFile: repositoryLicense },
  proseLicense: license,
  documents: Object.fromEntries(documents),
  assets: archivedAssets,
};
addFile('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
addFile(license.file, [
  'OpenFusion Wiki player prose is licensed under Creative Commons Attribution-ShareAlike 3.0 Unported.',
  license.url,
  '',
  'See manifest.json for contributor credits and separate image attribution.',
  '',
].join('\n'));
addFile('README.txt', [
  'OpenFusion Wiki player prose',
  '',
  'pages/ contains the source documents as committed. manifest.json records who contributed',
  'to each document and maps its uploaded images, wiki icons, and legacy wiki aliases to',
  'files in this archive. Resolve legacy aliases by build and route. All image paths in',
  'the manifest are relative to the archive root.',
  '',
  'PROSE-LICENSE.txt identifies the player prose license. See manifest.json for each asset’s',
  'license and attribution.',
  'A null asset license means the source provides no explicit license for that file.',
  '',
].join('\n'));

await mkdir(dirname(values.output), { recursive: true });
const temporary = values.output + `.${process.pid}.tmp`;
try {
  await writeFile(temporary, archive.toBuffer(), { flag: 'wx' });
  await rename(temporary, values.output);
} finally {
  await rm(temporary, { force: true });
}
console.log(`Exported ${pages.length} prose documents and ${assets.size} images from ${commit}.`);
