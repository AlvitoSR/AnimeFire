const BASE_URL = "https://animesonlinecc.to";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Referer": BASE_URL
};

async function fetchHTML(url) {
    try {
        const res = await fetch(url, { headers: HEADERS });
        return await res.text();
    } catch (e) {
        return "";
    }
}

function cleanTitle(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9]/gi, "")
        .trim();
}

function extractSearch(html) {
    const regex = /<a href="([^"]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[^>]*>.*?<div class="tt">([^<]+)<\/div>/gs;

    let results = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
        results.push({
            title: match[3].trim(),
            url: match[1],
            image: match[2]
        });
    }

    return results;
}

function extractEpisodes(html) {
    const regex = /<li[^>]*>\s*<a href="([^"]+)".*?>(.*?)<\/a>/g;

    let episodes = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
        episodes.push({
            url: match[1],
            title: match[2].trim()
        });
    }

    return episodes.reverse(); // ordem correta
}

function extractIframes(html) {
    const regex = /<iframe[^>]+src="([^"]+)"/g;

    let sources = [];
    let match;

    while ((match = regex.exec(html)) !== null) {
        let url = match[1];

        // limpa urls inválidas
        if (!url || url.includes("facebook") || url.includes("ads")) continue;

        sources.push({
            url,
            type: "embed"
        });
    }

    return sources;
}

async function searchAnime(query) {
    const html = await fetchHTML(`${BASE_URL}/?s=${encodeURIComponent(query)}`);
    return extractSearch(html);
}

function pickBestMatch(results, title) {
    const cleanQuery = cleanTitle(title);

    return results.find(r => cleanTitle(r.title).includes(cleanQuery)) || results[0];
}

function pickEpisode(episodes, episodeNumber) {
    if (!episodeNumber) return episodes[0];

    const ep = episodes.find(e =>
        e.title.includes(episodeNumber) ||
        e.title.includes(`Episódio ${episodeNumber}`) ||
        e.title.includes(`EP ${episodeNumber}`)
    );

    return ep || episodes[0];
}

async function getEpisodeSources(epUrl) {
    const html = await fetchHTML(epUrl);
    let sources = extractIframes(html);

    // fallback: tenta pegar player alternativo
    if (!sources.length) {
        const alt = html.match(/data-player="([^"]+)"/);
        if (alt) {
            sources.push({
                url: alt[1],
                type: "embed"
            });
        }
    }

    return sources;
}

export default {
    name: "AnimesOnlineCC",
    version: "2.0.0",
    supports: ["anime"],

    async sources(data) {
        /**
         * data esperado:
         * {
         *   title: "Naruto",
         *   episode: 1
         * }
         */

        if (!data?.title) return [];

        // 🔎 busca
        const results = await searchAnime(data.title);
        if (!results.length) return [];

        // 🎯 escolhe melhor match
        const anime = pickBestMatch(results, data.title);
        if (!anime?.url) return [];

        // 📺 pega episódios
        const html = await fetchHTML(anime.url);
        const episodes = extractEpisodes(html);
        if (!episodes.length) return [];

        // 🎬 escolhe episódio correto
        const ep = pickEpisode(episodes, data.episode);
        if (!ep?.url) return [];

        // ▶️ extrai fontes
        let sources = await getEpisodeSources(ep.url);

        // 🚀 organização final
        return sources.map((s, i) => ({
            name: `Server ${i + 1}`,
            url: s.url,
            type: "embed",
            quality: "auto"
        }));
    }
};
