const TMDB_API_KEY = 'c6c6f4c1cb446e0d5c305f3fa7eeb4a9';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const BASE_URL = 'https://animefire.io';

const SEARCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': BASE_URL + '/'
};

const VIDEO_HEADERS = {
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': BASE_URL
};

// ─── Buscar anime no AnimeFire (todos os resultados) ─────────────────────────

async function searchAnimeFire(title) {
    const slug = titleToSlug(title);
    const url = `${BASE_URL}/pesquisar/${slug}`;

    try {
        const resp = await fetch(url, { headers: SEARCH_HEADERS });
        if (!resp.ok) return [];
        const rawHtml = await resp.text();

        const items = [];
        const seen = new Set();
        const regex = /<a(?=[^>]*\bhref="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^"]+)")[^>]*>([\s\S]*?)<\/a>/g;
        let m;

        while ((m = regex.exec(rawHtml)) !== null) {
            const fullUrl = m[1];
            const cardHtml = m[2];

            // Extrair titulo do card
            const titleMatch = cardHtml.match(/animeTitle[^>]*>\s*([^<]+)</);
            if (!titleMatch) continue;

            const rawSlug = fullUrl.replace(BASE_URL + '/', '').split('/')[1] || '';
            if (!rawSlug.toLowerCase().includes('todos-os-episodios')) continue;
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            const displayTitle = titleMatch[1].trim();
            const isDubbed = rawSlug.toLowerCase().includes('dublado');
            const rootSlug = rawSlug.replace(/-todos-os-episodios$/i, '');

            // Determinar temporada pelo slug
            let season = detectSeason(rootSlug);

            items.push({ rootSlug, isDubbed, displayTitle, season });
        }
        return items;
    } catch {
        return [];
    }
}

// ─── Detectar numero da temporada pelo slug ──────────────────────────────────

function detectSeason(slug) {
    const s = slug.toLowerCase();

    // Padrões conhecidos: "-season-X", "-sX", "-X-" no fim, "Xnd-season" (2nd)
    // Ex: spy-x-family-season-3
    let m = s.match(/(?:^|[-])season[-](\d+)$/);
    if (m) return parseInt(m[1]);

    // Ex: one-punch-man-2nd-season, one-punch-man-3rd-season
    m = s.match(/(\d+)(?:st|nd|rd|th)\s*-season|season[-](\d+)/);
    if (m) return parseInt(m[1] || m[2]);

    // Ex: anime-s2, anime-s3
    m = s.match(/-s(\d+)$/);
    if (m) return parseInt(m[1]);

    // Ex: anime-2, anime-3 (numero solto no fim)
    m = s.match(/-(\d+)$/);
    if (m) {
        const n = parseInt(m[1]);
        if (n > 0 && n < 50) return n;
    }

    // Se nao tem numero de temporada → temporada 1
    return 1;
}

// ─── Chamar API /video/ (sem Cloudflare) ────────────────────────────────────

async function extractVideoStreams(rootSlug, episodeNum, isDubbed) {
    if (!rootSlug || !episodeNum) return [];

    const timestamp = Math.floor(Date.now() / 1000);
    const url = `${BASE_URL}/video/${rootSlug}/${episodeNum}?tempsubs=0&${timestamp}`;

    try {
        const resp = await fetch(url, { headers: VIDEO_HEADERS });
        if (!resp.ok) return [];

        const text = await resp.text();
        if (text.length < 30) return [];

        const json = JSON.parse(text);
        const data = json?.data;
        if (!data || data.length === 0) return [];

        const audioLabel = isDubbed ? 'Dublado' : 'Legendado';

        return data
            .filter(item => item.src)
            .map(item => {
                let quality = 360;
                let qualityLabel = item.label || '360p';
                const numMatch = qualityLabel.match(/\d+/);
                if (numMatch) {
                    const n = parseInt(numMatch[0]);
                    quality = n >= 1080 ? 1080 : n >= 720 ? 720 : n >= 480 ? 480 : 360;
                }
                return {
                    url: item.src,
                    name: `AnimeFire ${audioLabel} ${qualityLabel}`,
                    title: `${audioLabel}`,
                    quality: quality,
                    type: item.src.includes('.m3u8') ? 'hls' : 'mp4',
                    headers: {
                        'Referer': BASE_URL,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                };
            });
    } catch {
        return [];
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── AniList → titulos alternativos ─────────────────────────────────────────

async function getAniListTitles(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbUrl = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;

    const tmdbResp = await fetch(tmdbUrl);
    if (!tmdbResp.ok) return [];
    const tmdbData = await tmdbResp.json();
    const searchTitle = mediaType === 'tv' ? tmdbData.name : tmdbData.title;

    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                title { romaji english }
                synonyms
            }
        }`;

    const anilistResp = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: searchTitle } })
    });

    if (!anilistResp.ok) return [{ name: searchTitle, type: 'tmdb' }];
    const anilistData = await anilistResp.json();
    const media = anilistData?.data?.Media;

    const titles = [];
    if (media?.title?.romaji) titles.push({ name: media.title.romaji, type: 'romaji' });
    if (media?.title?.english && media.title.english !== media.title.romaji) {
        titles.push({ name: media.title.english, type: 'english' });
    }
    if (media?.synonyms) {
        for (const syn of media.synonyms) {
            if (!titles.some(t => t.name.toLowerCase() === syn.toLowerCase())) {
                titles.push({ name: syn, type: 'synonym' });
            }
        }
    }
    if (titles.length === 0) titles.push({ name: searchTitle, type: 'tmdb' });
    return titles;
}

// ─── getStreams ──────────────────────────────────────────────────────────────

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;

    try {
        const titles = await getAniListTitles(tmdbId, mediaType);
        if (!titles.length) return [];

        const allStreams = [];
        const triedSlugs = new Set();

        // 1) Buscar em todos os titulos e coletar TODOS os resultados
        for (const titleInfo of titles) {
            const animeLinks = await searchAnimeFire(titleInfo.name);
            if (!animeLinks.length) continue;

            // 2) Filtrar apenas pela temporada correta
            const seasonMatches = animeLinks.filter(item => item.season === targetSeason);

            for (const item of seasonMatches) {
                if (triedSlugs.has(item.rootSlug)) continue;
                triedSlugs.add(item.rootSlug);

                const streams = await extractVideoStreams(item.rootSlug, targetEpisode, item.isDubbed);
                if (streams.length > 0) {
                    allStreams.push(...streams);
                }
            }

            // Se ja encontrou streams, nao precisa buscar pelo proximo titulo
            if (allStreams.length > 0) break;
        }

        return allStreams.sort((a, b) => b.quality - a.quality);
    } catch {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
