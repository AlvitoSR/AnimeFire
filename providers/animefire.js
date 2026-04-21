const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANIMEFIRE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
};

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function getTMDBInfo(tmdbId) {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR&append_to_response=alternative_titles`;
    try {
        const response = await fetch(url);
        return await response.json();
    } catch { return null; }
}

async function getRealSlug(info) {
    const searchQueries = [
        info.name,
        info.original_name,
        ...(info.alternative_titles?.results?.map(t => t.title) || [])
    ].filter(Boolean);

    for (const query of searchQueries) {
        try {
            const cleanQuery = query.split(/[:(-]/)[0].trim();
            const searchUrl = `${ANIMEFIRE_URL}/pesquisar/${titleToSlug(cleanQuery)}`;
            const response = await fetch(searchUrl, { headers: HEADERS });
            const html = await response.text();
            const match = html.match(/<a href="https:\/\/animefire\.io\/animes\/([^"\/]+)"/);
            if (match && match[1]) return match[1];
        } catch (e) { continue; }
    }
    return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [];

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const realSlug = await getRealSlug(info);
        const slugsToTry = new Set();
        
        if (realSlug) slugsToTry.add(realSlug);
        slugsToTry.add(titleToSlug(info.name));
        if (info.original_name) slugsToTry.add(titleToSlug(info.original_name));

        for (const baseSlug of slugsToTry) {
            // Variações específicas para encontrar Attack on Titan S2 e outros
            const variations = [
                baseSlug,
                `${baseSlug}-season-${season}`, // Caso específico: shingeki-no-kyojin-season-2
                `${baseSlug}-${season}-temporada`,
                `${baseSlug}-${season}`,
                `${baseSlug}-dublado`,
                `${baseSlug}-season-${season}-dublado`
            ];

            for (const slug of variations) {
                const pageUrl = `${ANIMEFIRE_URL}/animes/${slug}/${episode}`;
                
                try {
                    const response = await fetch(pageUrl, { 
                        headers: { ...HEADERS, 'Referer': ANIMEFIRE_URL } 
                    });

                    if (!response.ok) continue;
                    const html = await response.text();

                    const videoSrcMatch = html.match(/data-video-src="([^"]+)"/);
                    if (!videoSrcMatch) continue;

                    let apiUrl = videoSrcMatch[1];
                    if (apiUrl.startsWith('/')) apiUrl = ANIMEFIRE_URL + apiUrl;

                    const apiRes = await fetch(apiUrl, { 
                        headers: { ...HEADERS, 'Referer': pageUrl, 'X-Requested-With': 'XMLHttpRequest' } 
                    });
                    
                    if (!apiRes.ok) continue;
                    const apiData = await apiRes.json();

                    if (apiData && apiData.data) {
                        return apiData.data.map(item => ({
                            url: item.src,
                            name: `AnimeFire ${item.label || 'FHD'}`,
                            quality: item.label.includes('1080') ? 1080 : 720,
                            type: item.src.includes('m3u8') ? 'hls' : 'mp4',
                            headers: {
                                'User-Agent': HEADERS['User-Agent'],
                                'Referer': 'https://animefire.io/',
                                'Origin': 'https://animefire.io',
                                'Accept': '*/*',
                                'Connection': 'keep-alive'
                            }
                        })).sort((a, b) => b.quality - a.quality);
                    }
                } catch (e) { continue; }
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
