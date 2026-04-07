async function searchAnimeFire(query) {
  const res = await fetch(`https://animefire.io/pesquisar/${encodeURIComponent(query)}`);
  const html = await res.text();

  const results = [];

  const regex = /href="\/animes\/([^"]+)"/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const slug = match[1];

    // evita duplicado
    if (!results.find(r => r.slug === slug)) {
      results.push({ slug });
    }
  }

  return results;
}

function parseSlugInfo(slug) {
  let clean = slug.toLowerCase();

  let season = 1;

  const partMatch = clean.match(/part-(\d+)/);
  const seasonMatch = clean.match(/season-(\d+)/);

  if (partMatch) season = parseInt(partMatch[1]);
  if (seasonMatch) season = parseInt(seasonMatch[1]);

  const base = clean
    .replace(/-dublado/g, '')
    .replace(/-part-\d+/g, '')
    .replace(/-season-\d+/g, '');

  return { base, season };
}

function limitStreams(streams) {
  const legendado = [];
  const dublado = [];

  for (const s of streams) {
    if (s.audio === "dub") {
      if (dublado.length < 2) dublado.push(s);
    } else {
      if (legendado.length < 2) legendado.push(s);
    }
  }

  return [...legendado, ...dublado];
}

async function getStreams(slug, episode) {
  const url = `https://animefire.io/animes/${slug}/${episode}`;
  const res = await fetch(url);
  const html = await res.text();

  const streams = [];

  // pega players (ajustado simples pra não quebrar)
  const regex = /src="([^"]+m3u8[^"]*)"/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    streams.push({
      url: match[1],
      quality: match[1].includes("1080") ? "1080p" :
               match[1].includes("720") ? "720p" : "360p",
      audio: slug.includes("dublado") ? "dub" : "sub",
      language: "pt-br",
      type: "hls"
    });
  }

  return limitStreams(streams);
}

async function scrape(ctx) {
  const title = ctx.title;
  const episode = ctx.episode;

  let results = await searchAnimeFire(title);

  if (!results.length) return [];

  // escolhe primeiro como base
  const chosenSlug = results[0].slug;

  const target = parseSlugInfo(chosenSlug);

  // 🔥 FILTRO CORRETO (resolve teu bug)
  results = results.filter(r => {
    const info = parseSlugInfo(r.slug);

    return (
      info.base === target.base &&
      info.season === target.season
    );
  });

  let streams = [];

  for (const r of results) {
    const s = await getStreams(r.slug, episode);
    streams.push(...s);
  }

  return limitStreams(streams);
}

module.exports = {
  scrape
};
