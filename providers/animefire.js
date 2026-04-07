// ✅ VERSÃO ESTÁVEL (BASE ORIGINAL + FIXES SEM QUEBRAR NUVIO)

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

// 🔥 FIX 1: filtro de lixo (sem mexer no resto)
function isJunkSlug(slug) {
    const s = slug.toLowerCase();
    return (
        s.includes('movie') ||
        s.includes('filme') ||
        s.includes('especial') ||
        s.includes('ova') ||
        s.includes('ona') ||
        s.includes('recap') ||
        s.includes('special')
    );
}

// ─── SEARCH (mínima alteração segura) ─────────────────────────
async function searchAnimeFire(title) {
    const slug = titleToSlug(title);
    const url = `${BASE_URL}/pesquisar/${slug}`;

    try {
        const resp = await fetch(url, { headers: SEARCH_HEADERS });
        if (!resp.ok) return [];
        const rawHtml = await resp.text();

        const items = [];
        const seen = new Set();

        // 🔥 regex simples (compatível com Nuvio)
        const regex = /href="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^\"]+)"/g;

        let m;
        while ((m = regex.exec(rawHtml)) !== null) {
            const fullUrl = m[1];

            const rawSlug = fullUrl.replace(BASE_URL + '/', '').split('/')[1] || '';

            if (!rawSlug.includes('todos-os-episodios')) continue;
            if (isJunkSlug(rawSlug)) continue;
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            const isDubbed = rawSlug.toLowerCase().includes('dublado');
            const rootSlug = rawSlug.replace(/-todos-os-episodios$/i, '');
            const season = detectSeason(rootSlug);

            items.push({ rootSlug, isDubbed, season });
        }

        return items;
    } catch {
        return [];
    }
}

// ─── DETECT SEASON (original) ───────────────────────
function detectSeason(slug) {
    const s = slug.toLowerCase();

    if (s.includes('movie') || s.includes('filme') || s.includes('cinema')) return 'movie';
    if (s.includes('omakes') || s.includes('recap') || s.includes('special')) return 'movie';

    let m = s.match(/-season-(\d+)/);
    if (m) return parseInt(m[1]);

    m = s.match(/(\d+)(st|nd|rd|th)-season/);
    if (m) return parseInt(m[1]);

    if (s.includes('part')) return 1;

    m = s.match(/-s(\d+)$/);
    if (m) return parseInt(m[1]);

    m = s.match(/-(\d+)$/);
    if (m) {
        const n = parseInt(m[1]);
        if (n >= 2 && n <= 20) return n;
    }

    return 1;
}

// ─── VIDEO (INALTERADO) ─────────────────────────
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
                        'User-Agent': 'Mozilla/5.0'
                    }
                };
            });
    } catch {
        return [];
    }
}

// 🔥 FIX 2: limitar fontes (não quebra nada)
function limitStreams(streams) {
    const legendado = streams.filter(s => s.title === 'Legendado').sort((a,b)=>b.quality-a.quality);
    const dublado = streams.filter(s => s.title === 'Dublado').sort((a,b)=>b.quality-a.quality);

    return [...legendado.slice(0,2), ...dublado.slice(0,2)];
}

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── ANILIST (ORIGINAL RESTAURADO) ─────────────────────────
async function getAniListTitles(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbUrl = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;

    const tmdbResp = await fetch(tmdbUrl);
    if (!tmdbResp.ok) return [];
    const tmdbData = await tmdbResp.json();
    const searchTitle = mediaType === 'tv' ? tmdbData.name : tmdbData.title;

    return [{ name: searchTitle }];
}

// ─── GET STREAMS (APENAS 1 FIX CRÍTICO) ─────────────────────
async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;

    try {
        const titles = await getAniListTitles(tmdbId, mediaType);
        if (!titles.length) return [];

        const allStreams = [];
        const triedSlugs = new Set();
        let chosenSlug = null; // 🔥 FIX PRINCIPAL

        for (const titleInfo of titles) {
            const animeLinks = await searchAnimeFire(titleInfo.name);
            if (!animeLinks.length) continue;

            const seasonMatches = animeLinks.filter(item => item.season === targetSeason);

            for (const item of seasonMatches) {
                if (triedSlugs.has(item.rootSlug)) continue;

                if (!chosenSlug) chosenSlug = item.rootSlug;
                if (item.rootSlug !== chosenSlug) continue;

                triedSlugs.add(item.rootSlug);

                const streams = await extractVideoStreams(item.rootSlug, targetEpisode, item.isDubbed);

                if (streams.length > 0) {
                    allStreams.push(...streams);
                }
            }

            if (allStreams.length > 0) break;
        }

        return limitStreams(allStreams).sort((a, b) => b.quality - a.quality);

    } catch {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
