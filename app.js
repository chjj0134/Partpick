let products = [];
let recommendations = [];
let report = { body: "새로 분석을 누르면 관심상품 전체 리포트가 생성됩니다.", externalLinks: [], source: "Rules", model: "local" };
let crawlData = { results: [], items: [] };
let reportReady = false;
let reportLoading = false;

const state = {
  category: "all",
  series: "all",
  budget: 900000,
  purpose: "gaming",
  selectedProductId: "",
  motherboard: "B650 DDR5 메인보드",
  memoryType: "DDR5",
  psu: 600,
  caseLength: 300,
  crawlQuery: "RTX 5070",
  crawlLimit: 5
};

const formatter = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0
});

const productSelect = document.querySelector("#productSelect");
const productList = document.querySelector("#productList");
const recommendList = document.querySelector("#recommendList");
const reportOutput = document.querySelector("#reportOutput");
const recommendSummary = document.querySelector("#recommendSummary");
const buildSummary = document.querySelector("#buildSummary");
const motherboardInput = document.querySelector("#motherboardInput");
const dashboardMemoryTypeInput = document.querySelector("#dashboardMemoryTypeInput");
const dashboardPsuInput = document.querySelector("#dashboardPsuInput");
const dashboardCaseLengthInput = document.querySelector("#dashboardCaseLengthInput");
const trackedCount = document.querySelector("#trackedCount");
const averageChange = document.querySelector("#averageChange");
const bestBuyCount = document.querySelector("#bestBuyCount");
const updatedAt = document.querySelector("#updatedAt");
const refreshButton = document.querySelector("#refreshButton");
const crawlQueryInput = document.querySelector("#crawlQueryInput");
const crawlLimitInput = document.querySelector("#crawlLimitInput");
const crawlButton = document.querySelector("#crawlButton");
const sourceInputs = [...document.querySelectorAll(".sourceInput")];
const crawlSummary = document.querySelector("#crawlSummary");
const crawlStatusList = document.querySelector("#crawlStatusList");
const crawlResultList = document.querySelector("#crawlResultList");
const priceChart = document.querySelector("#priceChart");

function queryParams(extra = {}) {
  return new URLSearchParams({
    category: state.category,
    series: state.series,
    budget: state.budget,
    purpose: state.purpose,
    motherboard: state.motherboard,
    memoryType: state.memoryType,
    psu: state.psu,
    caseLength: state.caseLength,
    ...extra
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function loadData() {
  try {
    const params = queryParams();
    const productData = await getJson(`/api/watchlist?category=${state.category}&series=${state.series}`);
    const recommendationData = await getJson(`/api/recommendations?${params}`);

    products = productData.products;
    recommendations = recommendationData.recommendations;
  } catch (error) {
    products = [];
    recommendations = [];
    report = { body: "서버 연결 전에는 리포트를 생성할 수 없습니다.", source: "Rules", model: "local" };
  }

  if (!products.some(product => product.id === state.selectedProductId)) {
    state.selectedProductId = products[0]?.id || "";
  }
}

async function loadReport() {
  reportLoading = true;
  renderReport();
  try {
    const reportData = await getJson(`/api/report?${queryParams()}`);
    report = reportData.report;
    reportReady = true;
  } catch (error) {
    report = { body: `리포트 생성에 실패했습니다. ${error.message}`, externalLinks: [], source: "Rules", model: "local" };
    reportReady = true;
  } finally {
    reportLoading = false;
  }
}

function renderProductOptions() {
  productSelect.innerHTML = products.length
    ? products.map(product => `<option value="${product.id}">${product.name}</option>`).join("")
    : `<option value="">관심상품 없음</option>`;
  productSelect.value = state.selectedProductId;
}

function renderMetrics() {
  const average = products.length
    ? products.reduce((sum, product) => sum + product.change, 0) / products.length
    : 0;

  trackedCount.textContent = products.length;
  averageChange.textContent = `${average.toFixed(1)}%`;
  bestBuyCount.textContent = products.filter(product => product.change <= -3).length;
}

function renderProducts() {
  if (!products.length) {
    productList.innerHTML = `<article class="product"><div class="product-top"><h3>관심상품 없음</h3></div><p class="compat-note">실시간 수집 탭에서 상품을 검색한 뒤 관심상품으로 담으면 여기에 표시됩니다.</p></article>`;
    return;
  }

  productList.innerHTML = products.slice(0, 4)
    .map(product => {
      const isGood = product.change <= -3;
      const compatibility = productCompatibility(product);
      const specText = product.category === "GPU"
        ? `${product.spec.series} · ${product.spec.recommendedPsu}W · ${product.spec.lengthMm}mm`
        : `${product.spec.memoryType} · ${product.spec.speed}MHz`;

      return `
        <article class="product">
          <div class="product-top">
            <h3>${product.name}</h3>
            <div class="badge-row">
              <span class="badge ${compatibility.ok ? "" : "warn"}">${compatibility.label}</span>
              <span class="badge ${isGood ? "" : "warn"}">${isGood ? "구매 검토" : "대기 권장"}</span>
            </div>
          </div>
          <div class="details">
            <span>현재가<strong>${formatter.format(product.price)}</strong></span>
            <span>7일 변동<strong>${product.change}%</strong></span>
            <span>스펙<strong>${specText}</strong></span>
          </div>
          <p class="compat-note">${compatibility.reason}</p>
          <button class="small-button" data-remove-id="${product.id}">관심상품 삭제</button>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-remove-id]").forEach(button => {
    button.addEventListener("click", async () => {
      await removeWatchItem(button.dataset.removeId);
    });
  });
}

function productCompatibility(product) {
  if (product.category === "GPU") {
    const psuOk = Number(product.spec.recommendedPsu || 9999) <= state.psu;
    const lengthOk = Number(product.spec.lengthMm || 9999) <= state.caseLength;
    const ok = psuOk && lengthOk;
    const reasons = [
      psuOk ? `${state.psu}W 파워 OK` : `${product.spec.recommendedPsu}W 이상 권장`,
      lengthOk ? `${state.caseLength}mm 케이스 OK` : `${product.spec.lengthMm}mm 장착 공간 필요`
    ];

    return {
      ok,
      label: ok ? "내 PC 호환" : "호환 확인",
      reason: `${state.motherboard} 기준 · ${reasons.join(" · ")}`
    };
  }

  if (product.category === "RAM") {
    const ok = product.spec.memoryType === state.memoryType;
    return {
      ok,
      label: ok ? "내 PC 호환" : "호환 확인",
      reason: `${state.motherboard} 기준 · ${ok ? `${state.memoryType} 메모리 규격 일치` : `${state.memoryType} 메인보드에는 ${product.spec.memoryType} RAM 사용 불가`}`
    };
  }

  return {
    ok: true,
    label: "호환 가능",
    reason: `${state.motherboard} 기준`
  };
}

function renderRecommendations() {
  const sorted = [...recommendations].sort((a, b) => {
    const aOk = (a.compatibility || productCompatibility(a)).ok ? 1 : 0;
    const bOk = (b.compatibility || productCompatibility(b)).ok ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    return (b.valueScore || 0) - (a.valueScore || 0);
  });
  recommendSummary.textContent = `${state.motherboard} 기준`;

  if (!sorted.length) {
    recommendList.innerHTML = `<article class="recommend"><h3>추천 후보 없음</h3><p>관심상품을 담으면 내 PC 사양 기준으로 대체재를 추천합니다.</p></article>`;
    return;
  }

  recommendList.innerHTML = sorted
    .map((product, index) => {
      const compatibility = productCompatibility(product);
      const serverCompatibility = product.compatibility || compatibility;
      return `
        <article class="recommend">
          <div class="recommend-top">
            <h3>${index + 1}. ${product.name}</h3>
            <div class="badge-row">
              <span class="badge ${serverCompatibility.ok ? "" : "warn"}">${serverCompatibility.label}</span>
              <span class="badge">${product.buySignal || "추천"}</span>
            </div>
          </div>
          <div class="details">
            <span>가격<strong>${formatter.format(product.price)}</strong></span>
            <span>성능 점수<strong>${product.score}</strong></span>
            <span>가성비<strong>${product.valueScore || Math.round((product.score / product.price) * 1000000)}</strong></span>
          </div>
          <p>${serverCompatibility.reason}</p>
        </article>
      `;
    })
    .join("");
}

function renderReport() {
  if (reportLoading) {
    reportOutput.innerHTML = `
      <article class="report-block loading-report">
        <div class="loader"></div>
        <p>AI가 관심상품, 월별 가격 흐름, 시장 뉴스를 함께 분석하는 중입니다. 보통 20초 정도 걸릴 수 있습니다.</p>
      </article>
    `;
    return;
  }

  if (!reportReady) {
    reportOutput.innerHTML = `
      <article class="report-block">
        <p>크레딧 사용을 줄이기 위해 자동 생성은 꺼져 있습니다. 새로 분석을 누르면 현재 관심상품 기준으로 한 번만 리포트를 생성합니다.</p>
      </article>
    `;
    return;
  }

  reportOutput.innerHTML = `
    <article class="report-block">
      <p>${formatReportBody(report.body)}</p>
    </article>
    ${renderExternalLinks(report.externalLinks || [])}
  `;
}

function renderExternalLinks(links) {
  if (!links.length) return "";
  return `
    <article class="report-block report-links">
      <h3>쿠팡 · G마켓 참고 링크</h3>
      ${links.map(item => `
        <div class="report-link-item">
          <strong>${escapeHtml(item.name)}</strong>
          <a href="${escapeHtml(item.coupang)}" target="_blank" rel="noreferrer">쿠팡 검색</a>
          <a href="${escapeHtml(item.gmarket)}" target="_blank" rel="noreferrer">G마켓 검색</a>
        </div>
      `).join("")}
    </article>
  `;
}

function formatReportBody(value) {
  return escapeHtml(String(value || "리포트 내용이 없습니다.")).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBuildControls() {
  buildSummary.textContent = `${state.motherboard} · ${state.memoryType} · ${state.psu}W · ${state.caseLength}mm`;
  motherboardInput.value = state.motherboard;
  dashboardMemoryTypeInput.value = state.memoryType;
  dashboardPsuInput.value = String(state.psu);
  dashboardCaseLengthInput.value = String(state.caseLength);
}

function selectedSources() {
  const sources = sourceInputs
    .filter(input => input.checked)
    .map(input => input.value);
  return sources.length ? sources : ["danawa", "compuzone", "guidecom", "bytemall", "icoda"];
}

async function runCrawler() {
  const sources = selectedSources();
  const query = state.crawlQuery.trim();

  if (!query) {
    crawlResultList.innerHTML = `<article class="recommend"><h3>검색어가 필요합니다</h3><p>예: RTX 5070, DDR5 32GB처럼 상품명을 입력해 주세요.</p></article>`;
    return;
  }

  crawlButton.textContent = "수집 중";
  crawlButton.disabled = true;
  crawlStatusList.innerHTML = "";
  crawlResultList.innerHTML = `<article class="recommend"><h3>가격 수집 중</h3><p>선택한 쇼핑몰에서 상품명과 가격 후보를 가져오는 중입니다.</p></article>`;

  try {
    crawlData = await getJson(`/api/crawl?query=${encodeURIComponent(query)}&sources=${sources.join(",")}&limit=${state.crawlLimit}`);
  } catch (error) {
    crawlData = {
      results: [{ platform: "수집 서버", ok: false, items: [], error: error.message, elapsedMs: 0 }],
      items: []
    };
  }

  renderCrawler();
  crawlButton.textContent = "가격 수집";
  crawlButton.disabled = false;
}

function renderCrawler() {
  const resultCount = crawlData.items.length;
  crawlSummary.textContent = `${state.crawlQuery} · ${resultCount}개 후보`;

  crawlStatusList.innerHTML = crawlData.results
    .map(result => `
      <div class="crawl-chip ${result.ok && result.items.length ? "" : "muted"}">
        <strong>${result.platform}</strong>
        ${crawlStatusText(result)}
      </div>
    `)
    .join("");

  if (!resultCount) {
    crawlResultList.innerHTML = `<article class="recommend"><h3>가격 후보 없음</h3><p>검색어를 더 구체적으로 입력해 보세요.</p></article>`;
    return;
  }

  crawlResultList.innerHTML = crawlData.items
    .map((item, index) => `
      <article class="recommend">
        <div class="recommend-top">
          <h3>${index + 1}. ${item.name}</h3>
          <span class="badge">${item.platform}</span>
        </div>
        <div class="details">
          <span>수집 가격<strong>${formatter.format(item.price)}</strong></span>
          <span>출처<strong>${item.platform}</strong></span>
          <span>정렬<strong>낮은 가격순</strong></span>
        </div>
        <button class="small-button" data-watch-index="${index}">관심상품 담기</button>
      </article>
    `)
    .join("");

  document.querySelectorAll("[data-watch-index]").forEach(button => {
    button.addEventListener("click", async () => {
      await addWatchItem(crawlData.items[Number(button.dataset.watchIndex)]);
      button.textContent = "담김";
    });
  });
}

function crawlStatusText(result) {
  if (result.ok) return `${result.items.length}개 · ${result.elapsedMs}ms`;
  if (result.status === 403) return "접속 제한";
  if (result.status) return `응답 제한 ${result.status}`;
  return "응답 없음";
}

async function addWatchItem(item) {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  });
  if (!response.ok) throw new Error("관심상품 저장 실패");
  await renderAll();
}

async function removeWatchItem(id) {
  await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  await renderAll();
}

function drawChart() {
  const product = products.find(item => item.id === state.selectedProductId) || products[0];

  if (!product) {
    priceChart.innerHTML = `
      <text x="60" y="170" class="chart-axis-label">관심상품을 담으면 가격 추이가 표시됩니다.</text>
    `;
    return;
  }

  const values = product.monthlyTrend && product.monthlyTrend.length ? product.monthlyTrend : product.trend.length ? product.trend : [product.price];
  const dates = product.monthlyDates && product.monthlyDates.length ? product.monthlyDates : product.dates && product.dates.length ? product.dates : [new Date().toISOString().slice(0, 10)];
  const width = 1400;
  const height = 320;
  const padding = { top: 28, right: 34, bottom: 58, left: 92 };
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const range = Math.max(maxRaw - minRaw, Math.max(maxRaw * 0.08, 10000));
  const min = minRaw - range * 0.18;
  const max = maxRaw + range * 0.18;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const grid = [];

  for (let i = 0; i < 5; i += 1) {
    const y = padding.top + (chartHeight / 4) * i;
    const price = max - ((max - min) / 4) * i;
    grid.push(`
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid"></line>
      <text x="28" y="${y + 7}" class="chart-axis-label">${shortPrice(price)}</text>
    `);
  }

  const points = values.map((value, index) => {
    const denom = Math.max(values.length - 1, 1);
    const x = values.length === 1 ? padding.left + chartWidth / 2 : padding.left + (chartWidth / denom) * index;
    const y = padding.top + chartHeight - ((value - min) / (max - min)) * chartHeight;
    return { x, y, value };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const dateLabels = points
    .map((point, index) => {
      const show = values.length <= 8 || index === 0 || index === points.length - 1 || index % 2 === 0;
      return show ? `<text x="${point.x}" y="${height - 18}" text-anchor="middle" class="chart-axis-label">${compactDate(dates[index])}</text>` : "";
    })
    .join("");
  const dots = points
    .map(point => `<circle cx="${point.x}" cy="${point.y}" r="7" class="chart-dot"></circle>`)
    .join("");

  priceChart.innerHTML = `
    ${grid.join("")}
    <path d="${linePath}" class="chart-line"></path>
    ${dots}
    ${dateLabels}
  `;
}

function shortPrice(value) {
  if (value >= 100000000) return `${Math.round(value / 100000000)}억`;
  if (value >= 10000) return `${Math.round(value / 10000)}만`;
  return Math.round(value).toLocaleString("ko-KR");
}

function compactDate(value) {
  const parts = String(value || "").split("-");
  if (parts.length === 2) return `${parts[1]}월`;
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function purposeLabel(value) {
  return {
    gaming: "게임",
    work: "작업",
    balanced: "균형"
  }[value] || value;
}

async function renderAll() {
  await loadData();
  renderBuildControls();
  renderProductOptions();
  renderMetrics();
  renderProducts();
  renderRecommendations();
  drawChart();
  updatedAt.textContent = new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active-view"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active-view");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    await renderAll();
    if (button.dataset.view === "crawl") {
      await runCrawler();
    }
    if (button.dataset.view === "report") {
      renderReport();
    }
  });
});

productSelect.addEventListener("change", event => {
  state.selectedProductId = event.target.value;
  drawChart();
});

motherboardInput.addEventListener("input", event => {
  state.motherboard = event.target.value || "내 메인보드";
  renderProducts();
  renderRecommendations();
  renderBuildControls();
});

dashboardMemoryTypeInput.addEventListener("change", event => {
  state.memoryType = event.target.value;
  renderAll();
});

dashboardPsuInput.addEventListener("change", event => {
  state.psu = Number(event.target.value);
  renderAll();
});

dashboardCaseLengthInput.addEventListener("change", event => {
  state.caseLength = Number(event.target.value);
  renderAll();
});

crawlQueryInput.addEventListener("input", event => {
  state.crawlQuery = event.target.value;
});

crawlLimitInput.addEventListener("change", event => {
  state.crawlLimit = Number(event.target.value);
});

crawlButton.addEventListener("click", () => {
  runCrawler();
});

refreshButton.addEventListener("click", async () => {
  refreshButton.textContent = "분석 중";
  await renderAll();
  if (document.querySelector("#report").classList.contains("active-view")) {
    await loadReport();
    renderReport();
  }
  refreshButton.textContent = "분석 완료";
  setTimeout(() => {
    refreshButton.textContent = "새로 분석";
  }, 1200);
});

renderAll();
