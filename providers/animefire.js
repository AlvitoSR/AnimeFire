// ✅ VERSÃO ORIGINAL PRESERVADA + CORREÇÕES (SEM QUEBRAR ESTRUTURA)

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

// 🔥 NOVO: filtro de lixo (filmes/especiais)
function isJunkSlug(slug) {
    const s = slug.toLowerCase();
    return (
        s.includes('movie') ||
        s.includes('filme') ||
        s.includes('especial') ||
        s.includes('ova') ||
        s.includes('ona') ||
        s.includes('recap') ||
        s.includes('episode-of') ||
        s.includes('special')
    );
}

// ─── Buscar anime ─────────────────────────
async function searchAnimeFire(title) {
    const slug = titleToSlug(title);
    const url = `${BASE_URL}/pesquisar/${slug}`;

    try {
        const resp = await fetch(url, { headers: SEARCH_HEADERS });
        if (!resp.ok) return [];
        const rawHtml = await resp.text();

        const items = [];
        const seen = new Set();
        const regex = /<a(?=[^>]*\bhref="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^\"]+)")[^>]*>([\s\S]*?)<\/a>/g;
        let m;

        while ((m = regex.exec(rawHtml)) !== null) {
            const fullUrl = m[1];
            const cardHtml = m[2];

            const titleMatch = cardHtml.match(/animeTitle[^>]*>\s*([^<]+)</);
            if (!titleMatch) continue;

            const rawSlug = fullUrl.replace(BASE_URL + '/', '').split('/')[1] || '';

            if (!rawSlug.toLowerCase().includes('todos-os-episodios')) continue;
            if (isJunkSlug(rawSlug)) continue; // 🔥 AQUI resolve filmes
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            const displayTitle = titleMatch[1].trim();
            const isDubbed = rawSlug.toLowerCase().includes('dublado');
            const rootSlug = rawSlug.replace(/-todos-os-episodios$/i, '');

            let season = detectSeason(rootSlug);

            items.push({ rootSlug, isDubbed, displayTitle, season });
        }

        return items;
    } catch {
        return [];
    }
}

// ─── Detectar temporada (mantido original) ───────────────────────
function detectSeason(slug) {
    const s = slug.toLowerCase();

    if (s.includes('movie') || s.includes('filme') || s.includes('cinema')) {
        return 'movie';
    }

    if (s.includes('omakes') || s.includes('recap') || s.includes('special')) {
        return 'movie';
    }

    let m = s.match(/[-]season[-](\d+)/);
    if (m) return parseInt(m[1]);

    m = s.match(/(\d+)(?:st|nd|rd|th)[-\s]season|season[-](\d+)/);
    if (m) return parseInt(m[1] || m[2]);

    if (s.includes('part')) return 1;

    m = s.match(/-s(\d+)$/);
    if (m) return parseInt(m[1]);

    m = s.match(/-(\d+)$/);
    if (m) {
        const n = parseInt(m[1]);
        if (n >= 2 && n <= 20) {
            const beforeNum = s.replace(/-\d+$/, '');
            if (!beforeNum.includes('part') && !beforeNum.includes('code') && !beforeNum.includes('white')) {
                return n;
            }
        }
    }

    return 1;
}

// ─── VIDEO (mantido) ────────────────────────────────────
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

// 🔥 NOVO: limitar streams (4 no máximo)
function limitStreams(streams) {
    const legendado = streams.filter(s => s.title === 'Legendado').sort((a,b)=>b.quality-a.quality);
    const dublado = streams.filter(s => s.title === 'Dublado').sort((a,b)=>b.quality-a.quality);

    return [
        ...legendado.slice(0,2),
        ...dublado.slice(0,2)
    ];
}

// ─── HELPERS (mantido) ─────────────────────────────────────────
function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─── getStreams (APENAS AJUSTES) ──────────────────────────────
async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;

    try {
        const titles = await getAniListTitles(tmdbId, mediaType);
        if (!titles.length) return [];

        const allStreams = [];
        const triedSlugs = new Set();

        for (const titleInfo of titles) {
            const animeLinks = await searchAnimeFire(titleInfo.name);
            if (!animeLinks.length) continue;

            const searchTitleForValidation = titleToSlug(titleInfo.name);
            const titleWords = searchTitleForValidation.split('-').filter(w => w.length > 2);

            const validLinks = animeLinks.filter(item => {
                if (titleWords.length === 0) return true;
                return titleWords.some(word => item.rootSlug.toLowerCase().includes(word));
            });

            const seasonMatches = validLinks.filter(item => item.season === targetSeason);

            for (const item of seasonMatches) {
                if (triedSlugs.has(item.rootSlug)) continue;
                triedSlugs.add(item.rootSlug);

                const streams = await extractVideoStreams(item.rootSlug, targetEpisode, item.isDubbed);

                if (streams.length > 0) {
                    allStreams.push(...streams);
                }
            }

            if (allStreams.length > 0) break;
        }

        // 🔥 AQUI resolve spam de fontes
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
