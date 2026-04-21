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

// NOVA FUNÇÃO: Gera slugs baseada no nome PT-BR, Inglês e Japonês (Romanizado)
function generateSlugVariations(info, season) {
    const names = new Set();
    
    if (info.name) names.add(info.name); // Nome em PT-BR ou Inglês
    if (info.original_name) names.add(info.original_name); // Nome original (Japonês)
    
    const slugs = new Set();
    names.forEach(name => {
        const base = titleToSlug(name);
        if (!base) return;

        // Variações padrão
        slugs.add(base);
        slugs.add(`${base}-dublado`);

        // Variações de Temporada (O AnimeFire usa muito o sufixo "-2", "-3" ou "-temporada")
        if (season > 1) {
            slugs.add(`${base}-${season}`);
            slugs.add(`${base}-${season}-temporada`);
            slugs.add(`${base}-${season}-temporada-dublado`);
            slugs.add(`${base}-season-${season}`);
        }
    });

    return Array.from(slugs);
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [];

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const variations = generateSlugVariations(info, season);
        
        // Tenta cada variação de nome até encontrar uma página válida
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
                    headers: { ...HEADERS, 'Referer': pageUrl } 
                });

                if (!apiRes.ok) continue;
                const apiData = await apiRes.json();

                if (apiData && apiData.data) {
                    return apiData.data.map(item => {
                        let quality = 720;
                        if (item.label.includes('1080')) quality = 1080;
                        else if (item.label.includes('480')) quality = 480;
                        else if (item.label.includes('360')) quality = 360;

                        return {
                            url: item.src,
                            name: `AnimeFire ${item.label || quality + 'p'}`,
                            quality: quality,
                            type: item.src.includes('m3u8') ? 'hls' : 'mp4',
                            headers: {
                                'User-Agent': HEADERS['User-Agent'],
                                'Referer': pageUrl
                            }
                        };
                    }).sort((a, b) => b.quality - a.quality);
                }
            } catch (err) {
                continue;
            }
        }
    } catch (e) {
        console.error(e);
    }
    return [];
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
