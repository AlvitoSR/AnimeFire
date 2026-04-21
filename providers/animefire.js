const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const SITE_URL = 'https://animesonlinecc.to';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': SITE_URL
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

// Nova função que pesquisa no site para achar o link correto
async function findAnimePath(query) {
    try {
        const searchUrl = `${SITE_URL}/search/${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, { headers: HEADERS });
        const html = await response.text();
        
        // Procura o link do anime nos resultados (ex: /anime/shingeki-no-kyojin)
        const match = html.match(/href="(https:\/\/animesonlinecc\.to\/anime\/[^"]+)"/);
        if (match) {
            return match[1].replace('/anime/', '/episodio/');
        }
    } catch (e) { return null; }
    return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [];

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const pathsToTry = new Set();
        
        // 1. Tenta a pesquisa real pelo nome
        const searchedPath = await findAnimePath(info.name);
        if (searchedPath) pathsToTry.add(searchedPath);

        // 2. Tenta os slugs básicos (Fallback)
        const baseSlug = titleToSlug(info.name);
        pathsToTry.add(`${SITE_URL}/episodio/${baseSlug}`);

        for (const basePath of pathsToTry) {
            // Ajusta o formato do episódio e temporada
            const variations = [
                `${basePath}-temporada-${season}-episodio-${episode}`,
                `${basePath}-episodio-${episode}`
            ];

            for (const url of variations) {
                const response = await fetch(url, { headers: HEADERS });
                if (!response.ok) continue;

                const html = await response.text();

                // Procura o link do Google/Blogger ou m3u8
                const videoMatch = html.match(/"file":"(https:\/\/[^"]+)"/) || 
                                   html.match(/<source src="([^"]+)"/);

                if (videoMatch) {
                    let videoUrl = videoMatch[1].replace(/\\/g, '');
                    
                    return [{
                        url: videoUrl,
                        name: "AnimesOnline",
                        quality: 720,
                        type: videoUrl.includes('m3u8') ? "hls" : "mp4",
                        headers: {
                            'User-Agent': HEADERS['User-Agent'],
                            'Referer': url
                        }
                    }];
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
