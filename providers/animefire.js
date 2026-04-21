const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3'; // Chave TMDB
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANIMEFIRE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${ANIMEFIRE_URL}/`,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

// Gera várias tentativas de URL para driblar a diferença de nomes entre TMDB e AnimeFire
function generateSlugVariations(info, season) {
    const titlesToTry = [info.name];
    // Adiciona o nome original (japonês romanizado) pois o AnimeFire costuma usar
    if (info.original_name) titlesToTry.push(info.original_name);

    const slugs = new Set();

    titlesToTry.forEach(t => {
        const baseSlug = titleToSlug(t);
        slugs.add(baseSlug);
        slugs.add(`${baseSlug}-dublado`);

        if (season > 1) {
            slugs.add(`${baseSlug}-${season}-temporada`);
            slugs.add(`${baseSlug}-${season}-temporada-dublado`);
            slugs.add(`${baseSlug}-season-${season}`);
        }
    });

    return Array.from(slugs); // Retorna uma lista de possibilidades
}

async function getTMDBInfo(tmdbId) {
    const url = `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=pt-BR`;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return []; 

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const slugVariations = generateSlugVariations(info, season);
        let videoApiUrl = null;

        // Tenta encontrar a página do episódio varrendo os slugs possíveis
        for (const slug of slugVariations) {
            // Caminho correto das páginas no AnimeFire
            const pageUrl = `${ANIMEFIRE_URL}/animes/${slug}/${episode}`;
            
            try {
                const response = await fetch(pageUrl, { headers: HEADERS });
                // Se a página não existir (404), vai para a próxima variação de nome
                if (!response.ok) continue;

                const html = await response.text();
                
                // Procura a gaveta secreta do player no código do site
                const videoSrcMatch = html.match(/data-video-src="([^"]+)"/);
                
                if (videoSrcMatch) {
                    videoApiUrl = videoSrcMatch[1];
                    break; // Achou o vídeo! Para a busca.
                }
            } catch (e) {
                continue;
            }
        }

        // Se testou todas as variações e não achou, retorna vazio
        if (!videoApiUrl) return [];

        // Previne caminhos relativos
        if (videoApiUrl.startsWith('/')) {
            videoApiUrl = `${ANIMEFIRE_URL}${videoApiUrl}`;
        }

        // Faz a requisição na API interna que retorna os links de vídeo cru
        const apiResponse = await fetch(videoApiUrl, { headers: HEADERS });
        if (!apiResponse.ok) return [];

        const videoData = await apiResponse.json();
        const streams = [];
        const sources = videoData.data || [];

        for (const source of sources) {
            if (source.src) {
                let quality = 720;
                const srcString = source.src.toLowerCase();
                const labelString = (source.label || '').toLowerCase();

                // Define a resolução da fonte
                if (srcString.includes('1080') || labelString.includes('1080')) quality = 1080;
                else if (srcString.includes('720') || labelString.includes('720')) quality = 720;
                else if (srcString.includes('480') || labelString.includes('480')) quality = 480;
                else if (srcString.includes('360') || labelString.includes('360')) quality = 360;

                streams.push({
                    url: source.src, 
                    name: `AnimeFire ${quality}p`,
                    title: `${info.name} - Ep ${episode}`,
                    quality: quality,
                    type: source.src.includes('.m3u8') ? 'hls' : 'mp4',
                    headers: HEADERS
                });
            }
        }

        // Ordem do Nuvio: as qualidades mais altas (1080p, 720p) no topo
        return streams.sort((a, b) => b.quality - a.quality);

    } catch (error) {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
