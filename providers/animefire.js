const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3'; // Chave encontrada nos exemplos
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANIMEFIRE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://animefire.io/'
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
    } catch {
        return null;
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return []; // AnimeFire foca em séries/animes

    try {
        const info = await getTMDBInfo(tmdbId);
        if (!info) return [];

        const slug = titleToSlug(info.name);
        // O AnimeFire costuma usar o formato: /animes/nome-do-anime/numero-do-episodio
        const streamUrl = `${ANIMEFIRE_URL}/video/${slug}/${episode}`;

        // Nota: O AnimeFire usa proteção e carregamento dinâmico via API interna.
        // Este código é uma base estrutural. Para extrair o vídeo real, 
        // seria necessário fazer o fetch da página e buscar o 'data-video-src'.

        const streams = [];
        
        // Exemplo de como o objeto de retorno deve ser estruturado para o Nuvio:
        streams.push({
            url: streamUrl, // Aqui entraria o link direto extraído do player
            name: "AnimeFire HD",
            title: `${info.name} - Ep ${episode}`,
            quality: 720,
            type: 'hls', // ou 'mp4' dependendo da fonte
            headers: HEADERS
        });

        return streams;
    } catch (error) {
        console.error("Erro no AnimeFire:", error);
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
