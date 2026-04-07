// AnimeFire provider - cleaned & fixed
// - filters movies/OVA/ONA/specials
// - strong title match (pt/en/romaji friendly)
// - slug cache
// - stops on first correct match
// - returns max 4 streams (2 legendado, 2 dublado) with quality priority

const slugCache = new Map();

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isJunkTitle(title) {
  const t = normalize(title);
  return (
    t.includes('film') ||
    t.includes('movie') ||
    t.includes('especial') ||
    t.includes('ova') ||
    t.includes('ona') ||
    t.includes('episode of') ||
    t.includes('recap') ||
    t.includes('live action')
  );
}

function similarity(a, b) {
  // simple token overlap score
  const A = new Set(normalize(a).split(' '));
  const B = new Set(normalize(b).split(' '));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.max(1, Math.max(A.size, B.size));
}

function pickBest(streams, type) {
  const filtered = streams
    .filter(s => s.title === type)
    .sort((a, b) => b.quality - a.quality);

  if (filtered.length === 0) return [];

  const best = filtered[0];
  const fallback = filtered.find(s => s.quality < best.quality);

  return fallback ? [best, fallback] : [best];
}

async function searchAnime(query) {
  const res = await fetch(`https://animefire.net/pesquisar/${encodeURIComponent(query)}`);
  const html = await res.text();

  // parse results (ajuste seletor se necessário)
  const items = Array.from(html.matchAll(/href=\"([^\"]+)\"[^>]*>\s*<img[^>]*alt=\"([^\"]+)\"/g))
    .map(m => ({ url: m[1], title: m[2] }));

  // remove lixo
  let filtered = items.filter(i => !isJunkTitle(i.title));

  // prioridade: match exato
  const qn = normalize(query);
  const exact = filtered.find(i => normalize(i.title) === qn);
  if (exact) return [exact];

  // score por similaridade
  filtered = filtered
    .map(i => ({ ...i, score: similarity(i.title, query) }))
    .filter(i => i.score >= 0.4)
    .sort((a, b) => b.score - a.score);

  return filtered.slice(0, 5);
}

async function getEpisodeStreams(slug, ep) {
  const res = await fetch(`https://animefire.net/${slug}/${ep}`);
  const html = await res.text();

  const streams = [];

  // exemplo genérico (ajuste conforme estrutura real)
  const matches = Array.from(html.matchAll(/data-quality=\"(\d+)p\"[^>]*data-type=\"(dublado|legendado)\"[^>]*data-url=\"([^\"]+)\"/gi));

  for (const m of matches) {
    const quality = parseInt(m[1]);
    const type = m[2].toLowerCase() === 'dublado' ? 'Dublado' : 'Legendado';
    const url = m[3];

    streams.push({
      title: type,
      quality,
      url
    });
  }

  return streams;
}

export async function getStreams({ name, season, episode, tmdbId }) {
  const ep = episode || 1;

  // cache
  if (slugCache.has(tmdbId)) {
    const slug = slugCache.get(tmdbId);
    const s = await getEpisodeStreams(slug, ep);
    const legendado = pickBest(s, 'Legendado');
    const dublado = pickBest(s, 'Dublado');
    return [...legendado, ...dublado];
  }

  const results = await searchAnime(name);

  let allStreams = [];

  for (const item of results) {
    const slug = item.url.replace('https://animefire.net/', '').replace(/\/$/, '');

    const streams = await getEpisodeStreams(slug, ep);

    if (streams.length > 0) {
      slugCache.set(tmdbId, slug);
      allStreams = streams;
      break; // 🔥 evita misturar animes
    }
  }

  const legendado = pickBest(allStreams, 'Legendado');
  const dublado = pickBest(allStreams, 'Dublado');

  return [...legendado, ...dublado];
}
