const adapters = {
  danawa: {
    label: "다나와",
    url: query => `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`,
    patterns: [
      /<p[^>]*class="[^"]*prod_name[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<p[^>]*class="[^"]*price_sect[^"]*"[^>]*>[\s\S]*?<strong[^>]*>([\d,]+)<\/strong>/gi
    ]
  },
  compuzone: {
    label: "컴퓨존",
    url: query => `https://www.compuzone.co.kr/search/search.htm?Seargbl=1&hidden_Txt=${encodeURIComponent(query)}`,
    patterns: [
      /<a[^>]*class="[^"]*prdName[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?([\d,]+)\s*원/gi,
      /<span[^>]*class="[^"]*prd_name[^"]*"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span[^>]*class="[^"]*price[^"]*"[^>]*>([\d,]+)<\/span>/gi,
      /<div[^>]*class="[^"]*prod_name[^"]*"[^>]*>([\s\S]*?)<\/div>[\s\S]*?([\d,]+)\s*원/gi,
      /판매가[\s\S]{0,120}?([\s\S]{4,120}?RTX[\s\S]{0,120}?)[\s\S]{0,120}?([\d,]+)\s*원/gi
    ]
  },
  guidecom: {
    label: "가이드컴",
    url: query => `https://www.guidecom.co.kr/search?keyword=${encodeURIComponent(query)}`,
    patterns: [
      /<h[12][^>]*>([\s\S]*?)<\/h[12]>[\s\S]*?판매가격[\s\S]{0,160}?([\d,]+)\s*원/gi,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"[\s\S]*?판매가격[\s\S]{0,160}?([\d,]+)\s*원/gi,
      /제품번호[\s\S]{0,300}?([\s\S]{4,160}?RTX[\s\S]{0,160}?)[\s\S]{0,300}?판매가격[\s\S]{0,160}?([\d,]+)\s*원/gi
    ]
  },
  bytemall: {
    label: "바이트몰",
    url: query => `https://bytemall.co.kr/product/search.html?keyword=${encodeURIComponent(query)}`,
    patterns: [
      /상품명\s*:\s*([\s\S]*?)(?:<\/a>|<)[\s\S]*?판매가\s*:\s*([\d,]+)\s*원/gi,
      /<a[^>]*href="[^"]*\/product\/[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?판매가\s*:\s*([\d,]+)\s*원/gi,
      /<strong[^>]*class="[^"]*name[^"]*"[^>]*>([\s\S]*?)<\/strong>[\s\S]*?<span[^>]*class="[^"]*price[^"]*"[^>]*>([\d,]+)<\/span>/gi
    ]
  },
  icoda: {
    label: "아이코다",
    url: query => `https://www1.icoda.co.kr/list/search/${encodeURIComponent(query)}`,
    patterns: [
      /<a[^>]*href="[^"]*\/item\/view\/[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?([\d,]+)\s*원/gi,
      /<meta[^>]*property="og:title"[^>]*content="([^"]+)"[\s\S]*?판매가[\s\S]{0,160}?([\d,]+)\s*원/gi,
      /상품정보[\s\S]{0,500}?([\s\S]{4,160}?RTX[\s\S]{0,160}?)[\s\S]{0,300}?([\d,]+)\s*원/gi
    ]
  }
};

function normalizeText(value) {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function priceNumber(value) {
  const number = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function decodeResponse(buffer, contentType) {
  const charset = String(contentType || "").match(/charset=([^;]+)/i)?.[1]?.toLowerCase() || "";
  const encoding = charset.includes("euc") || charset.includes("ks_c") ? "euc-kr" : "utf-8";
  return new TextDecoder(encoding).decode(buffer);
}

function uniqueItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = `${item.platform}:${item.name}:${item.price}`;
    if (!item.name || !item.price || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function parseByPatterns(html, adapter, limit) {
  const items = [];

  for (const pattern of adapter.patterns) {
    let match;
    while ((match = pattern.exec(html)) && items.length < limit * 3) {
      const name = normalizeText(match[1]);
      const price = priceNumber(match[2]);
      if (name.length >= 4 && price > 0) {
        items.push({ platform: adapter.label, name, price });
      }
    }
  }

  return uniqueItems(items).slice(0, limit);
}

function parseFallback(html, adapter, query, limit) {
  const text = normalizeText(html);
  const tokens = text.split(/(?=\d{2,3}(?:,\d{3})+\s*원?)/);
  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [];

  for (const token of tokens) {
    const priceMatch = token.match(/(\d{2,3}(?:,\d{3})+)\s*원?/);
    if (!priceMatch) continue;
    const price = priceNumber(priceMatch[1]);
    const before = token.slice(Math.max(0, token.indexOf(priceMatch[0]) - 140), token.indexOf(priceMatch[0])).trim();
    const name = before.split(/\s{2,}|(?<=원)\s/).pop() || before;
    const cleanName = normalizeText(name).slice(-90);
    const lowerName = cleanName.toLowerCase();
    const matched = queryTokens.some(word => lowerName.includes(word.toLowerCase()));

    if (matched && cleanName.length >= 4 && price > 0) {
      items.push({ platform: adapter.label, name: cleanName, price });
    }
  }

  return uniqueItems(items).slice(0, limit);
}

async function crawlPlatform(source, query, limit) {
  const adapter = adapters[source];
  if (!adapter) {
    return { source, platform: source, ok: false, items: [], error: "지원하지 않는 플랫폼입니다." };
  }

  const startedAt = Date.now();
  const url = adapter.url(query);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(9000)
    });

    const html = decodeResponse(await response.arrayBuffer(), response.headers.get("content-type"));
    const patternItems = parseByPatterns(html, adapter, limit);
    const items = patternItems.length ? patternItems : parseFallback(html, adapter, query, limit);

    return {
      source,
      platform: adapter.label,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      url,
      items,
      error: response.ok ? "" : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      source,
      platform: adapter.label,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      url,
      items: [],
      error: error.message
    };
  }
}

async function crawlPrices({ query, sources, limit }) {
  const safeQuery = String(query || "").trim();
  const safeSources = Array.isArray(sources) && sources.length ? sources : Object.keys(adapters);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 10));

  if (!safeQuery) {
    return { query: safeQuery, results: [], items: [] };
  }

  const results = await Promise.all(safeSources.map(source => crawlPlatform(source, safeQuery, safeLimit)));
  const items = results
    .flatMap(result => result.items.map(item => ({ ...item, source: result.source, url: result.url })))
    .sort((a, b) => a.price - b.price);

  return {
    query: safeQuery,
    crawledAt: new Date().toISOString(),
    results,
    items
  };
}

module.exports = { crawlPrices, adapters };
