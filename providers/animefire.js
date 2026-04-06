const TMDB_API_KEY = 'b64d2f3a4212a99d64a7d4485faed7b3';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const BASE_URL = 'https://animefire.io';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': BASE_URL,
    'Accept-Language': 'pt-BR,pt;q=0.9'
};

// ─── Lista de proxies CORS em cascata ────────────────────────────────────────

const CORS_PROXIES = [
    // codetabs é o único que funciona (confirmado por teste real)
    {
        name: 'codetabs',
        build: (url) => `https://api.codetabs.com/v1/proxy/?quest=${url.includes('?') ? encodeURIComponent(url) : encodeURIComponent(url)}`,
        parse: (resp) => resp
    },
    {
        name: 'allorigins',
        build: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        parse: async (resp) => {
            const json = await resp.json();
            if (!json.contents) throw new Error('No contents');
            return {
                ok: true,
                status: 200,
                text: () => Promise.resolve(json.contents),
                json: () => Promise.resolve(JSON.parse(json.contents))
            };
        }
    }
];

/**
 * Wrapper para fetch com proxy cascade (contorno Cloudflare).
 * Se a URL for do domínio animefire, tenta cada proxy em sequencia.
 * Caso contrario vai direto ao fetch original.
 */
async function proxyFetch(url, options = {}) {
    if (!url.includes('animefire.io') && !url.includes('animefire')) {
        return fetch(url, options);
    }

    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy.build(url);
            const resp = await fetch(proxyUrl, options);
            if (!resp.ok) continue;

            const text = await resp.text();
            // Pula se veio erro 522 / página de erro
            if (text.includes('error code') || text.includes('cf-') || text.includes('cloudflare')) {
                continue;
            }
            // codetabs às vezes retorna HTML de landing → pular
            if (proxy.name === 'codetabs' && text.length < 500 && !text.includes('data')) {
                continue;
            }

            return {
                ok: true,
                status: 200,
                text: () => Promise.resolve(text),
                json: () => Promise.resolve(JSON.parse(text))
            };
        } catch {
            continue;
        }
    }

    // Fallback final
    return fetch(url, options);
}

// Mesmo mapa de qualidade do extrator Kotlin original
const ITAG_QUALITY = {
    18: '360p',
    22: '720p',
    37: '1080p',
    59: '480p',
    43: '360p',
    44: '480p',
    45: '720p',
    46: '1080p'
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function titleToSlug(title) {
    if (!title) return '';
    return title.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function generateCpn() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function decodeUrl(url) {
    return url
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/')
        .replace(/\\&/g, '&')
        .replace(/\\=/g, '=')
        .replace(/\\\\/g, '\\')
        .replace(/^"|"$/g, '')
        .trim();
}

function qualityFromLabel(label) {
    if (label.includes('1080')) return '1080p';
    if (label.includes('720'))  return '720p';
    if (label.includes('480'))  return '480p';
    if (label.includes('360'))  return '360p';
    return '480p';
}

// ─── AniList: buscar titulo do anime (igual ao mywallpaper.js) ───────────────

async function getAniListTitles(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const tmdbUrl = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US`;

    const tmdbResponse = await fetch(tmdbUrl);
    if (!tmdbResponse.ok) return [];
    const tmdbData = await tmdbResponse.json();
    const searchTitle = mediaType === 'tv' ? tmdbData.name : tmdbData.title;

    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                title { romaji english }
                synonyms
            }
        }`;

    const anilistResponse = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: { search: searchTitle } })
    });

    if (!anilistResponse.ok) return [{ name: searchTitle, type: 'tmdb' }];
    const anilistData = await anilistResponse.json();
    const media = anilistData?.data?.Media;

    const titles = [];
    if (media?.title?.romaji) titles.push({ name: media.title.romaji, type: 'romaji' });
    if (media?.title?.english && media.title.english !== media.title.romaji) {
        titles.push({ name: media.title.english, type: 'english' });
    }
    // Fallback para titulo TMDB se AniList nao retornar nada
    if (titles.length === 0) titles.push({ name: searchTitle, type: 'tmdb' });

    return titles;
}

// ─── AnimeFire: buscar anime pelo titulo ─────────────────────────────────────

async function searchAnimeFire(title) {
    const slug = titleToSlug(title);
    const url = `${BASE_URL}/pesquisar/${slug}`;

    try {
        const response = await proxyFetch(url, { headers: HEADERS });
        if (!response.ok) return [];
        const html = await response.text();

        const links = [];
        const regex = /href="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^"?#]+)"/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
            // So pega a pagina principal do anime (exatamente 2 segmentos de path)
            const link = m[1].replace(/\/$/, '');
            const parts = link.replace(BASE_URL, '').split('/').filter(Boolean);
            if (parts.length === 2 && !links.includes(link)) {
                links.push(link);
            }
        }
        return links;
    } catch {
        return [];
    }
}

// ─── AnimeFire: pegar URL do episodio na pagina do anime ─────────────────────

async function getEpisodeUrl(animePageUrl, targetEpisode) {
    try {
        const response = await proxyFetch(animePageUrl, { headers: HEADERS });
        if (!response.ok) return null;
        const html = await response.text();

        const episodes = [];
        const regex = /href="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^"]+?\/(\d+)\/?)"[^>]*>/g;
        let m;
        while ((m = regex.exec(html)) !== null) {
            episodes.push({ url: m[1], num: parseInt(m[2]) });
        }

        if (episodes.length === 0) return null;

        const found = episodes.find(e => e.num === targetEpisode);
        return found ? found.url : episodes[0].url;
    } catch {
        return null;
    }
}

// ─── Extrator Lightspeed (API JSON do AnimeFire) ─────────────────────────────

async function extractLightspeedStreams(episodeUrl) {
    try {
        const path = episodeUrl
            .replace(`${BASE_URL}/animes/`, '')
            .replace(`${BASE_URL}/filmes/`, '');

        const parts = path.split('/');
        if (parts.length < 2) return [];

        const slug  = parts[0];
        const epNum = parts[1].replace(/\D/g, '') || '1';
        const timestamp = Math.floor(Date.now() / 1000);
        const xhrUrl = `${BASE_URL}/video/${slug}/${epNum}?tempsubs=0&${timestamp}`;

        const response = await proxyFetch(xhrUrl, {
            headers: { ...HEADERS, 'X-Requested-With': 'XMLHttpRequest' }
        });

        if (!response.ok) return [];
        const json = await response.json();
        const data = json.data || [];

        return data
            .filter(item => item.src)
            .map(item => {
                const qualLabel = qualityFromLabel(item.label || '');
                return {
                    url: item.src,
                    name: 'AnimeFire',
                    title: `${qualLabel} • Legendado`,
                    quality: parseInt((item.label || '480').match(/\d+/)?.[0] || '480'),
                    type: 'hls',
                    headers: { 'Referer': episodeUrl, ...HEADERS }
                };
            });
    } catch {
        return [];
    }
}

// ─── Extrator Blogger ─────────────────────────────────────────────────────────

function extractBloggerToken(html) {
    const m = html.match(/blogger\.com\/video\.g[^"']*token=([a-zA-Z0-9_\-]+)/);
    return m ? m[1] : null;
}

function extractWizData(html) {
    const wizData = {};
    const m = html.match(/window\.WIZ_global_data\s*=\s*\{([^}]+)\}/);
    if (!m) return wizData;
    const s = m[1];

    for (const key of ['FdrFJe', 'cfb2h', 'UUFaWc', 'hsFLT']) {
        const km = s.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
        if (km) wizData[key] = km[1];
    }
    return wizData;
}

async function callBloggerBatch(token, wizData) {
    const fSid  = wizData['FdrFJe'] || '-7535563745894756252';
    const bl    = wizData['cfb2h']  || 'boq_bloggeruiserver_20260223.02_p0';
    const reqid = Math.floor(Math.random() * 90000) + 10000;

    const apiUrl = `https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute` +
        `?rpcids=WcwnYd&source-path=%2Fvideo.g` +
        `&f.sid=${encodeURIComponent(fSid)}` +
        `&bl=${encodeURIComponent(bl)}` +
        `&hl=pt-BR&_reqid=${reqid}&rt=c`;

    const body = `f.req=${encodeURIComponent(`[[["WcwnYd","[\\"${token}\\",\\"\\",0]",null,"generic"]]]`)}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'Origin': 'https://www.blogger.com',
                'Referer': 'https://www.blogger.com/',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
                'x-same-domain': '1'
            },
            body
        });

        const text = await response.text();
        const streams = [];
        const clean = text.replace(/^\)\]}'[\s\n]*/, '');

        let inner = clean;
        const pm = clean.match(/"wrb\.fr"\s*,\s*"[^"]*"\s*,\s*"([\s\S]+?)"\s*\]/);
        if (pm) {
            inner = pm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }

        const urlRegex = /"((?:https?:\\?\/\\?\/)?[^"]+?googlevideo[^"]+?)"\s*,\s*\[(\d+)\]/g;
        const seen = new Set();
        let um;

        while ((um = urlRegex.exec(inner)) !== null) {
            const rawUrl = decodeUrl(um[1]);
            const itag   = parseInt(um[2]);
            const qualityLabel = ITAG_QUALITY[itag] || '360p';

            if (!seen.has(itag)) {
                seen.add(itag);
                const cpn = generateCpn();
                const sep = rawUrl.includes('?') ? '&' : '?';
                const finalUrl = `${rawUrl}${sep}cpn=${cpn}&c=WEB_EMBEDDED_PLAYER&cver=1.20260224.08.00`;

                streams.push({
                    url: finalUrl,
                    name: 'AnimeFire',
                    title: `${qualityLabel} • Legendado`,
                    quality: parseInt(qualityLabel),
                    type: 'mp4',
                    headers: {
                        'Referer': 'https://youtube.googleapis.com/',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                        'Range': 'bytes=0-'
                    }
                });
            }
        }

        return streams;
    } catch {
        return [];
    }
}

async function extractBloggerStreams(episodePageHtml, episodeUrl) {
    const token = extractBloggerToken(episodePageHtml);
    if (!token) return [];

    try {
        const bloggerResponse = await fetch(`https://www.blogger.com/video.g?token=${token}`, {
            headers: {
                'Referer': episodeUrl,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                'sec-ch-ua-mobile': '?1'
            }
        });

        if (!bloggerResponse.ok) return [];
        const bloggerHtml = await bloggerResponse.text();
        const wizData = extractWizData(bloggerHtml);
        return await callBloggerBatch(token, wizData);
    } catch {
        return [];
    }
}

// ─── Extrai streams de um episodio (decide Lightspeed vs Blogger) ─────────────

async function extractStreamsFromEpisode(episodeUrl) {
    try {
        const response = await proxyFetch(episodeUrl, { headers: HEADERS });
        if (!response.ok) return [];
        const html = await response.text();

        const hasBlogger = html.includes('blogger.com/video.g');
        return hasBlogger
            ? await extractBloggerStreams(html, episodeUrl)
            : await extractLightspeedStreams(episodeUrl);
    } catch {
        return [];
    }
}

// ─── getStreams: ponto de entrada principal ───────────────────────────────────

async function getStreams(tmdbId, mediaType, season, episode) {
    const targetSeason  = mediaType === 'movie' ? 1 : season;
    const targetEpisode = mediaType === 'movie' ? 1 : episode;

    try {
        const titles = await getAniListTitles(tmdbId, mediaType);
        if (!titles.length) return [];

        for (const titleInfo of titles) {
            const animeLinks = await searchAnimeFire(titleInfo.name);
            if (!animeLinks.length) continue;

            const animePageUrl = animeLinks[0];

            if (mediaType === 'movie') {
                let streams = await extractStreamsFromEpisode(`${animePageUrl}/1`);
                if (!streams.length) streams = await extractStreamsFromEpisode(animePageUrl);
                if (streams.length) return streams.sort((a, b) => b.quality - a.quality);
                continue;
            }

            const episodeUrl = await getEpisodeUrl(animePageUrl, targetEpisode);
            if (!episodeUrl) continue;

            const streams = await extractStreamsFromEpisode(episodeUrl);
            if (streams.length) return streams.sort((a, b) => b.quality - a.quality);
        }

        return [];
    } catch {
        return [];
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
