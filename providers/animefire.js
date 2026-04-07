const TMDB_API_KEY = 'c6c6f4c1cb446e0d5c305f3fa7eeb4a9';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const BASE_URL = 'https://animefire.io';

const SEARCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': BASE_URL + '/'
};

const VIDEO_HEADERS = {
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0',
    'Referer': BASE_URL
};

const slugCache = new Map();

async function searchAnimeFire(title) {
    const slug = titleToSlug(title);
    const url = `${BASE_URL}/pesquisar/${slug}`;

    try {
        const resp = await fetch(url, { headers: SEARCH_HEADERS });
        if (!resp.ok) return [];
        const rawHtml = await resp.text();

        const items = [];
        const seen = new Set();

        const regex = /<a(?=[^>]*\bhref="(https?:\/\/animefire\.io\/animes\/[^\"]+)")[^>]*>([\s\S]*?)<\/a>/g;
        let m;

        while ((m = regex.exec(rawHtml)) !== null) {
            const fullUrl = m[1];
            const cardHtml = m[2];

            const titleMatch = cardHtml.match(/animeTitle[^>]*>\s*([^<]+)</);
            if (!titleMatch) continue;

            const urlObj = new URL(fullUrl);
            const rawSlug = urlObj.pathname.split('/')[2]; // Pega o que vem depois de /animes/
            
            if (!rawSlug) continue;
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            const displayTitle = titleMatch[1].trim();
            const isDubbed = rawSlug.toLowerCase().includes('dublado');
            
            // Flexibiliza o rootSlug, pois nem sempre tem "-todos-os-episodios"
            let rootSlug = rawSlug;
            if (rawSlug.toLowerCase().includes('-todos-os-episodios')) {
                rootSlug = rawSlug.replace(/-todos-os-episodios$/i, '');
            }

            let season = detectSeason(rootSlug);

            items.push({ rootSlug, isDubbed, displayTitle, season });
        }
        return items;
    } catch {
        return [];
    }
}

function detectSeason(slug) {
    const s = slug.toLowerCase();

    let m = s.match(/(?:^|[-])season[-](\d+)$/);
    if (m) return parseInt(m[1]);

    m = s.match(/(\d+)(?:st|nd|rd|th)\s*-season|season[-](\d+)/);
    if (m) return parseInt(m[1] || m[2]);

    m = s.match(/-s(\d+)$/);
    if (m) return parseInt(m[1]);

    m = s.match(/-(\d+)$/);
    if (m) {
        const n = parseInt(m[1]);
        if (n > 0 && n < 50) return n;
    }

    return 1;
}

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
                    title: audioLabel,
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

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function normalizeSlug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

    if (!anilistResp.ok) return [{ name: searchTitle }];
    const anilistData = await anilistResp.json();
    const media = anilistData?.data?.Media;

    const titles = [];

    if (media?.title?.romaji) titles.push({ name: media.title.romaji });
    if (media?.title?.english) titles.push({ name: media.title.english });

    if (media?.synonyms) {
        for (const syn of media.synonyms) {
            if (syn.length < 4) continue;
            if (!titles.some(t => t.name.toLowerCase() === syn.toLowerCase())) {
                titles.push({ name: syn });
            }
        }
    }

    if (titles.length === 0) titles.push({ name: searchTitle });

    return titles;
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

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;
    
    let absoluteEpisode = null;

    // NOVO: Busca o número absoluto do episódio no TMDB (Essencial para One Piece, Naruto, etc)
    if (mediaType === 'tv') {
        try {
            const epUrl = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${targetSeason}/episode/${targetEpisode}?api_key=${TMDB_API_KEY}`;
            const epResp = await fetch(epUrl);
            if (epResp.ok) {
                const epData = await epResp.json();
                if (epData.absolute_episode_number) {
                    absoluteEpisode = epData.absolute_episode_number;
                }
            }
        } catch (e) {
            console.error("Erro ao buscar episódio absoluto:", e);
        }
    }

    try {
        // Cache Inteligente: Lembra se o anime usou numeração absoluta ou relativa no episódio anterior
        if (slugCache.has(tmdbId)) {
            const cachedItems = slugCache.get(tmdbId);
            const allStreams = [];
            for (const item of cachedItems) {
                const epToRequest = (item.useAbsolute && absoluteEpisode) ? absoluteEpisode : targetEpisode;
                const streams = await extractVideoStreams(item.rootSlug, epToRequest, item.isDubbed);
                allStreams.push(...streams);
            }
            if (allStreams.length > 0) return allStreams.sort((a, b) => b.quality - a.quality);
        }

        const titles = await getAniListTitles(tmdbId, mediaType);
        if (!titles.length) return [];

        const allStreams = [];
        const triedSlugs = new Set();
        const successfulItems = [];

        // Monta as opções de episódios para tentar no AnimeFire
        const episodesToTry = [targetEpisode];
        if (absoluteEpisode && absoluteEpisode !== targetEpisode) {
            episodesToTry.push(absoluteEpisode); // Adiciona o número absoluto como prioridade/opção
        }

        for (const titleInfo of titles) {
            const animeLinks = await searchAnimeFire(titleInfo.name);
            if (!animeLinks.length) continue;

            const normalizedSearch = normalizeSlug(titleInfo.name);
            const titleWords = titleToSlug(titleInfo.name).split('-').filter(w => w.length > 2);

            const validLinks = animeLinks.filter(item => {
                const slug = normalizeSlug(item.rootSlug);
                if (slug.includes(normalizedSearch)) return true;
                const matchesCount = titleWords.filter(word => slug.includes(word)).length;
                return matchesCount >= Math.min(2, titleWords.length);
            });

            // Separa links correspondentes à temporada exata e links genéricos (temporada 1/única)
            let seasonMatches = validLinks.filter(item => item.season === targetSeason);
            let baseMatches = validLinks.filter(item => item.season === 1 || !item.season);

            let linksToTest = [...seasonMatches];
            if (absoluteEpisode) linksToTest.push(...baseMatches);
            if (linksToTest.length === 0) linksToTest = validLinks;
            
            // Remove duplicatas
            linksToTest = [...new Map(linksToTest.map(item => [item.rootSlug, item])).values()];

            for (const item of linksToTest) {
                if (triedSlugs.has(item.rootSlug)) continue;
                triedSlugs.add(item.rootSlug);

                // Testa tanto o episódio da temporada quanto o absoluto
                for (const epNum of episodesToTry) {
                    const streams = await extractVideoStreams(item.rootSlug, epNum, item.isDubbed);
                    if (streams.length > 0) {
                        successfulItems.push({ 
                            rootSlug: item.rootSlug, 
                            isDubbed: item.isDubbed,
                            useAbsolute: epNum === absoluteEpisode 
                        });
                        allStreams.push(...streams);
                        break; // Se encontrou com uma numeração, não tenta a outra para esse link
                    }
                }
            }

            if (allStreams.length > 0) {
                slugCache.set(tmdbId, successfulItems);
                break;
            }
        }

        return allStreams.sort((a, b) => b.quality - a.quality);
    } catch {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    globalThis.getStreams = getStreams;
}
