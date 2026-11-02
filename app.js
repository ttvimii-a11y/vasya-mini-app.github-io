const tg = window.Telegram?.WebApp ?? null;

if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#0a0b0d");
  tg.setBackgroundColor?.("#0a0b0d");
  tg.disableVerticalSwipes?.();
}

const state = {
  me: null,
  view: "cases",
  game: "upgrade",
  target: 2,
  busy: false,
  rocket: null,
  raf: 0,
  poll: 0,
  chart: [],
  toastTimer: 0,
};

const RARITY = {
  common: { label: "Common", icon: "star" },
  rare: { label: "Rare", icon: "star" },
  epic: { label: "Epic", icon: "star" },
  legendary: { label: "Legendary", icon: "star" },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat("ru-RU");
const digits = (text) => Number(String(text).replace(/[^\d-]/g, "")) || 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const raf = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}" /></svg>`;

/* ---------------- api ---------------- */

const initData = tg?.initData ?? "";

async function api(path, body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Нет связи с сервером. Проверь, что бот запущен");
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) throw new Error(data.message || data.error || "Ошибка запроса");
  return data;
}

/* ---------------- ui helpers ---------------- */

function haptic(type) {
  if (!tg?.HapticFeedback) return;
  try {
    if (type === "success" || type === "error") {
      tg.HapticFeedback.notificationOccurred(type);
    } else {
      tg.HapticFeedback.impactOccurred(type === "heavy" ? "medium" : "light");
    }
  } catch {
    /* optional */
  }
}

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("is-error", isError);
  el.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2600);
}

function lock(on) {
  document.body.classList.toggle("is-locked", on);
}

function animateNumber(el, to, duration = 620) {
  if (!el) return;
  const from = digits(el.textContent);
  if (from === to) {
    el.textContent = fmt.format(to);
    return;
  }
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(Math.round(from + (to - from) * eased));
    if (p < 1) el._raf = requestAnimationFrame(step);
    else el.textContent = fmt.format(to);
  };
  el._raf = requestAnimationFrame(step);
}

function setBalance(value, { animate = true } = {}) {
  if (typeof value !== "number") return;
  if (state.me) state.me.stars = value;
  const els = $$("[data-balance]");
  const chip = $("#balance-chip");
  chip?.classList.add("is-bumped");
  setTimeout(() => chip?.classList.remove("is-bumped"), 720);
  for (const el of els) {
    if (animate) animateNumber(el, value);
    else el.textContent = fmt.format(value);
  }
}

function countUp(el, to, duration = 700, suffix = "") {
  if (!el) return;
  const start = performance.now();
  cancelAnimationFrame(el._raf);
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.innerHTML = `${fmt.format(Math.round(to * eased))}${suffix}`;
    if (p < 1) el._raf = requestAnimationFrame(step);
    else el.innerHTML = `${fmt.format(to)}${suffix}`;
  };
  el._raf = requestAnimationFrame(step);
}

function placeIndicator(line, target, container, width) {
  if (!line || !target || !container) return;
  const c = container.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  line.style.width = `${width}px`;
  line.style.transform = `translateX(${t.left - c.left + t.width / 2 - width / 2}px)`;
}

function placeDockLine() {
  const dock = $("#dock");
  const active = $(".dock-btn.is-active");
  placeIndicator($("#dock-line"), active, dock, 26);
}

function placeGameLine() {
  const wrap = $("#game-tabs");
  const active = $(".seg-btn.is-active");
  if (!wrap || !active) return;
  const c = wrap.getBoundingClientRect();
  const t = active.getBoundingClientRect();
  const line = $("#game-line");
  line.style.width = `${t.width - 8}px`;
  line.style.transform = `translateX(${t.left - c.left + 4}px)`;
}

/* ---------------- rendering ---------------- */

function renderFree() {
  const card = $("#free-card");
  const used = state.me.freeUsed;
  const total = state.me.freeCase?.items?.length ?? 0;
  card.classList.toggle("is-used", used);
  card.innerHTML = `
    <div class="feature-top">
      <span class="feature-kicker">${used ? "Использован" : "Бесплатно · один раз"}</span>
      <span class="feature-count">${used ? "0 / 1" : "1 / 1"}</span>
    </div>
    <h3 class="feature-title">Стартовый кейс</h3>
    <p class="feature-sub">${total} возможных результатов внутри</p>
    <button class="btn ${used ? "btn-ghost" : "btn-primary"} btn-lg" data-action="open-free" ${
      used ? "disabled" : ""
    }>${used ? "Кейс использован" : "Открыть кейс"}</button>
  `;
}

function caseTitle(name) {
  return String(name)
    .replace(/^NFT-кейс\s*/i, "")
    .replace(/[«»"]/g, "")
    .trim();
}

function renderCases() {
  const list = $("#case-list");
  const boxes = state.me.nftCases;

  $("#cases-note").textContent = boxes.length === 1 ? "1 кейс" : `${boxes.length} кейса`;

  list.innerHTML = boxes
    .map((box, index) => {
      const name = caseTitle(box.name);
      return `
        <button class="case-card reveal" style="--i: ${index + 3}" data-action="open-case" data-id="${box.id}">
          <div class="case-art">
            ${box.cover ? `<img src="${box.cover}" alt="${name}" onerror="this.style.display='none'" />` : icon("box")}
          </div>
          <div class="case-name">${name}</div>
          <div class="case-cta">
            <span class="case-price">${icon("star")}${fmt.format(box.price)}</span>
            <span class="case-open">Открыть кейс</span>
          </div>
        </button>
      `;
    })
    .join("");
}

function renderTargets() {
  const targets = state.me.upgradeTargets;
  if (!targets.includes(state.target)) state.target = targets[1] ?? targets[0];

  $("#up-targets").innerHTML = targets
    .map(
      (target) => `
        <button class="target ${target === state.target ? "is-active" : ""}" data-action="target" data-value="${target}">
          x${target}
        </button>
      `,
    )
    .join("");

  updateUpgradePreview();
}

function updateUpgradePreview() {
  const target = state.target;
  const chance = (0.95 / target) * 100;
  $("#up-mult").textContent = `x${target.toFixed(2)}`;
  $("#up-odds").textContent = `Шанс ${chance.toFixed(1)}%`;
  $("#up-wheel")?.style.setProperty("--chance", String(chance));
  const fill = $("#up-fill");
  if (fill) fill.style.width = `${chance}%`;

  const bet = Number($("#up-bet").value) || 0;
  $("#up-payout").textContent = `${fmt.format(Math.floor(bet * target))} Stars`;
}

function renderInventory() {
  const items = state.me?.inventory ?? [];
  const host = $("#inventory");

  $("#inv-sub").textContent = items.length ? `${items.length} предметов` : "Предметы из кейсов";

  if (items.length === 0) {
    host.innerHTML = `
      <div class="empty">
        ${icon("bag")}
        <div class="empty-title">Пока пусто</div>
        <div class="empty-sub">Открой кейс — предмет появится здесь.<br />Его можно продать или вывести.</div>
        <button class="btn btn-ghost" style="margin-top:16px" data-nav="cases">Перейти к кейсам</button>
      </div>
    `;
    return;
  }

  host.innerHTML = items
    .map((item, index) => {
      const rarity = RARITY[item.rarity] ?? { label: item.rarity };
      const pending = item.status === "withdraw_pending";
      return `
        <div class="inv-row" style="--i:${Math.min(index, 8)}">
          <div class="inv-mark rarity--${item.rarity}">${icon("star")}</div>
          <div class="inv-main">
            <div class="inv-top">
              <span class="inv-name">${item.name}</span>
              <span class="inv-price">${fmt.format(item.sellStars)} Stars</span>
            </div>
            <div class="inv-meta">
              <span class="rarity-dot rarity--${item.rarity}"></span>
              <span class="rarity--${item.rarity}">${rarity.label}</span>
              ${pending ? '<span class="badge">на выводе</span>' : ""}
            </div>
            <div class="inv-actions">
              ${
                pending
                  ? `<button class="btn btn-ghost" disabled>В обработке</button>`
                  : `
                    <button class="btn btn-ghost" data-action="sell" data-id="${item.id}">Продать</button>
                    <button class="btn btn-ghost" data-action="withdraw" data-id="${item.id}">Вывести</button>
                  `
              }
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderProfile() {
  const me = state.me;
  const name = me.firstName || me.username || "Игрок";
  $("#avatar").textContent = (name[0] || "V").toUpperCase();
  $("#profile-name").textContent = name;
  $("#profile-handle").textContent = me.username ? `@${me.username}` : "Telegram";

  animateNumber($("#stat-balance"), me.stars);
  $("#stat-items").textContent = fmt.format(me.inventory.length);
  $("#profile-free").textContent = me.freeUsed ? "Использован" : "Доступен";
  $("#profile-min").textContent = `${fmt.format(me.limits.minBet)} Stars`;
  $("#profile-max").textContent = `${fmt.format(me.limits.maxBet)} Stars`;
  $("#profile-id").textContent = me.id;
}

function renderHistory(rounds) {
  const host = $("#rocket-history");
  if (!rounds?.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = rounds
    .slice(0, 12)
    .map((round) => {
      const crash = round.status === "crashed";
      return `<span class="history-pill ${crash ? "is-crash" : ""}">x${Number(round.multiplier ?? 0).toFixed(2)}</span>`;
    })
    .join("");
}

async function refreshHistory() {
  try {
    const { rounds } = await api("/rocket/history");
    renderHistory(rounds);
  } catch {
    /* decorative */
  }
}

async function refresh() {
  const me = await api("/me");
  state.me = me;
  setBalance(me.stars, { animate: false });
  renderFree();
  renderCases();
  renderTargets();
  renderInventory();
  renderProfile();
}

/* ---------------- navigation ---------------- */

function setView(name) {
  if (!name) return;
  state.view = name;

  for (const view of $$(".view")) {
    view.classList.toggle("is-active", view.dataset.view === name);
  }
  for (const btn of $$(".dock-btn")) {
    btn.classList.toggle("is-active", btn.dataset.viewBtn === name);
  }

  requestAnimationFrame(placeDockLine);

  if (name === "inventory") renderInventory();
  if (name === "profile" && state.me) renderProfile();
  if (name === "games") {
    requestAnimationFrame(() => {
      placeGameLine();
      if (state.game === "rocket") refreshHistory();
    });
  }
}

function setGame(name) {
  state.game = name;
  for (const btn of $$(".seg-btn")) {
    btn.classList.toggle("is-active", btn.dataset.game === name);
  }
  for (const panel of $$(".game-panel")) {
    panel.classList.toggle("is-active", panel.dataset.gamePanel === name);
  }
  requestAnimationFrame(placeGameLine);
  if (name === "rocket") refreshHistory();
}

/* ---------------- case opening ---------------- */

function itemTile(item) {
  const price = item.kind === "stars" ? "На баланс" : `${fmt.format(item.sell ?? 0)} Stars`;
  const art = item.image ? `<img class="ri-img" src="${item.image}" alt="" />` : icon("star");
  return `
    <div class="reel-item rarity--${item.rarity}">
      ${art}
      <span class="ri-name">${item.name}</span>
      <span class="ri-price">${price}</span>
    </div>
  `;
}

function starTile(amount) {
  return `
    <div class="reel-item rarity--legendary">
      ${icon("star")}
      <span class="ri-name">+${fmt.format(amount)}</span>
      <span class="ri-price">Stars</span>
    </div>
  `;
}

function randomStar() {
  return 1 + Math.floor(Math.random() * 80);
}

function buildTiles(pool, winnerTile, total = 56, winnerIndex = 48) {
  const tiles = [];
  for (let i = 0; i < total; i += 1) tiles.push(pool[Math.floor(Math.random() * pool.length)]);
  tiles[winnerIndex] = winnerTile;
  return tiles;
}

function itemResultHtml(item) {
  const rarity = RARITY[item.rarity] ?? { label: item.rarity };
  return `
    <div class="result-rarity rarity--${item.rarity}">
      <span class="rarity-dot"></span>${rarity.label}
    </div>
    ${item.image ? `<img class="result-img" src="${item.image}" alt="" />` : ""}
    <h3 class="result-title">${item.name}</h3>
    <p class="result-sub">Можно продать за ${fmt.format(item.sellStars)} Stars или вывести</p>
    <div class="result-actions">
      <button class="btn btn-primary" data-action="sell-opener" data-id="${item.id}">
        Продать за ${fmt.format(item.sellStars)} Stars
      </button>
      <button class="btn btn-ghost" data-action="close-opener">Оставить в инвентаре</button>
    </div>
  `;
}

function starsResultHtml(amount) {
  return `
    <div class="result-rarity rarity--legendary">Награда</div>
    <div class="result-stars" id="result-count">0<small>Stars</small></div>
    <p class="result-sub">Зачислено на баланс · ${fmt.format(amount)} Stars</p>
    <div class="result-actions">
      <button class="btn btn-primary" data-action="close-opener">Забрать</button>
    </div>
  `;
}

function openOpener({ kicker, title }) {
  $("#opener-kicker").textContent = kicker;
  $("#opener-title").textContent = title;
  $("#opener-result").innerHTML = "";
  $("#opener").classList.add("is-open");
  $("#opener").setAttribute("aria-hidden", "false");
  lock(true);
}

function closeOpener() {
  const opener = $("#opener");
  opener.classList.remove("is-open", "is-revealed");
  opener.setAttribute("aria-hidden", "true");
  const track = $("#reel-track");
  track.style.transition = "none";
  track.style.transform = "translate3d(0,0,0)";
  $("#reel-wrap").classList.remove("is-rolling");
  lock(false);
}

const REEL_MS = 5200;

async function runReel({ kicker, title, tiles, winnerIndex }) {
  openOpener({ kicker, title });

  const track = $("#reel-track");
  const wrap = $("#reel-wrap");
  track.getAnimations().forEach((animation) => animation.cancel());
  track.innerHTML = tiles.join("");
  track.style.transform = "translate3d(0px, 0px, 0px)";
  await raf();

  const first = track.firstElementChild;
  const width = first ? first.getBoundingClientRect().width : 92;
  const gap = 10;
  const step = width + gap;
  const target = -(winnerIndex * step);
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  wrap.classList.add("is-rolling");

  // Длинный выбег с торможением: быстрый старт и плавная остановка на призе.
  const spin = track.animate(
    [
      { transform: "translate3d(0px, 0px, 0px)" },
      { transform: `translate3d(${target}px, 0px, 0px)` },
    ],
    {
      duration: calm ? REEL_MS * 0.55 : REEL_MS,
      easing: "cubic-bezier(0.08, 0.62, 0.09, 1)",
      fill: "forwards",
    },
  );

  await spin.finished.catch(() => {});
  wrap.classList.remove("is-rolling");

  // Лёгкая доводка: лента чуть откатывается и встаёт ровно на выигрыш.
  track.getAnimations().forEach((animation) => animation.cancel());
  track.style.transform = `translate3d(${target}px, 0px, 0px)`;
  const settle = track.animate(
    [
      { transform: `translate3d(${target + 12}px, 0px, 0px)` },
      { transform: `translate3d(${target - 5}px, 0px, 0px)` },
      { transform: `translate3d(${target}px, 0px, 0px)` },
    ],
    { duration: 420, easing: "ease-out", fill: "forwards" },
  );

  await settle.finished.catch(() => {});

  track.children[winnerIndex]?.classList.add("is-winner");
  $("#opener").classList.add("is-revealed");
  haptic("success");
}

async function openFree() {
  if (state.busy || !state.me || state.me.freeUsed) return;
  state.busy = true;

  try {
    const result = await api("/cases/free", {});
    const isStars = result.type !== "item";

    const tiles = Array.from({ length: 56 }, () => starTile(randomStar()));
    tiles[48] = isStars
      ? starTile(result.amount)
      : itemTile({ ...result.item, sell: result.item.sellStars });

    await runReel({
      kicker: "Бесплатный кейс",
      title: "Стартовый кейс",
      tiles,
      winnerIndex: 48,
    });

    state.me.freeUsed = true;
    renderFree();
    setBalance(result.balance);

    if (isStars) {
      $("#opener-result").innerHTML = starsResultHtml(result.amount);
      countUp($("#result-count"), result.amount, 700, "<small>Stars</small>");
    } else {
      state.me.inventory.unshift(result.item);
      $("#opener-result").innerHTML = itemResultHtml(result.item);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

async function openCase(caseId) {
  if (state.busy || !state.me) return;
  const box = state.me.nftCases.find((entry) => entry.id === caseId);
  if (!box) return;

  if (state.me.stars < box.price) {
    toast(`Нужно ${fmt.format(box.price)} Stars`, true);
    return;
  }

  state.busy = true;
  try {
    const result = await api(`/cases/nft/${caseId}`, {});
    const isStars = result.type === "stars";
    const winner = isStars
      ? { kind: "stars", name: result.name, rarity: result.rarity }
      : { ...result.item, sell: result.item.sellStars };
    const pool = box.items.map(itemTile);
    const tiles = buildTiles(pool, itemTile(winner));

    await runReel({
      kicker: `Открытие · ${fmt.format(box.price)} Stars`,
      title: caseTitle(box.name),
      tiles,
      winnerIndex: 48,
    });

    setBalance(result.balance);

    if (isStars) {
      $("#opener-result").innerHTML = starsResultHtml(result.amount);
      countUp($("#result-count"), result.amount, 700, "<small>Stars</small>");
    } else {
      state.me.inventory.unshift(result.item);
      $("#opener-result").innerHTML = itemResultHtml(result.item);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

/* ---------------- inventory actions ---------------- */

async function sellItem(itemId, fromOpener = false) {
  if (state.busy) return;
  state.busy = true;
  try {
    const result = await api(`/inventory/${itemId}/sell`, {});
    setBalance(result.balance);
    haptic("success");
    toast(`Продано · +${fmt.format(result.item.sellStars)} Stars`);
    if (fromOpener) closeOpener();
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

async function withdrawItem(itemId) {
  if (state.busy || !state.me) return;
  const item = state.me.inventory.find((entry) => entry.id === itemId);
  if (!item) return;

  const confirmed = await new Promise((resolve) => {
    const text = `Создать заявку на вывод «${item.name}»?`;
    if (tg?.showConfirm) tg.showConfirm(text, (ok) => resolve(Boolean(ok)));
    else resolve(window.confirm(text));
  });
  if (!confirmed) return;

  state.busy = true;
  try {
    await api(`/inventory/${itemId}/withdraw`, {});
    haptic("success");
    toast("Заявка отправлена");
    await refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

/* ---------------- upgrade ---------------- */

function showSheet(html) {
  $("#sheet-card").innerHTML = html;
  $("#sheet").classList.add("is-open");
  $("#sheet").setAttribute("aria-hidden", "false");
  lock(true);
}

function closeSheet() {
  $("#sheet").classList.remove("is-open");
  $("#sheet").setAttribute("aria-hidden", "true");
  if (!$("#opener").classList.contains("is-open")) lock(false);
}

let needleAngle = 0;

const SPIN_MS = 2400;
const LAND_MS = 2000;

function rotationOf(el) {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
}

async function doUpgrade() {
  if (state.busy || !state.me) return;

  const bet = Number($("#up-bet").value);
  if (!Number.isInteger(bet) || bet < state.me.limits.minBet) {
    toast(`Минимальная ставка — ${state.me.limits.minBet} Stars`, true);
    return;
  }
  if (bet > state.me.stars) {
    toast("Недостаточно звёзд", true);
    return;
  }

  state.busy = true;
  const startedAt = Date.now();
  const card = $("#up-go").closest(".play-card");
  const button = $("#up-go");
  const wheel = $("#up-wheel");
  card.classList.add("is-playing");
  button.classList.add("is-loading");
  haptic("light");

  wheel.classList.remove("is-win", "is-lose");
  wheel.classList.add("is-spinning");

  const needle = $("#up-needle");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let spin = null;

  needle.getAnimations().forEach((animation) => animation.cancel());
  const from = Math.ceil(rotationOf(needle) / 360) * 360;
  spin = needle.animate(
    [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 1440}deg)` }],
    { duration: calm ? 2600 : 1300, iterations: Infinity, easing: "linear" },
  );

  try {
    const result = await api("/upgrade", { bet, target: state.target });

    // Сначала даём колесу раскрутиться — результат не должен появиться раньше.
    await wait(Math.max(0, SPIN_MS - (Date.now() - startedAt)));

    card.classList.remove("is-playing");
    wheel.classList.remove("is-spinning");
    const wedge = Math.max(4, (result.chance ?? 0) * 360);
    const landing = result.win
      ? 0
      : Math.min(340, wedge + 20 + Math.random() * Math.max(5, 320 - wedge));

    const from = rotationOf(needle);
    spin?.cancel();
    needleAngle = Math.ceil(from / 360) * 360 + 1080 + landing;
    needle.animate(
      [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${needleAngle}deg)` }],
      { duration: LAND_MS, easing: "cubic-bezier(0.12, 0.72, 0.1, 0.98)", fill: "forwards" },
    );
    wheel.classList.add(result.win ? "is-win" : "is-lose");

    // Раскрываем результат только когда стрелка остановилась.
    await wait(LAND_MS + 120);
    setBalance(result.balance);

    const chance = (result.chance * 100).toFixed(1);
    const amount = result.win ? `+${fmt.format(result.payout)}` : `−${fmt.format(result.bet)}`;

    showSheet(`
      <div class="sheet-kicker">Апгрейд · x${Number(result.target).toFixed(2)}</div>
      <h3 class="sheet-title ${result.win ? "is-win" : "is-lose"}">${result.win ? "Победа" : "Не повезло"}</h3>
      <div class="sheet-amount ${result.win ? "is-win" : "is-lose"}">${amount}<small> Stars</small></div>
      <p class="sheet-note">Ставка ${fmt.format(result.bet)} Stars · шанс ${chance}%</p>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-action="close-sheet">Продолжить</button>
      </div>
    `);

    haptic(result.win ? "success" : "error");
  } catch (err) {
    card.classList.remove("is-playing");
    spin?.cancel();
    $("#up-wheel").classList.remove("is-spinning");
    toast(err.message, true);
  } finally {
    button.classList.remove("is-loading");
    state.busy = false;
  }
}

/* ---------------- rocket ---------------- */

const CHART = { w: 320, h: 150, padTop: 12 };

function chartPoint(elapsed, multiplier) {
  const x = Math.min(1, elapsed / 26) * CHART.w;
  const y = Math.max(CHART.padTop, CHART.h - (Math.log(multiplier) / Math.log(15)) * (CHART.h - CHART.padTop));
  return { x, y };
}

function resetChart() {
  state.chart = [{ x: 0, y: CHART.h }];
  $("#rocket-path").setAttribute("d", "");
  $("#rocket-area").setAttribute("d", "");
  $("#rocket-dot").setAttribute("cx", "0");
  $("#rocket-dot").setAttribute("cy", String(CHART.h));
}

function drawChart(points) {
  if (!points.length) return;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${CHART.h} L0,${CHART.h} Z`;
  $("#rocket-path").setAttribute("d", line);
  $("#rocket-area").setAttribute("d", area);
  const last = points[points.length - 1];
  $("#rocket-dot").setAttribute("cx", last.x.toFixed(1));
  $("#rocket-dot").setAttribute("cy", last.y.toFixed(1));
}

function stopRocketLoop() {
  cancelAnimationFrame(state.raf);
  clearTimeout(state.poll);
  state.raf = 0;
  state.poll = 0;
}

function tickRocket() {
  const round = state.rocket;
  if (!round) return;

  const elapsed = Math.max(0, (Date.now() + round.offset - round.startedAt) / 1000);
  const multiplier = Math.exp(0.15 * elapsed);

  $("#rocket-mult").textContent = `x${multiplier.toFixed(2)}`;
  $("#rocket-cash").textContent = `${fmt.format(Math.max(1, Math.floor(round.bet * multiplier)))} Stars`;

  const point = chartPoint(elapsed, multiplier);
  const last = state.chart[state.chart.length - 1];
  if (!last || point.x - last.x > 0.6 || point.y < last.y - 0.4) {
    state.chart.push(point);
    if (state.chart.length > 600) state.chart.shift();
    drawChart(state.chart);
  }

  state.raf = requestAnimationFrame(tickRocket);
}

async function pollRocket() {
  const round = state.rocket;
  if (!round) return;

  try {
    const status = await api(`/rocket/${round.id}`);
    if (state.rocket?.id !== round.id) return;

    if (status.status !== "active") {
      finishRocket(status);
      return;
    }
    if (typeof status.balance === "number") setBalance(status.balance, { animate: false });
  } catch {
    /* retry */
  }

  if (state.rocket?.id === round.id) {
    state.poll = setTimeout(pollRocket, 700);
  }
}

async function startRocket() {
  if (state.busy || state.rocket || !state.me) return;

  const bet = Number($("#rocket-bet").value);
  if (!Number.isInteger(bet) || bet < state.me.limits.minBet) {
    toast(`Минимальная ставка — ${state.me.limits.minBet} Stars`, true);
    return;
  }
  if (bet > state.me.stars) {
    toast("Недостаточно звёзд", true);
    return;
  }

  state.busy = true;
  try {
    const result = await api("/rocket/start", { bet });
    setBalance(result.balance);

    state.rocket = {
      id: result.roundId,
      startedAt: result.startedAt,
      offset: result.now - Date.now(),
      bet,
    };

    const stage = $("#rocket-stage");
    stage.classList.remove("is-crashed");
    stage.classList.add("is-live");
    resetChart();

    $("#rocket-start").classList.add("hidden");
    $("#rocket-cashout").classList.remove("hidden");
    $("#rocket-status").textContent = "В полёте";
    $("#rocket-cash").textContent = `${fmt.format(bet)} Stars`;

    haptic("light");
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(tickRocket);
    state.poll = setTimeout(pollRocket, 500);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

async function cashoutRocket() {
  const round = state.rocket;
  if (!round || state.busy) return;
  state.busy = true;

  try {
    const result = await api(`/rocket/${round.id}/cashout`, {});
    finishRocket(result);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
  }
}

function finishRocket(result) {
  const round = state.rocket;
  const bet = round?.bet ?? 0;

  stopRocketLoop();
  state.rocket = null;

  const stage = $("#rocket-stage");
  stage.classList.remove("is-live");
  $("#rocket-start").classList.remove("hidden");
  $("#rocket-cashout").classList.add("hidden");

  if (typeof result.balance === "number") setBalance(result.balance);

  if (result.status === "cashed") {
    const multiplier = Number(result.multiplier ?? 1);
    $("#rocket-mult").textContent = `x${multiplier.toFixed(2)}`;
    $("#rocket-status").textContent = "Забрано";
    $("#rocket-cash").textContent = `${fmt.format(result.payout)} Stars`;
    haptic("success");

    showSheet(`
      <div class="sheet-kicker">Ракетка</div>
      <h3 class="sheet-title is-win">Забрано</h3>
      <div class="sheet-amount is-win">+${fmt.format(result.payout)}<small> Stars</small></div>
      <p class="sheet-note">Множитель x${multiplier.toFixed(2)} · ставка ${fmt.format(bet)} Stars</p>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-action="close-sheet">Продолжить</button>
      </div>
    `);
  } else {
    const crash = Number(result.crashMultiplier ?? 0);
    $("#rocket-mult").textContent = `x${crash.toFixed(2)}`;
    $("#rocket-status").textContent = "Краш";
    $("#rocket-cash").textContent = "0 Stars";
    stage.classList.add("is-crashed");
    haptic("error");

    const point = chartPoint(1e9, Math.max(crash, 1.0001));
    state.chart.push({ x: CHART.w, y: Math.max(CHART.padTop, point.y) });
    drawChart(state.chart);

    showSheet(`
      <div class="sheet-kicker">Ракетка</div>
      <h3 class="sheet-title is-lose">Краш на x${crash.toFixed(2)}</h3>
      <div class="sheet-amount is-lose">Ставка сгорела</div>
      <p class="sheet-note">Ставка ${fmt.format(bet)} Stars · краш на x${crash.toFixed(2)}</p>
      <div class="sheet-actions">
        <button class="btn btn-primary" data-action="close-sheet">Продолжить</button>
      </div>
    `);
  }

  refreshHistory();
}

/* ---------------- events ---------------- */

document.addEventListener("click", async (event) => {
  const dockBtn = event.target.closest("[data-view-btn]");
  if (dockBtn) {
    setView(dockBtn.dataset.viewBtn);
    haptic("light");
    return;
  }

  const nav = event.target.closest("[data-nav]");
  if (nav) {
    setView(nav.dataset.nav);
    return;
  }

  const gameBtn = event.target.closest("[data-game]");
  if (gameBtn) {
    setGame(gameBtn.dataset.game);
    haptic("light");
    return;
  }

  const quick = event.target.closest("[data-quick]");
  if (quick && state.me) {
    const input = quick.dataset.quick === "up" ? $("#up-bet") : $("#rocket-bet");
    if (quick.dataset.value === "max") {
      input.value = String(Math.max(state.me.limits.minBet, Math.min(state.me.limits.maxBet, state.me.stars)));
    } else {
      input.value = quick.dataset.value;
    }
    updateUpgradePreview();
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === "close-opener") {
    closeOpener();
    return;
  }
  if (action === "close-sheet") {
    closeSheet();
    return;
  }
  if (action === "target") {
    state.target = Number(actionEl.dataset.value);
    renderTargets();
    haptic("light");
    return;
  }
  if (action === "open-free") {
    await openFree();
    return;
  }
  if (action === "open-case") {
    await openCase(actionEl.dataset.id);
    return;
  }
  if (action === "sell") {
    await sellItem(actionEl.dataset.id);
    return;
  }
  if (action === "sell-opener") {
    await sellItem(actionEl.dataset.id, true);
    return;
  }
  if (action === "withdraw") {
    await withdrawItem(actionEl.dataset.id);
    return;
  }
  if (action === "upgrade") {
    await doUpgrade();
    return;
  }
  if (action === "rocket-start") {
    await startRocket();
    return;
  }
  if (action === "rocket-cashout") {
    await cashoutRocket();
  }
});

$("#sheet").addEventListener("click", (event) => {
  if (event.target === $("#sheet")) closeSheet();
});

$("#up-bet").addEventListener("input", updateUpgradePreview);

$("#deposit-btn").addEventListener("click", () => {
  const link = "https://t.me/VasyaUP_bot?start=deposit";
  if (tg?.openTelegramLink) tg.openTelegramLink(link);
  else window.open(link, "_blank");
});

$("#refresh-btn").addEventListener("click", async () => {
  try {
    await refresh();
    haptic("success");
    toast("Данные обновлены");
  } catch (err) {
    toast(err.message, true);
  }
});

window.addEventListener("resize", () => {
  placeDockLine();
  placeGameLine();
});

/* ---------------- boot ---------------- */

async function boot() {
  $("#case-list").innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  $("#inventory").innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;

  setView("cases");
  setGame("upgrade");

  try {
    await refresh();
    await refreshHistory();
    requestAnimationFrame(() => {
      placeDockLine();
      placeGameLine();
    });
  } catch (err) {
    $(".views").innerHTML = `
      <div class="fatal">
        ${icon("user")}
        <div class="fatal-title">${err.message}</div>
        <div class="fatal-sub">Открой приложение из Telegram-бота.<br />Данные проверяются по подписи initData.</div>
      </div>
    `;
  }
}

boot();
