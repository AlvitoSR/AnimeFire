const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANIMEFIRE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
};

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function getTMDBInfo(tmdbId) {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`;
    try {
        const response = await fetch(url);
        return await response.json();
    } catch { return null; }
}

// Tenta encontrar o slug real fazendo uma pesquisa no site (Lógica extraída do Cloudstream)
async function searchAnimeSlug(query) {
    try {
        const searchUrl = `${ANIMEFIRE_URL}/pesquisar/${titleToSlug(query)}`;
        const response = await fetch(searchUrl, { headers: HEADERS });
        const html = await response.text();
        
        // Regex para capturar o primeiro link de anime da lista de busca
        const match = html.match(/href="https:\/\/animefire\.io\/animes\/([^"\/]+)"/);
        return match ? match[1] : null;
    } catch { return null; }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [];

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const slugsToTry = new Set();
        
        // 1. Tenta nomes baseados no TMDB
        slugsToTry.add(titleToSlug(info.name));
        if (info.original_name) slugsToTry.add(titleToSlug(info.original_name));

        // 2. BUSCA DE EMERGÊNCIA: Pesquisa o nome real no site para garantir
        const searchResult = await searchAnimeSlug(info.name);
        if (searchResult) slugsToTry.add(searchResult);

        for (const baseSlug of slugsToTry) {
            // Gera variações de temporada para cada slug
            const variations = [
                baseSlug,
                `${baseSlug}-dublado`,
                `${baseSlug}-${season}-temporada`,
                `${baseSlug}-${season}-temporada-dublado`,
                `${baseSlug}-season-${season}`
            ];

            for (const slug of variations) {
                const pageUrl = `${ANIMEFIRE_URL}/animes/${slug}/${episode}`;
                const response = await fetch(pageUrl, { headers: { ...HEADERS, 'Referer': ANIMEFIRE_URL } });

                if (!response.ok) continue;
                const html = await response.text();

                const videoSrcMatch = html.match(/data-video-src="([^"]+)"/);
                if (!videoSrcMatch) continue;

                let apiUrl = videoSrcMatch[1];
                if (apiUrl.startsWith('/')) apiUrl = ANIMEFIRE_URL + apiUrl;

                const apiRes = await fetch(apiUrl, { headers: { ...HEADERS, 'Referer': pageUrl } });
                if (!apiRes.ok) continue;

                const apiData = await apiRes.json();
                if (apiData && apiData.data) {
                    return apiData.data.map(item => ({
                        url: item.src,
                        name: `AnimeFire ${item.label || '720p'}`,
                        quality: item.label.includes('1080') ? 1080 : item.label.includes('480') ? 480 : 720,
                        type: item.src.includes('m3u8') ? 'hls' : 'mp4',
                        headers: {
                            'User-Agent': HEADERS['User-Agent'],
                            'Referer': pageUrl
                        }
                    })).sort((a, b) => b.quality - a.quality);
                }
            }
        }
    } catch (e) { console.error(e); }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
