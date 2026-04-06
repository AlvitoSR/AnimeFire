/**
 * AnimeFire - Nuvio Provider
 * Site: https://animefire.io
 * Linguagem: pt-BR | Tipo: Anime / Filmes
 *
 * CONFIGURAÇÃO:
 *   Substitua TMDB_API_KEY pela sua chave gratuita em https://www.themoviedb.org/settings/api
 */

var TMDB_API_KEY = "c6c6f4c1cb446e0d5c305f3fa7eeb4a9"; // <- Substitua aqui
var BASE_URL = "https://animefire.io";

var ITAG_QUALITY = {
  18: "360p",
  22: "720p",
  37: "1080p",
  59: "480p",
  43: "360p",
  44: "480p",
  45: "720p",
  46: "1080p"
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function decodeUrl(url) {
  return url
    .replace(/\\u([0-9a-fA-F]{4})/g, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/\\\//g, "/")
    .replace(/\\&/g, "&")
    .replace(/\\=/g, "=")
    .replace(/\\\\/g, "\\")
    .replace(/^"|"$/g, "")
    .trim();
}

function extractItagFromUrl(url) {
  var m = url.match(/itag[=?&](\d+)/) || url.match(/itag%3D(\d+)/);
  return m ? parseInt(m[1]) : 18;
}

function qualityFromLabel(label) {
  if (label.indexOf("1080") !== -1) return "1080p";
  if (label.indexOf("720") !== -1)  return "720p";
  if (label.indexOf("480") !== -1)  return "480p";
  if (label.indexOf("360") !== -1)  return "360p";
  if (label.indexOf("240") !== -1)  return "240p";
  return "480p";
}

function generateCpn() {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var result = "";
  for (var i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ─── 1. TMDB: pegar título do anime ─────────────────────────────────────────

function getTitleFromTMDB(tmdbId, mediaType) {
  var type = mediaType === "movie" ? "movie" : "tv";
  var url = "https://api.themoviedb.org/3/" + type + "/" + tmdbId +
            "?api_key=" + TMDB_API_KEY + "&language=pt-BR";

  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      return data.title || data.name || null;
    });
}

// ─── 2. Buscar anime no AnimeFire ───────────────────────────────────────────

function searchAnimeFire(title) {
  var query = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  var url = BASE_URL + "/pesquisar/" + query;

  return fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL,
      "Accept-Language": "pt-BR,pt;q=0.9"
    }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var links = [];
    var regex = /href="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^"]+)"/g;
    var m;
    while ((m = regex.exec(html)) !== null) {
      var link = m[1].split("?")[0];
      if (links.indexOf(link) === -1) links.push(link);
    }
    return links;
  });
}

// ─── 3. Pegar URL do episódio na página do anime ────────────────────────────

function getEpisodeUrl(animePageUrl, targetEpisode) {
  return fetch(animePageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL
    }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // Coleta todos os links de episódio
    var regex = /href="(https?:\/\/animefire\.io\/(?:animes|filmes)\/[^"]+\/(\d+)[^"]*)"/g;
    var episodes = [];
    var m;
    while ((m = regex.exec(html)) !== null) {
      episodes.push({ url: m[1], num: parseInt(m[2]) });
    }

    if (episodes.length === 0) return null;

    // Procura o episódio alvo
    var found = null;
    for (var i = 0; i < episodes.length; i++) {
      if (episodes[i].num === targetEpisode) {
        found = episodes[i].url;
        break;
      }
    }

    // Fallback: primeiro episódio se for filme (ep 1)
    if (!found && episodes.length > 0) {
      found = episodes[0].url;
    }

    return found;
  });
}

// ─── 4a. Extrator Lightspeed (API JSON) ─────────────────────────────────────

function extractLightspeedStreams(episodeUrl) {
  var parts = episodeUrl
    .replace("https://animefire.io/animes/", "")
    .replace("https://animefire.io/filmes/", "")
    .split("/");

  if (parts.length < 2) return Promise.resolve([]);

  var slug = parts[0];
  var epNum = parts[1].replace(/[^0-9]/g, "") || "1";
  var timestamp = Math.floor(Date.now() / 1000);
  var xhrUrl = BASE_URL + "/video/" + slug + "/" + epNum + "?tempsubs=0&" + timestamp;

  return fetch(xhrUrl, {
    headers: {
      "Referer": episodeUrl,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    var streams = [];
    var data = json.data || [];

    data.forEach(function(item) {
      if (!item.src) return;
      var quality = qualityFromLabel(item.label || "");

      streams.push({
        name: "AnimeFire",
        title: quality + " • AnimeFire [Lightspeed]",
        url: item.src,
        quality: quality,
        headers: {
          "Referer": episodeUrl,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
    });

    return streams;
  })
  .catch(function() { return []; });
}

// ─── 4b. Extrator Blogger ────────────────────────────────────────────────────

function extractBloggerToken(html) {
  var m = html.match(/blogger\.com\/video\.g[^"']*token=([a-zA-Z0-9_\-]+)/);
  return m ? m[1] : null;
}

function extractWizData(html) {
  var wizData = {};
  var m = html.match(/window\.WIZ_global_data\s*=\s*\{([^}]+)\}/);
  if (!m) return wizData;
  var s = m[1];

  ["FdrFJe", "cfb2h", "UUFaWc", "hsFLT"].forEach(function(key) {
    var km = s.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
    if (km) wizData[key] = km[1];
  });

  return wizData;
}

function callBloggerBatch(token, wizData) {
  var fSid   = wizData["FdrFJe"] || "-7535563745894756252";
  var bl     = wizData["cfb2h"]  || "boq_bloggeruiserver_20260223.02_p0";
  var reqid  = Math.floor(Math.random() * 90000) + 10000;

  var apiUrl = "https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute" +
    "?rpcids=WcwnYd&source-path=%2Fvideo.g" +
    "&f.sid=" + encodeURIComponent(fSid) +
    "&bl=" + encodeURIComponent(bl) +
    "&hl=pt-BR&_reqid=" + reqid + "&rt=c";

  var body = "f.req=" + encodeURIComponent(
    '[[[\"WcwnYd\",\"[\\"' + token + '\\",\\"\\",0]\",null,\"generic\"]]]'
  );

  return fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Origin": "https://www.blogger.com",
      "Referer": "https://www.blogger.com/",
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36",
      "x-same-domain": "1"
    },
    body: body
  })
  .then(function(r) { return r.text(); })
  .then(function(text) {
    var streams = [];

    // Limpa prefixo do Google
    var clean = text.replace(/^\)\]}'[\s\n]*/, "");

    // Extrai JSON interno
    var inner = "";
    var pm = clean.match(/"wrb\.fr"\s*,\s*"[^"]*"\s*,\s*"([\s\S]+?)"\s*\]/);
    if (pm) {
      inner = pm[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    } else {
      inner = clean;
    }

    // Extrai URLs do googlevideo
    var urlRegex = /"((?:https?:\\?\/\\?\/)?[^"]+?googlevideo[^"]+?)"\s*,\s*\[(\d+)\]/g;
    var um;
    var seen = [];

    while ((um = urlRegex.exec(inner)) !== null) {
      var rawUrl = decodeUrl(um[1]);
      var itag   = parseInt(um[2]);
      var quality = ITAG_QUALITY[itag] || "360p";
      var cpn    = generateCpn();

      var sep = rawUrl.indexOf("?") !== -1 ? "&" : "?";
      var finalUrl = rawUrl + sep + "cpn=" + cpn + "&c=WEB_EMBEDDED_PLAYER&cver=1.20260224.08.00";

      if (seen.indexOf(itag) === -1) {
        seen.push(itag);
        streams.push({
          name: "AnimeFire",
          title: quality + " • AnimeFire [Blogger]",
          url: finalUrl,
          quality: quality,
          headers: {
            "Referer": "https://youtube.googleapis.com/",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
            "Range": "bytes=0-"
          }
        });
      }
    }

    return streams;
  })
  .catch(function() { return []; });
}

function extractBloggerStreams(episodePageHtml, episodeUrl) {
  var token = extractBloggerToken(episodePageHtml);
  if (!token) return Promise.resolve([]);

  return fetch("https://www.blogger.com/video.g?token=" + token, {
    headers: {
      "Referer": episodeUrl,
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
      "sec-ch-ua-mobile": "?1"
    }
  })
  .then(function(r) { return r.text(); })
  .then(function(bloggerHtml) {
    var wizData = extractWizData(bloggerHtml);
    return callBloggerBatch(token, wizData);
  })
  .catch(function() { return []; });
}

// ─── 5. Extrai streams do episódio (decide Lightspeed vs Blogger) ────────────

function extractStreamsFromEpisode(episodeUrl) {
  return fetch(episodeUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": BASE_URL
    }
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    var hasBlogger = html.indexOf("blogger.com/video.g") !== -1;

    if (hasBlogger) {
      return extractBloggerStreams(html, episodeUrl);
    } else {
      return extractLightspeedStreams(episodeUrl);
    }
  })
  .catch(function() { return []; });
}

// ─── 6. Ponto de entrada principal ──────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
  var targetEpisode = episode || 1;

  return getTitleFromTMDB(tmdbId, mediaType)
    .then(function(title) {
      if (!title) return [];
      console.log("[AnimeFire] Buscando: " + title);
      return searchAnimeFire(title);
    })
    .then(function(links) {
      if (!links || links.length === 0) return [];

      var animeUrl = links[0]; // Primeiro resultado da busca
      console.log("[AnimeFire] Página do anime: " + animeUrl);

      // Filmes: vai direto para a URL (episódio único)
      if (mediaType === "movie") {
        return extractStreamsFromEpisode(animeUrl + "/1")
          .catch(function() { return extractStreamsFromEpisode(animeUrl); });
      }

      return getEpisodeUrl(animeUrl, targetEpisode);
    })
    .then(function(episodeUrl) {
      if (!episodeUrl || typeof episodeUrl !== "string") return [];
      console.log("[AnimeFire] Episódio: " + episodeUrl);
      return extractStreamsFromEpisode(episodeUrl);
    })
    .catch(function(err) {
      console.error("[AnimeFire] Erro:", err.message || err);
      return [];
    });
}

module.exports = { getStreams };
