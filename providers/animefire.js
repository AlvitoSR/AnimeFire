const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3'; // Chave TMDB
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANIMEFIRE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://animefire.io/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
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
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    // O AnimeFire foca apenas em séries/animes, não em filmes soltos de Hollywood
    if (mediaType !== 'tv') return []; 

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const slug = titleToSlug(info.name);
        
        // 1. Construir o link da página do episódio no AnimeFire
        const pageUrl = `${ANIMEFIRE_URL}/video/${slug}/${episode}`;

        // 2. Aceder à página do anime para extrair a API do player
        const response = await fetch(pageUrl, { headers: HEADERS });
        if (!response.ok) return [];
        
        const html = await response.text();

        // 3. Procurar o atributo data-video-src no HTML com Regex
        const videoSrcMatch = html.match(/data-video-src="([^"]+)"/);
        if (!videoSrcMatch) return [];

        let videoApiUrl = videoSrcMatch[1];
        
        // Se o link for relativo (ex: /api/video/...), adicionamos o domínio principal
        if (videoApiUrl.startsWith('/')) {
            videoApiUrl = `${ANIMEFIRE_URL}${videoApiUrl}`;
        }

        // 4. Fazer requisição à API interna do AnimeFire para obter os links MP4 reais
        const apiResponse = await fetch(videoApiUrl, { headers: HEADERS });
        if (!apiResponse.ok) return [];

        const videoData = await apiResponse.json();
        
        const streams = [];
        // A API costuma retornar as qualidades num array dentro de "data"
        const sources = videoData.data || [];

        for (const source of sources) {
            if (source.src) {
                // Tenta adivinhar a qualidade pelo nome do link ou da label
                let quality = 720;
                const srcString = source.src.toLowerCase();
                const labelString = (source.label || '').toLowerCase();

                if (srcString.includes('1080') || labelString.includes('1080')) quality = 1080;
                else if (srcString.includes('720') || labelString.includes('720')) quality = 720;
                else if (srcString.includes('480') || labelString.includes('480')) quality = 480;
                else if (srcString.includes('360') || labelString.includes('360')) quality = 360;

                streams.push({
                    url: source.src, // Aqui entra o link final em MP4!
                    name: `AnimeFire ${quality}p`,
                    title: `${info.name} - Ep ${episode}`,
                    quality: quality,
                    type: source.src.includes('.m3u8') ? 'hls' : 'mp4',
                    headers: HEADERS
                });
            }
        }

        // Organiza a lista do Nuvio para colocar os 1080p e 720p no topo
        return streams.sort((a, b) => b.quality - a.quality);

    } catch (error) {
        console.error("Erro no provider AnimeFire:", error);
        return [];
    }
}

// Exportação compatível com o sistema do Nuvio
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
