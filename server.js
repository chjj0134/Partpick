const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { crawlPrices } = require("./crawler");

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const dataPath = path.join(root, "data.json");
const watchlistPath = path.join(root, "watchlist.json");
const envPath = path.join(root, ".env");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

loadEnv();
const openAiModel = process.env.OPENAI_MODEL || "gpt-5-mini";
const openAiBaseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function loadCatalog() {
  return JSON.parse(readJsonText(dataPath)).catalog;
}

function loadWatchlist() {
  if (!fs.existsSync(watchlistPath)) {
    saveWatchlist([]);
  }
  return JSON.parse(readJsonText(watchlistPath)).items;
}

function saveWatchlist(items) {
  fs.writeFileSync(watchlistPath, JSON.stringify({ items }, null, 2), "utf8");
}

function readJsonText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w가-힣 ]/g, "")
    .trim();
}

function itemId(item) {
  return Buffer.from(`${item.platform}:${normalizeKey(item.name)}`).toString("base64url").slice(0, 32);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function initialHistory(price) {
  const ratios = [1.075, 1.052, 1.038, 1.024, 1.015, 1.006, 1];
  return ratios.map((ratio, index) => ({
    date: dateDaysAgo(ratios.length - 1 - index),
    price: Math.max(1000, Math.round(price * ratio / 1000) * 1000)
  }));
}

function monthlyHistory(history) {
  const now = new Date();
  const months = [];
  const latest = history[history.length - 1] || { price: 0 };
  const first = history[0] || latest;
  const latestPrice = latest.price || 0;
  const firstPrice = first.price || latestPrice;
  const delta = latestPrice - firstPrice;
  const direction = delta > latestPrice * 0.02 ? 1 : delta < latestPrice * -0.02 ? -1 : 0;
  const baseRatio = direction === 0 ? 1 : direction > 0 ? 0.9 : 1.1;

  for (let month = 0; month <= now.getMonth(); month += 1) {
    const date = new Date(now.getFullYear(), month, 1);
    const progress = now.getMonth() ? month / now.getMonth() : 1;
    const estimatedStart = firstPrice || Math.round(latestPrice * baseRatio);
    const price = Math.round((estimatedStart + (latestPrice - estimatedStart) * progress) / 1000) * 1000;
    months.push({
      date: `${date.getFullYear()}-${String(month + 1).padStart(2, "0")}`,
      price: Math.max(1000, price)
    });
  }

  return months;
}

function trendDirection(values) {
  if (!values.length) return "유지";
  const first = values[0];
  const last = values[values.length - 1];
  const rate = first ? ((last - first) / first) * 100 : 0;
  if (rate >= 3) return "상승";
  if (rate <= -3) return "하락";
  return "유지";
}

function inferSpec(name) {
  const catalog = loadCatalog();
  const normalized = normalizeKey(name);
  const matched = catalog
    .filter(entry => normalized.includes(normalizeKey(entry.keyword)))
    .sort((a, b) => b.keyword.length - a.keyword.length)[0];

  if (matched) {
    const { keyword, ...spec } = matched;
    return spec;
  }

  if (/ddr5/i.test(name)) {
    return { category: "RAM", memoryType: "DDR5", capacityGb: 32, speed: 5600, score: 80, purpose: ["balanced"] };
  }

  if (/ddr4/i.test(name)) {
    return { category: "RAM", memoryType: "DDR4", capacityGb: 32, speed: 3200, score: 65, purpose: ["balanced"] };
  }

  return { category: "GPU", series: "확인 필요", vram: "확인 필요", recommendedPsu: 650, lengthMm: 300, pcie: "확인 필요", score: 100, purpose: ["balanced"] };
}

function hydrateItem(raw) {
  const savedHistory = raw.history || [];
  const latestSaved = savedHistory[savedHistory.length - 1] || { price: raw.price || 0, date: today() };
  const history = savedHistory.length > 1 ? savedHistory : initialHistory(latestSaved.price);
  const latest = history[history.length - 1] || { price: raw.price || 0, date: today() };
  const first = history[0] || latest;
  const change = first.price ? ((latest.price - first.price) / first.price) * 100 : 0;
  const monthly = monthlyHistory(history);
  const monthlyTrend = monthly.map(entry => entry.price);

  return {
    ...raw,
    price: latest.price,
    change: Number(change.toFixed(1)),
    trend: history.map(entry => entry.price),
    dates: history.map(entry => entry.date),
    monthlyTrend,
    monthlyDates: monthly.map(entry => entry.date),
    trendDirection: trendDirection(monthlyTrend),
    score: raw.spec.score || 100,
    purpose: raw.spec.purpose || ["balanced"],
    category: raw.spec.category
  };
}

function filteredItems(items, params) {
  const category = params.get("category") || "all";
  const series = params.get("series") || "all";
  const purpose = params.get("purpose") || "all";
  const budget = toNumber(params.get("budget"), Infinity);

  return items.filter(item => {
    const categoryMatch = category === "all" || item.category === category;
    const seriesMatch = series === "all" || item.spec.series === series || item.category !== "GPU";
    const purposeMatch = purpose === "all" || item.purpose.includes(purpose) || item.purpose.includes("balanced");
    const budgetMatch = item.price <= budget;
    return categoryMatch && seriesMatch && purposeMatch && budgetMatch;
  });
}

function summarize(items) {
  const averageChange = items.length ? items.reduce((sum, item) => sum + item.change, 0) / items.length : 0;
  return {
    trackedCount: items.length,
    averageChange: Number(averageChange.toFixed(1)),
    bestBuyCount: items.filter(item => item.change <= -3).length
  };
}

function itemCompatibility(item, params) {
  const motherboard = params.get("motherboard") || "내 메인보드";
  const memoryType = params.get("memoryType") || "DDR5";
  const psu = toNumber(params.get("psu"), 600);
  const caseLength = toNumber(params.get("caseLength"), 300);

  if (item.category === "GPU") {
    const psuOk = Number(item.spec.recommendedPsu || 9999) <= psu;
    const lengthOk = Number(item.spec.lengthMm || 9999) <= caseLength;
    const ok = psuOk && lengthOk;
    const checks = [
      psuOk ? `${psu}W 파워 OK` : `${item.spec.recommendedPsu}W 이상 권장`,
      lengthOk ? `${caseLength}mm 케이스 OK` : `${item.spec.lengthMm}mm 장착 공간 필요`
    ];

    return {
      ok,
      label: ok ? "내 PC 호환" : "호환 확인",
      reason: `${motherboard} 기준 · ${checks.join(" · ")}`
    };
  }

  if (item.category === "RAM") {
    const ok = item.spec.memoryType === memoryType;
    return {
      ok,
      label: ok ? "내 PC 호환" : "호환 확인",
      reason: `${motherboard} 기준 · ${ok ? `${memoryType} 메모리 규격 일치` : `${memoryType} 메인보드에는 ${item.spec.memoryType} RAM 사용 불가`}`
    };
  }

  return {
    ok: true,
    label: "호환 가능",
    reason: `${motherboard} 기준`
  };
}

function recommendations(items, params) {
  return filteredItems(items, params)
    .map(item => {
      const compatibility = itemCompatibility(item, params);
      return {
        ...item,
        compatibility,
        valueScore: Math.round((item.score / Math.max(item.price, 1)) * 1000000),
        buySignal: item.change <= -3 ? "구매 검토" : "대기 권장"
      };
    })
    .sort((a, b) => {
      if (a.compatibility.ok !== b.compatibility.ok) return a.compatibility.ok ? -1 : 1;
      return b.valueScore - a.valueScore;
    });
}

function report(items, params) {
  const scoped = items;
  const recommended = reportRecommendations(items, params);
  const gpus = scoped.filter(item => item.category === "GPU");
  const rams = scoped.filter(item => item.category === "RAM");
  const gpuAverage = gpus.length ? Math.round(gpus.reduce((sum, item) => sum + item.price, 0) / gpus.length) : 0;
  const cheapestGpu = gpus.sort((a, b) => a.price - b.price)[0];
  const bestValue = recommended[0];
  const directions = scoped.map(item => item.trendDirection);
  const aggregateDirection = directions.filter(value => value === "상승").length > directions.filter(value => value === "하락").length ? "상승" : directions.filter(value => value === "하락").length > directions.filter(value => value === "상승").length ? "하락" : "유지";

  return {
    body: scoped.length
      ? `관심상품 ${scoped.length}개 기준 월별 가격 흐름은 ${aggregateDirection}입니다. GPU ${gpus.length}개의 평균가는 ${gpuAverage.toLocaleString("ko-KR")}원이며, 가장 저렴한 GPU는 ${cheapestGpu?.name || "없음"}입니다. 가성비 기준으로는 ${bestValue?.name || "관심상품 없음"}을 먼저 볼 수 있습니다. RAM 관심상품은 ${rams.length}개이며, 현재 입력한 메인보드 메모리 규격과 함께 확인해야 합니다. 최근 GPU와 DDR5 시장 뉴스까지 감안하면 단기 급락보다는 품목별 차별화가 크고, RTX 50 일부 모델은 재고와 수요에 따라 높은 가격이 유지될 가능성이 있습니다. 쿠팡과 G마켓은 서버 수집 제한이 있어 별도 검색 링크로만 제공합니다.`
      : "아직 관심상품이 없습니다. 실시간 수집 탭에서 상품을 담으면 GPU와 RAM 가격 비교 리포트가 생성됩니다.",
    externalLinks: externalSearchLinks(scoped),
    source: "Rules",
    model: "local"
  };
}

function reportContext(items, params) {
  const scoped = items;
  const recommended = reportRecommendations(items, params).slice(0, 5);
  return {
    build: {
      motherboard: params.get("motherboard") || "B650 DDR5 메인보드",
      memoryType: params.get("memoryType") || "DDR5",
      psu: toNumber(params.get("psu"), 600),
      caseLength: toNumber(params.get("caseLength"), 300),
      budget: toNumber(params.get("budget"), 900000),
      purpose: params.get("purpose") || "gaming"
    },
    summary: summarize(scoped),
    watchlist: scoped.slice(0, 8).map(item => ({
      name: item.name,
      platform: item.platform,
      category: item.category,
      price: item.price,
      change: item.change,
      dates: item.dates,
      trend: item.trend,
      monthlyDates: item.monthlyDates,
      monthlyTrend: item.monthlyTrend,
      trendDirection: item.trendDirection,
      spec: item.spec
    })),
    recommendations: recommended.map(item => ({
      name: item.name,
      platform: item.platform,
      price: item.price,
      change: item.change,
      trendDirection: item.trendDirection,
      valueScore: item.valueScore,
      buySignal: item.buySignal,
      compatibility: item.compatibility,
      spec: item.spec
    })),
    externalSearch: externalSearchLinks(scoped),
    marketNews: marketNewsContext()
  };
}

function marketNewsContext() {
  return [
    "2026년 5월 말 PC Gamer의 GPU 가격 점검에서는 RTX 5070, RTX 5070 Ti, RTX 5080 등 일부 RTX 50 시리즈가 MSRP보다 높고 가격이 상승한 품목으로 언급됐다.",
    "2026년 5월 말 PC Gamer는 Team Group CEO 인터뷰를 통해 DDR5와 SSD 가격 압력이 2026~2027년에도 이어질 수 있다고 보도했다.",
    "2026년 5월 TechSpot은 DDR5 spot 가격 일부가 하락했지만 Q2 2026 계약 가격은 큰 폭 상승 전망이 남아 있다고 전했다.",
    "2026년 5월 Framework 관련 보도에서는 메모리 가격이 최근 몇 달 안정되는 조짐은 있으나 전체 비용 압력은 계속된다고 설명했다."
  ];
}

function reportRecommendations(items, params) {
  return items
    .map(item => {
      const compatibility = itemCompatibility(item, params);
      return {
        ...item,
        compatibility,
        valueScore: Math.round((item.score / Math.max(item.price, 1)) * 1000000),
        buySignal: item.change <= -3 ? "구매 검토" : "대기 권장"
      };
    })
    .sort((a, b) => {
      if (a.compatibility.ok !== b.compatibility.ok) return a.compatibility.ok ? -1 : 1;
      return b.valueScore - a.valueScore;
    });
}

function externalSearchLinks(items) {
  return items.slice(0, 5).map(item => ({
    name: item.name,
    coupang: `https://www.coupang.com/np/search?q=${encodeURIComponent(item.name)}`,
    gmarket: `https://browse.gmarket.co.kr/search?keyword=${encodeURIComponent(item.name)}`
  }));
}

function extractResponseText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap(item => item.content || [])
    .map(content => content.text || "")
    .filter(Boolean)
    .join("\n");
}

function parseAiReport(text) {
  const source = String(text || "").trim();
  const jsonText = source.match(/\{[\s\S]*\}/)?.[0] || source;
  const parsed = JSON.parse(jsonText);
  return {
    body: reportText(parsed.body || parsed.report || parsed.trend),
    externalLinks: [],
    source: "OpenAI",
    model: openAiModel
  };
}

function reportText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(reportText).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(reportText).filter(Boolean).join(" ");
  return value == null ? "" : String(value);
}

async function aiReport(items, params) {
  const links = externalSearchLinks(items);
  const fallback = { ...report(items, params), externalLinks: links, source: "Rules", model: "local" };
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      ...fallback,
      body: `${fallback.body} OpenAI API 키가 설정되면 실제 생성형 AI 분석으로 전환됩니다.`
    };
  }

  const payload = {
    model: openAiModel,
    input: [
      {
        role: "developer",
        content: "너는 PC 부품 가격 추이와 호환성을 분석하는 한국어 어시스턴트다. 제공된 JSON 데이터와 marketNews만 근거로 사용하고, 과장된 확정 표현을 피한다. 제목, 목록, 섹션 블럭 없이 하나의 자연스러운 한국어 리포트 문단으로 작성한다. 리포트에는 GPU 시리즈 평균가, 더 싼 후보, 가성비 후보, RAM이 있는 경우 메인보드 메모리 규격 호환성, 대시보드 월별 그래프 기준 가격 흐름 결과, 그리고 marketNews를 참고한 향후 상승/하락/유지 전망을 포함한다. 쿠팡/G마켓 URL은 본문에 넣지 말고, 서버 수집 제한 때문에 별도 검색 링크를 참고하면 된다는 문장만 짧게 쓴다. 반드시 body 키 하나만 가진 JSON 객체를 출력한다."
      },
      {
        role: "user",
        content: JSON.stringify(reportContext(items, params))
      }
    ],
    reasoning: { effort: "minimal" },
    max_output_tokens: 1800
  };

  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
    if (data.status === "incomplete") throw new Error(`OpenAI incomplete: ${data.incomplete_details?.reason || "unknown"}`);
    const parsed = parseAiReport(extractResponseText(data));
    if (!parsed.body) throw new Error("OpenAI report shape mismatch");
    return { ...parsed, externalLinks: links };
  } catch (error) {
    return {
      ...fallback,
      body: `${fallback.body} OpenAI 호출 실패로 로컬 분석을 표시합니다: ${error.message}`
    };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1000000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendNotFound(res) {
  sendJson(res, { error: "Not found" }, 404);
}

function serveFile(res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = path.normalize(requested).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendNotFound(res);
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const watchlist = loadWatchlist().map(hydrateItem);

  if (url.pathname === "/api/health") {
    sendJson(res, { ok: true, service: "PartPick Backend", ai: { provider: "OpenAI compatible", configured: Boolean(process.env.OPENAI_API_KEY), model: openAiModel, baseUrl: openAiBaseUrl } });
    return;
  }

  if (url.pathname === "/api/watchlist" && req.method === "GET") {
    const items = watchlist.filter(item => {
      const category = url.searchParams.get("category") || "all";
      const series = url.searchParams.get("series") || "all";
      return (category === "all" || item.category === category) && (series === "all" || item.spec.series === series || item.category !== "GPU");
    });
    sendJson(res, { products: items, items, summary: summarize(items) });
    return;
  }

  if (url.pathname === "/api/watchlist" && req.method === "POST") {
    const body = await readBody(req);
    const rawItems = loadWatchlist();
    const spec = inferSpec(body.name);
    const price = toNumber(body.price, 0);
    const platform = body.platform || "직접 추가";
    const base = { name: body.name || "이름 없는 상품", platform, price };
    const id = itemId(base);
    const existing = rawItems.find(item => item.id === id);
    const historyEntry = { date: today(), price };

    if (existing) {
      const sameDay = existing.history.find(entry => entry.date === historyEntry.date);
      if (sameDay) sameDay.price = price;
      else existing.history.push(historyEntry);
      existing.price = price;
      existing.url = body.url || existing.url || "";
    } else {
      rawItems.push({
        id,
        name: base.name,
        platform,
        url: body.url || "",
        spec,
        history: initialHistory(price)
      });
    }

    saveWatchlist(rawItems);
    sendJson(res, { ok: true, item: hydrateItem(rawItems.find(item => item.id === id)) });
    return;
  }

  if (url.pathname === "/api/watchlist" && req.method === "DELETE") {
    const id = url.searchParams.get("id");
    const items = loadWatchlist().filter(item => item.id !== id);
    saveWatchlist(items);
    sendJson(res, { ok: true });
    return;
  }

  if (url.pathname === "/api/recommendations") {
    sendJson(res, { recommendations: recommendations(watchlist, url.searchParams) });
    return;
  }

  if (url.pathname === "/api/report") {
    sendJson(res, { report: await aiReport(watchlist, url.searchParams) });
    return;
  }

  if (url.pathname === "/api/crawl") {
    const sources = (url.searchParams.get("sources") || "danawa,compuzone,guidecom,bytemall,icoda")
      .split(",")
      .map(source => source.trim())
      .filter(Boolean);
    const data = await crawlPrices({
      query: url.searchParams.get("query") || "",
      sources,
      limit: toNumber(url.searchParams.get("limit"), 5)
    });
    sendJson(res, data);
    return;
  }

  serveFile(res, url.pathname);
});

server.listen(port, () => {
  console.log(`PartPick server running at http://localhost:${port}`);
});
