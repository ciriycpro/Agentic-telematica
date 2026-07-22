import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ═══════════════════════════════════════════════════════════════
   «Сотрудники в деле» — демо-стенд агентного слоя (часть 7 ТЗ) v2
   Реплей дня · воронка CEP с правилами · оркестрация агентов
   Ф2/Ф3 · панель владельца (бейджи источников) · живой аналитик
   ═══════════════════════════════════════════════════════════════ */

const C = {
  bg: "#0B1524", panel: "#12203A", panel2: "#0E1A30", line: "#1E3252",
  text: "#D9E4F5", dim: "#7E90AC", cyan: "#38BDF8", red: "#E30611",
  amber: "#F5B02E", green: "#34D399", lbs: "#8B93B0",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };
const fmtT = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
const rub = (v) => v.toLocaleString("ru-RU") + " ₽";

/* ── Маршруты (waypoints: [мин, x, y]) ── */
const ROUTES = {
  m47: { name: "Машина 47", src: "GPS/CAN", color: C.cyan,
    pts: [[420,60,430],[540,250,300],[615,318,208],[660,318,208],[840,330,215],[900,330,215],[1000,455,120],[1140,455,120]] },
  br6: { name: "Бригада 6", src: "GPS", color: C.green,
    pts: [[420,80,120],[470,150,150],[700,150,150],[800,340,395],[1140,340,395]] },
  serg: { name: "Сергей", src: "GPS", color: C.amber,
    pts: [[420,520,430],[560,455,120],[640,455,120],[760,250,300],[900,150,150],[1140,150,150]] },
  kov: { name: "Ковалёв", src: "LBS ±900 м", color: C.lbs, lbs: true,
    pts: [[420,120,330],[700,150,310],[1140,135,320]] },
};
const ZONES = [
  { x: 110, y: 110, w: 90, h: 80, name: "Объект-3" },
  { x: 415, y: 82, w: 88, h: 76, name: "Склад-7" },
  { x: 295, y: 172, w: 78, h: 72, name: "АЗС «Веста»" },
  { x: 300, y: 358, w: 90, h: 74, name: "Объект-9" },
];

/* фоновый парк: остальной срез компании, без событий */
const BG = Array.from({ length: 14 }, (_, i) => {
  const seed = i * 137;
  const pts = Array.from({ length: 5 }, (_, j) => [420 + j * 180, 40 + ((seed * (j + 3)) % 520), 30 + ((seed * (j + 7) * 13) % 420)]);
  return { pts, lbs: i % 4 === 0, c: i % 4 === 0 ? "#5A6478" : ["#2E6E8E", "#2F7D63", "#7A6A3A"][i % 3] };
});
const posAt = (r, t) => {
  const p = r.pts;
  if (t <= p[0][0]) return [p[0][1], p[0][2]];
  for (let i = 0; i < p.length - 1; i++) {
    const [t1, x1, y1] = p[i], [t2, x2, y2] = p[i + 1];
    if (t >= t1 && t <= t2) { const k = (t - t1) / (t2 - t1 || 1); return [x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]; }
  }
  const L = p[p.length - 1]; return [L[1], L[2]];
};

/* ── Сценарий дня: 19 CEP-событий ──
   toolKey: call|sms|card|reassign|read ; wh: webhook в 1С/CRM */
const SCRIPT = [
  { t: 462, src: "GPS", cls: 1, who: "Машина 47", agent: "инцидентов", toolKey: "card", wh: true,
    rule: "GEO_EXIT: выезд из полигона «База»",
    title: "Выезд с базы", ctx: "Смена 07:00–19:00 (1С:ЗУП), маршрутный лист №112",
    tool: "Статус в ленту + webhook", result: "Статус «в рейсе» ушёл в 1С заказчика" },
  { t: 470, src: "GPS", cls: 1, who: "Бригада 6", agent: "инцидентов", toolKey: "card", wh: true,
    rule: "GEO_ENTER: вход в полигон «Объект-3»",
    title: "Вход в геозону «Объект-3»", ctx: "Плановая задача №203, окно смены 08:00–17:00",
    tool: "Карточка + статус задачи", result: "Статус «на объекте» записан через MCP→шина→XML" },
  { t: 488, src: "Голос", cls: 1, who: "Бригада 6", agent: "инцидентов", toolKey: "card",
    rule: "TASK_CONFIRMED_VOICE: подтверждение голосом распознано",
    title: "Задача №203 подтверждена голосом", ctx: "ASR: «бригада шесть, приступили» — 4 сек",
    tool: "Карточка", result: "Диспетчеру не звонили — подтверждение пришло само" },
  { t: 545, src: "XML API", cls: 2, who: "Наряд №197 (Сергей)", agent: "инцидентов", toolKey: "sms", wh: true, whitelist: true,
    rule: "ETA_SENT: назначение → расчёт прибытия",
    title: "ETA клиенту: мастер будет к 09:20", ctx: "Клиент наряда №197; канал — SMS в сети оператора",
    tool: "SMS клиенту заказчика", action: "SMS: «Ваш мастер будет к 09:20»",
    result: "Окно ожидания сужено с «9–18» до конкретного времени (П8)",
    smsText: "Здравствуйте! Ваш мастер Сергей будет к 09:20." },
  { t: 570, src: "GPS", cls: 2, who: "Сергей", agent: "инцидентов", toolKey: "sms", wh: true, whitelist: true, 
    rule: "TASK_CLOSED_VOICE: голосовой отчёт ∧ фото-акт",
    title: "Голосовой отчёт: наряд №197 закрыт", ctx: "ASR: «кондиционер установлен, объект принял, расход по норме» + фото чека (мультимодальная LLM)",
    tool: "SMS клиенту заказчика", action: "SMS: «Работы завершены»",
    result: "Клиент уведомлён без участия монтажника; 40 сек вместо 15 мин формы (П9)",
    smsText: "Работы по наряду №197 завершены. Спасибо, что выбрали нас!" },
  { t: 615, src: "GPS", cls: 1, who: "Машина 47", agent: "инцидентов", toolKey: "card",
    rule: "IDLE_STOP: стоянка > 30 мин ∧ вне графика",
    title: "Стоянка 35 мин у АЗС «Веста»", ctx: "Вне графика заправок; двигатель выключен",
    tool: "Карточка (контекст копится)", result: "Связана с последующими топливными событиями" },
  { t: 640, src: "XML API", cls: "3A", who: "Задача №207", agent: "диспетчеризации", toolKey: "reassign", wh: true,
    rule: "TASK_ASSIGN_NEAREST: новая заявка ∧ есть свободный в 5 км",
    title: "Новая заявка → назначение по местоположению", ctx: "Кандидат: Сергей — 1,8 км, свободен, навык совпадает; SLA нет",
    tool: "Назначение (MCP→шина→XML)", action: "Задача №207 → Сергей + ETA-SMS клиенту",
    result: "Рутинное назначение типа А — без диспетчера" },
  { t: 662, src: "LBS", cls: 1, gate: true, who: "Ковалёв", agent: "инцидентов", toolKey: "card",
    rule: "LBS_LOW_CONF: источник LBS → actionable=false",
    title: "Не покидал район с начала смены", ctx: "Точность ±900 м — гипотеза, не факт",
    tool: "Только карточка, пометка «низкая точность»", result: "Автодействия запрещены политикой качества данных (П5)" },
  { t: 700, src: "GPS", cls: 1, who: "Сергей", agent: "инцидентов", toolKey: "sms", wh: true,
    rule: "ETA_SHIFT: прогноз прибытия сдвинулся > 10 мин",
    title: "ETA-сдвиг: пробка на маршруте", ctx: "Прогноз +15 мин к задаче №207",
    tool: "SMS-обновление клиенту", result: "Клиент предупреждён о сдвиге сам — без звонка в офис заказчика",
    smsText: "Небольшая задержка: мастер будет к 12:05. Приносим извинения." },
  { t: 730, src: "GPS", cls: 1, who: "Бригада 6", agent: "инцидентов", toolKey: "card",
    rule: "IDLE_STOP: обеденная стоянка в окне 12:00–13:00",
    title: "Стоянка: обеденное окно", ctx: "Внутри регламентного окна (RAG: правила заказчика)",
    tool: "Карточка без алерта", result: "Регламентная пауза — шум не создаётся" },
  { t: 795, src: "XML API", cls: 1, who: "Задача №203", agent: "инцидентов", toolKey: "card", wh: true,
    rule: "STATUS_CLOSED: акт получен ∧ геозона покинута",
    title: "Задача №203 закрыта", ctx: "Фото-акт + выход из геозоны «Объект-3»",
    tool: "Статус + webhook", result: "Закрытие упало в CRM заказчика само (П10)" },
  { t: 842, src: "CAN", cls: 2, who: "Машина 47", agent: "инцидентов", toolKey: "call", wh: true, whitelist: true, money: 2600,
    rule: "SUSPECTED_FUEL_SIPHON: топливо −40л/10мин ∧ двигатель OFF ∧ вне графика заправок",
    title: "Топливо −40 л за 10 мин, двигатель выключен", ctx: "История: стоянка у АЗС в 10:15; заправка по графику завтра; регламент: подтверждение у водителя (RAG)",
    tool: "Исходящий звонок (TTS→ASR) · порог класса 2: precision ≥95% + confirmation-gate", action: "Автоинформатор (уведомление о записи) → закрытый вопрос: «подтвердите: заправка — да или нет?» → верификация ответа (да/нет + DTMF-дубль 1/2); при неуверенном ASR — не коммит, эскалация диспетчеру",
    result: "Ответ: «нет, не заправлялся» (уверенность ASR 0.97, подтверждён DTMF) → эскалация: задача диспетчеру + доказательная база (класс 4 — вывод за человеком). Сотруднику отправлен код апелляции: ответ на SMS оспаривает инцидент" },
  { t: 870, src: "GPS", cls: 1, who: "Машина 47", agent: "инцидентов", toolKey: "card",
    rule: "GEO_EXIT: покинула точку инцидента",
    title: "Продолжила маршрут", ctx: "Инцидент 14:02 в работе у диспетчера",
    tool: "Карточка", result: "Трек сохранён в доказательную базу" },
  { t: 920, src: "XML API", cls: "3A", who: "Задача №218", agent: "диспетчеризации", toolKey: "reassign", wh: true, money: 5600,
    rule: "TASK_ORPHANED: исполнитель снят ∧ задача активна",
    title: "Исполнитель снят (больничный), задача без исполнителя", ctx: "Кандидат: Иванов — 3,1 км, свободен до 17:00, навык «монтаж»; жёсткого SLA нет",
    tool: "Переназначение (MCP→шина→XML)", action: "Задача №218 → Иванов; ETA-SMS клиенту: «мастер будет к 16:10»",
    result: "Выезд сохранён (маржа 600 ₽) + неустойка 5 000 ₽ не наступила",
    smsText: "Здравствуйте! Ваш мастер Иванов будет к 16:10." },
  { t: 1005, src: "CRM", cls: "3B", who: "Задача №305", agent: "диспетчеризации", toolKey: "reassign",
    rule: "SLA_CONFLICT_3B: флаг жёсткого SLA ∧ признак претензии CRM",
    title: "Срыв окна: жёсткий SLA + флаг конфликта", ctx: "Критерий 3Б сработал на входе — автономия запрещена всегда",
    tool: "Предложение + таймаут 10 мин → эскалация", action: "Рекомендация: Петров (4 км) ИЛИ сдвиг окна по согласованию",
    result: "Ситуативное решение — за человеком (тип Б: «разгрузка, не замена»)" },
  { t: 968, src: "SMS", cls: 1, who: "Иванов (сотрудник)", agent: "инцидентов", toolKey: "card", disputed: true,
    rule: "APPEAL_RECEIVED: ответ сотрудника на уведомление класса 2/3",
    title: "⚖ Апелляция: оспорено переназначение №218", ctx: "Иванов ответил на SMS: «уже взял смежную заявку рядом, ехать нелогично» — канал апелляции доступен с любого телефона",
    tool: "Статус disputed + блок автодействий", result: "Следующее автодействие по задаче №218 заблокировано до человека-арбитра; возражение в доказательной базе; доля disputed видна владельцу" },
  { t: 1040, src: "Голос", cls: 1, who: "Бригада 6", agent: "инцидентов", toolKey: "card", wh: true,
    rule: "TASK_CLOSED_VOICE: голосовой отчёт принят",
    title: "Голосовой отчёт: Объект-9 завершён", ctx: "ASR: «объект девять закрыт, замечаний нет»",
    tool: "Статус + webhook", result: "Акт в CRM, клиенту SMS о завершении" },
  { t: 1080, src: "GPS", cls: 1, who: "Машина 47", agent: "инцидентов", toolKey: "card",
    rule: "SPEEDING: 94 км/ч в зоне 60",
    title: "Превышение скорости: 94/60", ctx: "Скоринг вождения — детерминированный слой (без LLM)",
    tool: "Карточка + балл водителя", result: "−0,4 к рейтингу; в отчёт владельцу" },
  { t: 1100, src: "GPS", cls: 1, who: "Сергей", agent: "инцидентов", toolKey: "card", wh: true,
    rule: "STATUS_CLOSED: задача №207 закрыта",
    title: "Задача №207 закрыта, ETA финальное отправлено", ctx: "Фото-акт принят",
    tool: "Статус + webhook", result: "День Сергея: 3 наряда, 0 минут на формы" },
  { t: 1122, src: "GPS", cls: 1, who: "Машина 47", agent: "инцидентов", toolKey: "card",
    rule: "GEO_ENTER: возврат в полигон «База»",
    title: "Возврат на базу", ctx: "Одометр за день: 182 км",
    tool: "Карточка", result: "Суточный отчёт владельцу собирается автоматически" },
];

const CLS_LABEL = { 0: "класс 0 · чтение", 1: "класс 1 · обратимое", 2: "класс 2 · контакт", "3A": "класс 3А · рутинное переназначение", "3B": "класс 3Б · ситуативное", 4: "класс 4 · человек" };
const SRC_COLOR = { GPS: C.cyan, CAN: C.green, LBS: C.lbs, "XML API": C.amber, CRM: C.amber, "Голос": C.green };
const TOOLS = [
  { k: "call", label: "Звонок (TTS/ASR)" },
  { k: "sms", label: "SMS / ETA" },
  { k: "card", label: "Карточка / задача" },
  { k: "reassign", label: "Переназначение (шина)" },
  { k: "read", label: "Read-запрос к БД" },
];
const AGENTS = [
  { key: "инцидентов", name: "Агент-инцидентов", cls: "классы 1–2", ok: ["card", "call", "sms"], no: ["reassign"], y: 12 },
  { key: "диспетчеризации", name: "Агент-диспетчеризации", cls: "классы 1, 3А", ok: ["reassign", "sms"], no: ["call", "card"], y: 72 },
  { key: "аналитик", name: "Агент-аналитик", cls: "класс 0", ok: ["read"], no: ["call", "sms", "card", "reassign"], y: 132 },
];

/* ═══════════════ Индикатор квоты демо-режима ═══════════════ */
function AnalystQuota() {
  const [n, setN] = React.useState(() => {
    try { return parseInt(localStorage.getItem("agentic-telematica-analyst-count") || "0", 10) || 0; }
    catch (e) { return 0; }
  });
  React.useEffect(() => {
    const tick = () => {
      try {
        const v = parseInt(localStorage.getItem("agentic-telematica-analyst-count") || "0", 10) || 0;
        setN((prev) => prev !== v ? v : prev);
      } catch (e) {}
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, 5 - n);
  const color = left === 0 ? "#E30611" : left <= 2 ? "#F5B02E" : "#7E90AC";
  return (
    <span style={{ color, whiteSpace: "nowrap", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      Демо-режим: {n}/5 вопросов {left > 0 ? `· осталось ${left}` : "· лимит"}
    </span>
  );
}

/* ═══════════════ Компонент ═══════════════ */
export default function DemoStand() {
  const [sim, setSim] = useState(430);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(4);
  const [phase, setPhase] = useState("F3");
  const [events, setEvents] = useState([]);
  const [sel, setSel] = useState(null);
  const [hoverEv, setHoverEv] = useState(null);
  const [tab, setTab] = useState("ops");
  const firedRef = useRef(new Set());
  const [chat, setChat] = useState([{ role: "assistant", content: "Я — агент-аналитик стенда (класс 0, только чтение). Спросите про день: «что случилось с машиной 47?», «сколько предотвратили?», «сколько ETA-уведомлений ушло клиентам?»" }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const chatEnd = useRef(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setSim((s) => (s >= 1140 ? 1140 : s + speed)), 260);
    return () => clearInterval(id);
  }, [playing, speed]);

  useEffect(() => {
    SCRIPT.forEach((ev) => {
      if (sim >= ev.t && !firedRef.current.has(ev.t)) {
        firedRef.current.add(ev.t);
        const TRUSTED = ["GPS", "CAN", "XML API", "Голос"]; // локационная доказуемость или учётная система (док. 4.3)
        const autonomous = phase === "F3" && ((ev.cls === 2 && ev.whitelist && TRUSTED.includes(ev.src)) || ev.cls === "3A");
        const passive = ev.cls === 1 || ev.gate;
        const status = passive ? "info" : autonomous ? "auto" : "pending";
        setEvents((es) => [{ ...ev, id: ev.t, status, resolveT: status === "auto" ? ev.t + 1 : null, deadline: ev.cls === "3B" ? ev.t + 10 : null }, ...es]);
        if (status === "pending" || ev.t === 842) setSel(ev.t);
      }
    });
  }, [sim, phase]);

  useEffect(() => {
    setEvents((es) => es.map((e) => (e.status === "pending" && e.deadline && sim >= e.deadline ? { ...e, status: "escalated", resolveT: e.deadline } : e)));
  }, [sim]);

  const decide = (id, ok) => setEvents((es) => es.map((e) => (e.id === id ? { ...e, status: ok ? "accepted" : "rejected", resolveT: sim } : e)));

  const M = useMemo(() => {
    const acted = events.filter((e) => ["auto", "accepted"].includes(e.status));
    const withReact = acted.filter((e) => e.resolveT != null);
    const avg = withReact.length ? withReact.reduce((s, e) => s + (e.resolveT - e.t), 0) / withReact.length : null;
    const decisive = events.filter((e) => e.status !== "info");
    const autoFirst = decisive.length ? Math.round((events.filter((e) => e.status === "auto").length / decisive.length) * 100) : 0;
    const money = acted.reduce((s, e) => s + (e.money || 0), 0);
    const eta = acted.filter((e) => (e.rule || "").startsWith("ETA") || (e.action || "").includes("ETA")).length;
    const disputed = events.filter((e) => e.disputed).length;
    return { avg, autoFirst, money, eta, disputed, decisions: acted.length };
  }, [events]);

  /* воронка: точки за день для профиля 300 сотр + 100 машин ≈ 576 000 */
  const points = Math.max(0, Math.round(576000 * (Math.min(sim, 1140) - 420) / 720));
  const activeEv = useMemo(() => events.find((e) => e.resolveT != null && ["auto", "accepted"].includes(e.status) && sim - e.resolveT < 6) || null, [events, sim]);
  const focusEv = hoverEv || (sel != null ? events.find((e) => e.id === sel) : null) || activeEv;

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);

  const ask = useCallback(async () => {
    if (!inp.trim() || busy) return;
    const q = inp.trim(); setInp(""); setBusy(true);
    const hist = [...chat, { role: "user", content: q }];
    setChat(hist);
    const state = {
      время: fmtT(sim), режим: phase === "F3" ? "Ф3 автодействия" : "Ф2 рекомендации",
      события: events.map((e) => ({ t: fmtT(e.t), кто: e.who, что: e.title, правило_CEP: e.rule, источник: e.src, класс: String(e.cls), статус: e.status, действие: e.action || e.tool, итог: e.result, деньги: e.money || 0, webhook: !!e.wh })),
      метрики: { среднее_время_событие_действие_мин: M.avg ? +M.avg.toFixed(1) : null, доля_авто_проц: M.autoFirst, предотвращено_руб: M.money, ETA_уведомлений: M.eta, точек_обработано_CEP: points },
    };
    // ── Лимит демо-режима: 5 вопросов на сессию (localStorage)
    const LIMIT = 5;
    const CONTACT = "hello@ciriycpro.online";
    let count = 0;
    try { count = parseInt(localStorage.getItem("agentic-telematica-analyst-count") || "0", 10) || 0; } catch (e) {}
    if (count >= LIMIT) {
      setChat((c) => [...c, { role: "assistant", content:
        `Демо-лимит вопросов исчерпан (${LIMIT} из ${LIMIT}). Это ознакомительный стенд — для полного доступа и подробностей по кейсу свяжитесь: ${CONTACT}` }]);
      setBusy(false); return;
    }

    // ── Системный промпт: роль, контекст кейса, срез демо-дня, границы
    const SYSTEM = [
      "Ты — «Цифровой аналитик», встроенный ассистент диспетчера в демо-стенде «Цифровой диспетчер» (кейс пересборки легаси-телематики контроля разъездных сотрудников в агентную решающую систему для мобильного оператора).",
      "Твой класс полномочий — 0 (только чтение и анализ). Ты НЕ выполняешь действий: не звонишь, не переназначаешь задачи, не создаёшь карточки инцидентов. Это делают другие агенты (агент-инцидентов, агент-диспетчеризации).",
      "Стенд показывает реплей рабочего дня одного заказчика (парк ~300 сотрудников / 100 машин / 2 диспетчера). CEP-слой в реальном времени детектирует композитные события (топливо × стоянка × геозона × смена), а ты объясняешь диспетчеру, что происходит и что уже сделано.",
      "В проде модель — компактная мультимодальная LLM (~9B, 1×GPU среднего класса). Реальный аналитик берёт данные MCP read-only инструментами (ClickHouse / интеграционная шина), а не выдумывает.",
      "ПРАВИЛА ОТВЕТА:",
      "1) Отвечай ТОЛЬКО по данным демо-дня, которые переданы ниже. Не выдумывай события, машины, суммы, которых нет в данных.",
      "2) Если вопрос вне контекста стенда (общие темы, погода, программирование, личные советы) — коротко откажись: «Я аналитик демо-стенда, отвечаю только по данным парка. Спросите про инциденты, топливо, задачи, SLA, метрики дня».",
      "3) Отвечай кратко, по-русски: 3–5 предложений максимум. Если уместна короткая таблица или список — используй, но без лишних заголовков.",
      "4) Термины держи из документа кейса: «класс инцидента», «источник данных (GPS/CAN/LBS/XML API)», «Ф2/Ф3», «MCP→шина→XML», «ETA клиенту», «сирота-задача», «предотвращено ₽».",
      "5) Числа только те, что есть в данных ниже. Проценты и суммы — из блока «метрики».",
      "",
      "── ДАННЫЕ ДЕМО-ДНЯ (актуальный срез) ──",
      JSON.stringify(state, null, 0),
    ].join("\n");

    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ключ засвечен в клиенте намеренно (демо-режим, лимит 5 вопросов через localStorage)
          "Authorization": "Bearer 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",
          "HTTP-Referer": "https://ciriycpro.online/AI-telematica-demo/",
          "X-Title": "Agentic Telematica Demo",
        },
        body: JSON.stringify({
          model: "anthropic/claude-haiku-4.5",
          max_tokens: 600,
          temperature: 0.3,
          messages: [
            { role: "system", content: SYSTEM },
            ...hist.map(({ role, content }) => ({ role, content })),
          ],
        }),
      });
      const d = await r.json();
      const txt = (d?.choices?.[0]?.message?.content || "").trim() || "Нет ответа от модели.";
      setChat((c) => [...c, { role: "assistant", content: txt }]);
      try { localStorage.setItem("agentic-telematica-analyst-count", String(count + 1)); } catch (e) {}
    } catch { setChat((c) => [...c, { role: "assistant", content: "Ошибка запроса к модели. Попробуйте ещё раз." }]); }
    setBusy(false);
  }, [inp, busy, chat, events, sim, phase, M, points]);

  const monthMoney = M.money * 22;

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&family=IBM+Plex+Mono:wght@400;600&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        .pulse { animation: pulse 1.6s ease-in-out infinite }
        @keyframes dash { to { stroke-dashoffset: -28; } }
        .flow { stroke-dasharray: 7 7; animation: dash 1s linear infinite; }
        ::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-thumb{background:#22385c;border-radius:4px}
        button{cursor:pointer}
      `}</style>

      {/* ── Шапка ── */}
      <div style={{ borderBottom: `1px solid ${C.line}`, padding: "12px 20px", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>ЦИФРОВОЙ <span style={{ color: C.red }}>ДИСПЕТЧЕР</span></div>
          <div style={{ fontSize: 11, color: C.dim }}>демо агентного слоя для мобильного оператора · реплей дня</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 20, alignItems: "center" }}>
          <Metric label="СОБЫТИЕ → ДЕЙСТВИЕ" value={M.avg == null ? "—" : `${M.avg.toFixed(0)} мин`} note="было: до следующего отчёта" hot={M.avg != null && M.avg <= 5} />
          <Metric label="ПЕРВОЕ ДЕЙСТВИЕ БЕЗ ЧЕЛОВЕКА" value={`${M.autoFirst}%`} note="было: 0%" hot={M.autoFirst >= 60} />
          <Metric label="ДЕНЬГИ ДНЯ: ВЗЫСКАНИЕ + СОХРАНЕНО" value={rub(M.money)} note="2 600 ₽ ко взысканию · 5 600 ₽ сохранено" hot={M.money > 0} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", ...mono }}>
          <span style={{ fontSize: 22, fontWeight: 600, color: C.cyan }}>{fmtT(sim)}</span>
          <Btn onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</Btn>
          <Btn onClick={() => setSpeed((s) => (s === 4 ? 10 : s === 10 ? 1 : 4))}>{speed === 1 ? "×250" : speed === 4 ? "×1000" : "×2500"}</Btn>
          <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
            {["F2", "F3"].map((p) => (
              <button key={p} onClick={() => setPhase(p)} style={{ padding: "7px 14px", border: "none", fontWeight: 700, fontSize: 12, background: phase === p ? (p === "F3" ? C.red : C.cyan) : "transparent", color: phase === p ? "#fff" : C.dim }}>
                {p === "F2" ? "Ф2 · рекомендации" : "Ф3 · автодействия"}
              </button>
            ))}
          </div>
          {phase === "F3" && <Btn onClick={() => setPhase("F2")} title="kill-switch: вернуть Ф2" style={{ borderColor: C.red, color: C.red }}>KILL-SWITCH</Btn>}
        </div>
      </div>

      {/* ── Вкладки ── */}
      <div style={{ display: "flex", gap: 6, padding: "10px 20px 0" }}>
        {[["ops", "Оперативный контур"], ["under", "Агентный слой (под капотом)"], ["matrix", "Полномочия"], ["owner", "Панель владельца"], ["chat", "Аналитик (живой)"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", borderRadius: "10px 10px 0 0", border: `1px solid ${C.line}`, borderBottom: "none", background: tab === k ? C.panel : "transparent", color: tab === k ? C.text : C.dim, fontWeight: 700, fontSize: 13 }}>{l}</button>
        ))}
      </div>

      {/* ══ ОПЕРАТИВНЫЙ КОНТУР ══ */}
      {tab === "ops" && (
        <div style={{ padding: "0 20px 8px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 1.05fr) minmax(400px, 1fr)", gap: 14 }}>
            {/* Карта */}
            <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "0 12px 12px 12px", padding: 12 }}>
              <PanelTitle>Карта · <span style={{ color: C.cyan }}>GPS</span> / <span style={{ color: C.green }}>CAN</span> / <span style={{ color: C.lbs }}>LBS (гейт)</span></PanelTitle>
              <svg viewBox="0 0 600 480" style={{ width: "100%", background: C.panel2, borderRadius: 10 }}>
                {[80, 200, 320, 440].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="#16294a" strokeWidth="10" />)}
                {[120, 300, 470].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="480" stroke="#16294a" strokeWidth="10" />)}
                {ZONES.map((z) => (
                  <g key={z.name}>
                    <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="10" fill="rgba(56,189,248,.06)" stroke="#2a4a7a" strokeDasharray="5 4" />
                    <text x={z.x + 6} y={z.y + 16} fill={C.dim} fontSize="11" style={mono}>{z.name}</text>
                  </g>
                ))}
                {/* фоновый парк: остальные объекты среза */}
                {BG.map((b, i) => {
                  const [x, y] = posAt(b, sim);
                  return (
                    <g key={"bg" + i} opacity="0.55">
                      {b.lbs && <circle cx={x} cy={y} r="26" fill="rgba(139,147,176,.06)" stroke="#3a466040" strokeDasharray="2 5" />}
                      <circle cx={x} cy={y} r="3.5" fill={b.c} />
                    </g>
                  );
                })}
                {/* хвосты треков главных сущностей: последние 40 мин */}
                {Object.entries(ROUTES).map(([k, r]) =>
                  Array.from({ length: 8 }, (_, j) => {
                    const tt = sim - (j + 1) * 5;
                    if (tt < 420) return null;
                    const [x, y] = posAt(r, tt);
                    return <circle key={k + "t" + j} cx={x} cy={y} r="2" fill={r.color} opacity={0.35 - j * 0.04} />;
                  })
                )}
                {Object.entries(ROUTES).map(([k, r]) => {
                  const [x, y] = posAt(r, sim);
                  return (
                    <g key={k}>
                      {r.lbs && <circle cx={x} cy={y} r="52" fill="rgba(139,147,176,.10)" stroke={C.lbs} strokeDasharray="3 5" />}
                      <circle cx={x} cy={y} r={r.lbs ? 6 : 8} fill={r.color} className={k === "m47" && sim >= 842 && sim < 875 ? "pulse" : ""} />
                      <text x={x + 11} y={y + 4} fill={r.color} fontSize="11" fontWeight="700">{r.name}</text>
                    </g>
                  );
                })}
                {activeEv && (() => {
                  const r = activeEv.who.includes("47") ? ROUTES.m47 : activeEv.who.includes("Серг") || activeEv.who.includes("197") || activeEv.who.includes("207") ? ROUTES.serg : activeEv.who.includes("Бригада") ? ROUTES.br6 : null;
                  if (!r) return null; const [x, y] = posAt(r, Math.min(sim, activeEv.t));
                  return <text x={x - 6} y={y - 12} fontSize="16" fill={C.red} className="pulse">★</text>;
                })()}
              </svg>
            </div>

            {/* Воронка + Лента */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Воронка слоёв */}
              <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
                <PanelTitle>Трёхслойка: детерминизм → LLM в контрактах → инструменты</PanelTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr 24px 1fr", alignItems: "center", gap: 4 }}>
                  <Funnel n={points.toLocaleString("ru-RU")} l="точек за день" s="детерминированный слой · без LLM" c={C.cyan} />
                  <Arrow />
                  <Funnel n={events.length} l="событий CEP" s={focusEv ? "" : "правила, не нейросеть"} c={C.amber} hi={!!focusEv} />
                  <Arrow />
                  <Funnel n={M.decisions} l="решений агентов" s="LLM внутри контрактов" c={C.red} />
                </div>
                <div style={{ minHeight: 30, marginTop: 6, fontSize: 11.5, ...mono, color: focusEv ? C.amber : C.dim, background: C.panel2, border: `1px dashed ${focusEv ? C.amber : C.line}`, borderRadius: 8, padding: "6px 10px" }}>
                  {focusEv ? `▸ ${focusEv.rule}` : "наведите на событие в ленте — увидите сработавшее правило CEP"}
                </div>
              </div>

              {/* Лента */}
              <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, height: 430, overflowY: "auto" }}>
                <PanelTitle>Лента: CEP-событие → решение агента → действие</PanelTitle>
                {events.length === 0 && <div style={{ color: C.dim, fontSize: 13, padding: 20 }}>День начинается. Первое событие — 07:42.</div>}
                {events.map((e) => <EventCard key={e.id} e={e} open={sel === e.id} onOpen={() => setSel(sel === e.id ? null : e.id)} onHover={setHoverEv} phase={phase} decide={decide} sim={sim} />)}
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ══ АГЕНТНЫЙ СЛОЙ: ПОД КАПОТОМ ══ */}
      {tab === "under" && <UnderHood events={events} activeEv={activeEv} sim={sim} />}

      {/* ══ ПОЛНОМОЧИЯ ══ */}
      {tab === "matrix" && <MatrixTab phase={phase} />}

      {/* ══ ПАНЕЛЬ ВЛАДЕЛЬЦА ══ */}
      {tab === "owner" && (
        <div style={{ padding: "14px 20px", maxWidth: 1020 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "0 12px 12px 12px", padding: 18 }}>
            <PanelTitle>Язык денег, не точек на карте (П11) · «тест зеркала»</PanelTitle>
            <div style={{ fontSize: 12, color: C.amber, border: `1px dashed ${C.amber}`, borderRadius: 8, padding: "6px 10px", marginBottom: 12 }}>
              Демо-день: 4 объекта из 300, срез для показа механики. День намеренно насыщен: 2 редких инцидента (слив, сирота-задача) из 19 событий попали в один день — экстраполировать демо-день на месяц нельзя, средние цифры смотрите в карточке «из ROI-модели».
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(215px,1fr))", gap: 12 }}>
              <Money big label="Деньги демо-дня" v={rub(M.money)} sub="2 600 ₽ — доказательная база ко взысканию (ст. 248 ТК: приказом в пределах среднего заработка — класс Б) + 5 600 ₽ сохранено (класс А)" cls="А/Б · размечено честно" srcTag="demo" />
              <Money big label="Средний день компании (300 чел, 100 маш)" v="≈ 5 700 ₽/день" sub="базовый эффект 1,5 млн ₽/год (ROI +30…+92% вилкой) ÷ 262 раб. дня; верхний сценарий +346% — рост выручки, независимо не подтверждён; демо-день инцидентами НЕ средний" cls="А" srcTag="roi" />
              <Money label="Реакция: событие → действие" v={M.avg == null ? "—" : `${M.avg.toFixed(0)} мин`} sub="было: до следующего отчёта" cls="тест зеркала" srcTag="demo" />
              <Money label="Первое действие без человека" v={`${M.autoFirst}%`} sub="было: 0%" cls="тест зеркала" srcTag="demo" />
              <Money label="Время диспетчера (модель)" v="≈ 468 тыс. ₽/год" sub="30% рутины одного диспетчера; при росте парка — отложенный найм до 1,56 млн/год" cls="Б · расчётные" srcTag="roi" />
              <Money label="ETA-уведомлений за демо-день (по 4 объектам)" v={String(M.eta)} sub="клиенты заказчика видят время, а не «с 9 до 18»" cls="В · направленный эффект" srcTag="demo" />
              <Money label="Апелляций сотрудников (disputed)" v={String(M.disputed)} sub="канал оспаривания с любого телефона; автодействия по спорным — заблокированы до арбитра" cls="предохранитель · анти-саботаж" srcTag="demo" />
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: C.dim }}>
              Классы: <b style={{ color: C.text }}>А</b> — живые рубли, <b style={{ color: C.text }}>Б</b> — избежанные затраты, <b style={{ color: C.text }}>В</b> — реальны, но в ROI не считаем. Источники цифр размечены на каждой карточке.
            </div>
          </div>
        </div>
      )}

      {/* ══ АНАЛИТИК ══ */}
      {tab === "chat" && (
        <div style={{ padding: "14px 20px", maxWidth: 860 }}>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "0 12px 12px 12px", padding: 14, display: "flex", flexDirection: "column", height: 560 }}>
            <PanelTitle>Агент-аналитик · класс 0 · write-инструментов нет физически</PanelTitle>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 2px", display: "flex", flexDirection: "column", gap: 10 }}>
              {chat.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "82%", background: m.role === "user" ? "#1C3B66" : C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{m.content}</div>
              ))}
              {busy && <div style={{ color: C.dim, fontSize: 13 }} className="pulse">аналитик думает…</div>}
              <div ref={chatEnd} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={inp} onChange={(e) => setInp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Например: сколько сегодня предотвратили и на чём?"
                style={{ flex: 1, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 14, outline: "none" }} />
              <Btn onClick={ask} style={{ background: C.red, borderColor: C.red, color: "#fff", padding: "10px 18px" }}>Спросить</Btn>
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 8, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span>
                Аналитик отвечает живым ИИ-инференсом на срезе данных демо-дня. В проде — компактная модель (~9B) в контуре оператора, данные аналитик берёт сам MCP read-only инструментами; платформа model-agnostic: смена модели — параметр, не переделка.
              </span>
              <AnalystQuota />
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "6px 20px 16px", fontSize: 11, color: C.dim, borderTop: `1px solid ${C.line}`, marginTop: 8 }}>
        Демо-стенд агентной диспетчеризации разъездных сотрудников поверх легаси-телематики мобильного оператора · методология — см. документ решения, ч. 4 · Артём Якшин, СИРИУС ПРО
      </div>
    </div>
  );
}

const Arrow = () => <div style={{ color: "#7E90AC", fontSize: 18, textAlign: "center" }}>→</div>;
const Funnel = ({ n, l, s, c, hi }) => (
  <div style={{ background: "#0E1A30", border: `1px solid ${hi ? c : "#1E3252"}`, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
    <div style={{ ...mono, fontSize: 18, fontWeight: 600, color: c }}>{n}</div>
    <div style={{ fontSize: 10.5, color: "#D9E4F5", fontWeight: 700 }}>{l}</div>
    {s ? <div style={{ fontSize: 9, color: "#7E90AC" }}>{s}</div> : null}
  </div>
);

/* ── Живая матрица полномочий ── */
function MatrixTab({ phase }) {
  const rows = [
    ["0 · чтение/анализ", "авто", "авто", "авто", false],
    ["1 · обратимые внутренние", "—", "авто", "авто", false],
    ["2 · контакт с человеком", "—", "предлагает", "авто · precision ≥95% + confirmation-gate · белый список · GPS/CAN · ≤2/день · апелляция", false],
    ["3А · рутинные переназначения", "—", "предлагает + обоснование", "авто вне жёсткого SLA", false],
    ["3Б · ситуативные", "—", "предлагает", "ЧЕЛОВЕК · предложение + таймаут → эскалация", true],
    ["4 · кадровые/юридические выводы", "—", "материалы по запросу", "ЧЕЛОВЕК · только доказательная база", true],
  ];
  const cols = ["Ф1", "Ф2", "Ф3"];
  const activeCol = phase === "F2" ? 1 : 2;
  return (
    <div style={{ padding: "14px 20px", maxWidth: 980 }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "0 12px 12px 12px", padding: 18 }}>
        <PanelTitle>Матрица полномочий · класс действия × фаза · текущий режим: <span style={{ color: phase === "F3" ? C.red : C.cyan }}>{phase === "F3" ? "Ф3" : "Ф2"}</span></PanelTitle>
        <div style={{ display: "grid", gridTemplateColumns: "260px repeat(3, 1fr)", gap: 6, fontSize: 12.5 }}>
          <div />
          {cols.map((c, i) => (
            <div key={c} style={{ textAlign: "center", fontWeight: 800, padding: 8, borderRadius: 8, background: i === activeCol ? (phase === "F3" ? "rgba(227,6,17,.15)" : "rgba(56,189,248,.12)") : "transparent", color: i === activeCol ? C.text : C.dim, border: i === activeCol ? `1px solid ${phase === "F3" ? C.red : C.cyan}` : "1px solid transparent" }}>{c}</div>
          ))}
          {rows.map(([name, f1, f2, f3, human]) => (
            <React.Fragment key={name}>
              <div style={{ padding: "10px 8px", fontWeight: 700, color: human ? C.red : C.text, borderTop: `1px solid ${C.line}` }}>{name}</div>
              {[f1, f2, f3].map((v, i) => (
                <div key={i} style={{ padding: "10px 8px", textAlign: "center", borderTop: `1px solid ${C.line}`, background: i === activeCol ? "rgba(255,255,255,.02)" : "transparent", color: human && i === 2 ? C.red : v === "—" ? C.dim : C.text, fontWeight: v.startsWith("авто") ? 700 : 400 }}>{v}</div>
              ))}
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: C.dim }}>
          Критерий 3А/3Б определяется на входе, машинно: флаг жёсткого SLA (CRM) ∨ признак конфликта ∨ ситуативный тип из справочника ∨ таблица исключений заказчика. Красные строки автономию не получают никогда — «разгрузка диспетчера, не замена».
        </div>
      </div>
    </div>
  );
}

/* ── мелкие компоненты ── */
const Metric = ({ label, value, note, hot }) => (
  <div style={{ textAlign: "right" }}>
    <div style={{ fontSize: 10, color: C.dim, letterSpacing: 1 }}>{label}</div>
    <div style={{ ...mono, fontSize: 20, fontWeight: 600, color: hot ? C.red : C.text }}>{value}</div>
    <div style={{ fontSize: 9.5, color: C.dim }}>{note}</div>
  </div>
);
const Btn = ({ children, style, ...p }) => (
  <button {...p} style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 12, ...style }}>{children}</button>
);
const PanelTitle = ({ children }) => <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: .6, color: "#7E90AC", textTransform: "uppercase", marginBottom: 8 }}>{children}</div>;
const SRC_BADGES = { demo: { t: "ИЗ ДЕМО", bg: "#38BDF8", solid: true }, calc: { t: "ПРОИЗВОДНАЯ ×22", bg: "#38BDF8", solid: false }, roi: { t: "ИЗ ROI-МОДЕЛИ, НЕ ИЗ ДЕМО", bg: "#7E90AC", solid: false } };
const Money = ({ label, v, sub, cls, big, srcTag }) => {
  const b = SRC_BADGES[srcTag];
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: C.dim }}>{label}</div>
      <div style={{ ...mono, fontSize: big ? 26 : 20, fontWeight: 600, color: big ? C.red : C.text, margin: "4px 0" }}>{v}</div>
      <div style={{ fontSize: 11, color: C.dim }}>{sub}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.cyan }}>{cls}</span>
        {b && <span style={{ fontSize: 9, ...mono, padding: "2px 6px", borderRadius: 4, border: `1px solid ${b.bg}`, background: b.solid ? b.bg : "transparent", color: b.solid ? "#08131f" : b.bg }}>{b.t}</span>}
      </div>
    </div>
  );
};

function EventCard({ e, open, onOpen, onHover, phase, decide, sim }) {
  const border = e.status === "pending" ? C.amber : e.status === "auto" ? C.red : e.status === "accepted" ? C.green : e.status === "escalated" ? C.red : C.line;
  const badge = { info: ["зафиксировано", C.dim], auto: ["★ автодействие", C.red], pending: [phase === "F2" ? "ждёт вердикта (Ф2)" : "ждёт человека", C.amber], accepted: ["принято диспетчером", C.green], rejected: ["отклонено", C.dim], escalated: ["эскалация по таймауту", C.red] }[e.status];
  return (
    <div onClick={onOpen} onMouseEnter={() => onHover(e)} onMouseLeave={() => onHover(null)}
      style={{ border: `1px solid ${border}`, borderLeft: `4px solid ${SRC_COLOR[e.src] || C.dim}`, borderRadius: 10, padding: "9px 12px", marginBottom: 9, background: C.panel2, cursor: "pointer" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...mono, color: C.cyan, fontSize: 12 }}>{fmtT(e.t)}</span>
        <span style={{ fontSize: 10, ...mono, color: SRC_COLOR[e.src] || C.dim, border: `1px solid ${SRC_COLOR[e.src] || C.dim}`, borderRadius: 5, padding: "1px 6px" }}>{e.src}</span>
        <b style={{ fontSize: 13 }}>{e.who}: {e.title}</b>
        <span style={{ marginLeft: "auto", fontSize: 11, color: badge[1], fontWeight: 700, whiteSpace: "nowrap" }}>{badge[0]}</span>
        {e.wh && <span style={{ fontSize: 9.5, ...mono, color: C.dim, border: `1px dashed ${C.dim}`, borderRadius: 5, padding: "1px 6px" }}>↗ webhook: CRM/1С</span>}
        {e.disputed && <span style={{ fontSize: 9.5, ...mono, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 5, padding: "1px 6px" }}>⚖ disputed · автодействия заблокированы</span>}
      </div>
      {open && (
        <div style={{ marginTop: 10, fontSize: 12.5, display: "grid", gap: 6 }}>
          <Row k="Правило CEP" v={e.rule} mono />
          <Row k="Контекст (RAG/история)" v={e.ctx} />
          <Row k="Агент" v={`агент-${e.agent} · ${CLS_LABEL[e.cls]}`} />
          <Row k="Инструмент" v={e.tool} />
          {e.action && <Row k="Действие" v={e.action} hot />}
          {e.toolKey === "call" && <Row k="Бюджет беспокойства" v="контакт 1 из 2 за день по этому сотруднику (лимит матрицы, Ф3)" />}
          <Row k="Итог" v={e.result} />
          {e.smsText && ["auto", "accepted"].includes(e.status) && (
            <div style={{ maxWidth: 320, background: "#173B2E", border: `1px solid ${C.green}`, borderRadius: "12px 12px 12px 3px", padding: "8px 12px", fontSize: 12.5, color: "#D7F5E7" }}>
              <div style={{ fontSize: 9, color: C.green, ...mono, marginBottom: 3 }}>SMS → клиент заказчика</div>
              {e.smsText}
            </div>
          )}
          {e.gate && <div style={{ color: C.lbs, fontSize: 12 }}>⛔ ГЕЙТ качества данных: LBS-событие остановлено до агентов — только карточка (П5).</div>}
          {e.status === "pending" && (
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <Btn onClick={(ev) => { ev.stopPropagation(); decide(e.id, true); }} style={{ background: C.green, borderColor: C.green, color: "#08131f" }}>Принять</Btn>
              <Btn onClick={(ev) => { ev.stopPropagation(); decide(e.id, false); }}>Отклонить</Btn>
              {e.deadline && <span style={{ ...mono, fontSize: 11, color: C.amber, alignSelf: "center" }}>эскалация через {Math.max(0, e.deadline - sim)} мин (3Б)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const Row = ({ k, v, hot, mono: mo }) => (
  <div style={{ display: "flex", gap: 8 }}>
    <span style={{ color: "#7E90AC", minWidth: 150, fontSize: 11.5 }}>{k}</span>
    <span style={{ color: hot ? "#E30611" : "#D9E4F5", fontWeight: hot ? 700 : 400, ...(mo ? { fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#F5B02E" } : {}) }}>{v}</span>
  </div>
);

/* ═══════════ ПОД КАПОТОМ: живая архитектура агентного слоя ═══════════
   Узлы = подсистемы из документа (4.2). По событию пошагово бежит пакет:
   ЧТО (payload) · ОТКУДА→КУДА (подсистемы) · ЧЕРЕЗ ЧТО (интерфейс). */

const NODES = {
  telem:    { x: 30,  y: 40,  w: 165, h: 58, t: "Legacy-телематика", s: "точки · CAN · геозоны" },
  kafka:    { x: 240, y: 40,  w: 130, h: 58, t: "Kafka", s: "topic telemetry.*" },
  cep:      { x: 415, y: 40,  w: 160, h: 58, t: "CEP-слой", s: "Kafka Streams · правила" },
  ai:       { x: 330, y: 200, w: 190, h: 62, t: "Агент-инцидентов", s: "классы 1–2 · ✓зв ✓SMS ✓карт ✕переназн" },
  ad:       { x: 330, y: 285, w: 190, h: 62, t: "Агент-диспетчеризации", s: "классы 1, 3А · ✓переназн ✓ETA-SMS(клиенту) ✕звонок ✕карточка" },
  aa:       { x: 330, y: 370, w: 190, h: 62, t: "Агент-аналитик", s: "класс 0 · ✓read ✕все write" },
  llm:      { x: 560, y: 200, w: 165, h: 56, t: "LLM ~9B (мультимод.)", s: "инференс · 1×GPU" },
  q:        { x: 560, y: 372, w: 165, h: 56, t: "Очередь инференса", s: "async · приоритет по классу" },
  rag:      { x: 560, y: 285, w: 165, h: 56, t: "RAG · Milvus", s: "гибридный поиск 0.7/0.3" },
  cfg:      { x: 605, y: 40,  w: 155, h: 58, t: "Конфиг правил", s: "Redis · пороги per-клиент · без рестарта" },
  audio:    { x: 790, y: 40,  w: 180, h: 56, t: "Речевая платформа", s: "gRPC · TTS / ASR" },
  orch:     { x: 790, y: 120, w: 180, h: 56, t: "Оркестратор сценариев", s: "Temporal-класс · durable state" },
  octapi:   { x: 790, y: 200, w: 180, h: 56, t: "Интеграционная шина", s: "MCP Streamable HTTP" },
  xmlapi:   { x: 790, y: 290, w: 180, h: 50, t: "Legacy XML API", s: "контракт 10 500 компаний" },
  smsc:     { x: 790, y: 372, w: 180, h: 50, t: "SMS-центр сети", s: "SMPP · любой GSM" },
  crm:      { x: 790, y: 454, w: 180, h: 50, t: "1С / CRM заказчика", s: "приёмник webhooks" },
  disp:     { x: 60,  y: 285, w: 175, h: 56, t: "Панель диспетчера", s: "лента · вердикты · kill-switch" },
  ch:       { x: 60,  y: 400, w: 175, h: 56, t: "ClickHouse", s: "OTEL-trace · агрегаты" },
};
const nc = (id, side) => {
  const n = NODES[id];
  if (side === "r") return [n.x + n.w, n.y + n.h / 2];
  if (side === "l") return [n.x, n.y + n.h / 2];
  if (side === "b") return [n.x + n.w / 2, n.y + n.h];
  if (side === "t") return [n.x + n.w / 2, n.y];
  return [n.x + n.w / 2, n.y + n.h / 2];
};
const hop = (f, t, payload, iface) => ({ f, t, payload, iface });

/* Маршруты пакетов по типам событий */
const flowFor = (e) => {
  if (!e) return [];
  if (e.gate) return [
    hop("telem", "kafka", "LBS-точки: Ковалёв, ±900 м", "Kafka · telemetry.lbs"),
    hop("kafka", "cep", "поток координат", "Kafka Streams"),
    hop("cep", "disp", "карточка «низкая точность» — ГЕЙТ: actionable=false, к агентам НЕ идёт", "UI · лента"),
    hop("cep", "ch", "trace: событие остановлено гейтом", "OTLP"),
  ];
  const F = {
    call: [
      hop("telem", "kafka", "CAN-кадр: топливо −40 л / 10 мин, зажигание OFF", "Kafka · telemetry.can"),
      hop("kafka", "cep", "поток кадров", "Kafka Streams"),
      hop("cfg", "cep", "пороги/правила этого клиента (горячее чтение, без рестарта стримов)", "Redis · конфиг"),
      hop("cep", "ai", "событие SUSPECTED_FUEL_SIPHON + атрибут источника CAN", "HTTP · Custom Event"),
      hop("rag", "ai", "регламент заказчика: «слив → подтвердить у водителя»", "Milvus · гибридный поиск"),
      hop("ai", "q", "запрос решения: async, приоритет класса 2 (синхронно с ретраями было бы 5–8 с)", "очередь · async"),
      hop("q", "llm", "инференс: стандартизованный промпт (стабильный префикс → prompt cache)", "vLLM-класс · KV-cache"),
      hop("llm", "ai", "решение из меню: звонок (confirmation-gate)", "callback"),
      hop("ai", "orch", "старт сценария звонка: состояние «ждём ответ водителя» сохранено", "Temporal · durable"),
      hop("orch", "audio", "команда: исходящий звонок, текст вопроса", "gRPC · TTS"),
      hop("audio", "orch", "ASR-ответ спустя минуты: «не заправлялся» (недозвон/таймаут — тоже ветки сценария)", "gRPC · ASR"),
      hop("orch", "ai", "результат сценария → продолжение решения", "callback"),
      hop("ai", "octapi", "tool: создать задачу диспетчеру + доказательная база", "MCP · Streamable HTTP"),
      hop("octapi", "xmlapi", "создание задачи в учётной системе", "XML · B2B API"),
      hop("octapi", "crm", "инцидент → системы заказчика", "HTTP · webhook"),
      hop("ai", "ch", "полный trace решения", "OTLP"),
    ],
    reassign: [
      hop("xmlapi", "octapi", "TASK_ORPHANED: исполнитель снят, задача активна", "XML · B2B API"),
      hop("octapi", "kafka", "событие задачи", "Kafka · tasks"),
      hop("kafka", "cep", "поток событий", "Kafka Streams"),
      hop("cfg", "cep", "правила клиента: критерий 3А/3Б, радиусы (Redis, горячее)", "Redis · конфиг"),
      hop("cep", "ad", "TASK_ORPHANED + критерий 3А/3Б: SLA-флага нет → 3А", "HTTP · Custom Event"),
      hop("rag", "ad", "регламент назначения: радиус, навык, окно смены (1С:ЗУП)", "Milvus · гибридный поиск"),
      hop("ad", "q", "запрос решения (async, класс 3А)", "очередь · async"),
      hop("q", "llm", "кандидаты → выбор: Иванов, 3,1 км, свободен", "vLLM-класс · KV-cache"),
      hop("llm", "ad", "решение из меню: переназначить + ETA-SMS", "callback"),
      hop("ad", "octapi", "tool: reassign задача №218 → Иванов", "MCP · Streamable HTTP"),
      hop("octapi", "xmlapi", "переназначение в учётной системе", "XML · B2B API"),
      hop("ad", "smsc", "ETA-SMS клиенту заказчика: «мастер будет к 16:10» (по факту переназначения — tool разрешён для 3А)", "SMPP · сеть оператора"),
      hop("octapi", "crm", "статус задачи → CRM заказчика", "HTTP · webhook"),
      hop("ad", "ch", "trace решения", "OTLP"),
    ],
    sms: [
      hop("telem", "kafka", "GPS + голосовой отчёт (закрытие наряда)", "Kafka · telemetry.gps"),
      hop("kafka", "cep", "поток", "Kafka Streams"),
      hop("cep", "ai", "событие " + ((e.rule || "").split(":")[0] || "ETA_SENT"), "HTTP · Custom Event"),
      hop("ai", "smsc", "SMS клиенту заказчика: " + (e.smsText || e.action || ""), "SMPP · сеть оператора"),
      hop("octapi", "crm", "статус → CRM заказчика", "HTTP · webhook"),
      hop("ai", "ch", "trace", "OTLP"),
    ],
    card: [
      hop("telem", "kafka", "точки/статусы: " + e.title, "Kafka · telemetry.*"),
      hop("kafka", "cep", "поток", "Kafka Streams"),
      hop("cep", "ai", "событие " + ((e.rule || "").split(":")[0] || ""), "HTTP · Custom Event"),
      hop("ai", "disp", "карточка в ленту диспетчера", "UI · лента"),
      ...(e.wh ? [hop("octapi", "crm", "статус → 1С/CRM заказчика", "HTTP · webhook")] : []),
      hop("ai", "ch", "trace", "OTLP"),
    ],
    read: [
      hop("disp", "aa", "вопрос на естественном языке", "чат · UI"),
      hop("aa", "ch", "read-only запрос агрегатов", "SQL · только чтение"),
      hop("aa", "disp", "ответ таблицей/сводкой", "чат · UI"),
    ],
  };
  return F[e.toolKey] || F.card;
};

function UnderHood({ events, activeEv, sim }) {
  const acted = events.filter((ev) => ev.status !== "info" || ev.gate || ev.wh);
  const [pick, setPick] = React.useState(null);      // id выбранного события
  const [follow, setFollow] = React.useState(true);  // авто-следование за живым исполнением
  const [step, setStep] = React.useState(0);
  const ev = (follow && activeEv) ? activeEv : (events.find((x) => x.id === pick) || activeEv || events[0] || null);
  const flow = React.useMemo(() => flowFor(ev), [ev && ev.id]);

  React.useEffect(() => { setStep(0); }, [ev && ev.id]);
  React.useEffect(() => {
    if (!flow.length) return;
    const id = setInterval(() => setStep((s) => (s < flow.length ? s + 1 : s)), 900);
    return () => clearInterval(id);
  }, [flow]);

  const activeNodes = new Set(flow.slice(0, step).flatMap((h) => [h.f, h.t]));
  const cur = step > 0 ? flow[step - 1] : null;

  return (
    <div style={{ padding: "0 20px 14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(560px, 1.45fr) minmax(330px, 1fr)", gap: 14 }}>
        {/* Схема */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: "0 12px 12px 12px", padding: 12 }}>
          <PanelTitle>
            Под капотом: подсистема → подсистема · payload · интерфейс
            {ev && <span style={{ color: C.red }}> · {fmtT(ev.t)} {ev.title}</span>}
          </PanelTitle>
          <svg viewBox="0 0 1000 520" style={{ width: "100%", background: C.panel2, borderRadius: 10 }}>
            {/* рамка платформы */}
            <rect x="315" y="170" width="425" height="285" rx="12" fill="rgba(56,189,248,.03)" stroke="#24406b" strokeDasharray="6 5" />
            <text x="325" y="188" fill={C.dim} fontSize="10" style={mono}>АГЕНТНАЯ ПЛАТФОРМА ОПЕРАТОРА · мультитенантный контур</text>
            {/* пройденные рёбра */}
            {flow.slice(0, step).map((h, i) => {
              const last = i === step - 1;
              const [x1, y1] = nc(h.f, "c"), [x2, y2] = nc(h.t, "c");
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 24;
              return (
                <g key={i}>
                  <path d={`M${x1},${y1} Q ${mx},${my} ${x2},${y2}`} fill="none"
                    stroke={last ? C.red : "#41608f"} strokeWidth={last ? 2.4 : 1.4}
                    className={last ? "flow" : ""} markerEnd="" />
                  {last && <circle r="5" fill={C.red} className="pulse"><animateMotion dur="0.9s" repeatCount="indefinite" path={`M${x1},${y1} Q ${mx},${my} ${x2},${y2}`} /></circle>}
                  {last && <text x={mx} y={my + 8} textAnchor="middle" fill={C.amber} fontSize="10" style={mono}>{h.iface}</text>}
                </g>
              );
            })}
            {/* узлы */}
            {Object.entries(NODES).map(([id, n]) => {
              const on = activeNodes.has(id);
              const isCur = cur && (cur.f === id || cur.t === id);
              return (
                <g key={id} opacity={ev ? (on ? 1 : 0.38) : 1}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="10" fill={C.panel}
                    stroke={isCur ? C.red : on ? C.cyan : C.line} strokeWidth={isCur ? 2 : 1}
                    className={isCur ? "pulse" : ""} />
                  <text x={n.x + 10} y={n.y + 22} fill={on || !ev ? C.text : C.dim} fontSize="12" fontWeight="800">{n.t}</text>
                  <text x={n.x + 10} y={n.y + 38} fill={C.dim} fontSize="9" style={mono}>{n.s}</text>
                </g>
              );
            })}
          </svg>
          <div style={{ minHeight: 34, marginTop: 8, fontSize: 12.5, background: C.panel2, border: `1px dashed ${cur ? C.red : C.line}`, borderRadius: 8, padding: "7px 10px" }}>
            {cur
              ? <span><b style={{ color: C.red }}>{NODES[cur.f].t} → {NODES[cur.t].t}</b> · <span style={{ color: C.text }}>{cur.payload}</span> · <span style={{ ...mono, color: C.amber, fontSize: 11.5 }}>{cur.iface}</span></span>
              : <span style={{ color: C.dim }}>выберите событие справа или дождитесь живого автодействия в реплее</span>}
          </div>
        </div>

        {/* Журнал шагов + выбор события */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", maxHeight: 640 }}>
          <PanelTitle>Журнал потока данных</PanelTitle>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={pick ?? ""} onChange={(e) => { setPick(e.target.value ? +e.target.value : null); setFollow(false); }}
              style={{ flex: 1, minWidth: 180, background: C.panel2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px", fontSize: 12 }}>
              <option value="">— событие из ленты —</option>
              {acted.map((x) => <option key={x.id} value={x.id}>{fmtT(x.t)} · {x.who}: {x.title}</option>)}
            </select>
            <Btn onClick={() => setStep(0)}>▶ повторить</Btn>
            <label style={{ fontSize: 11, color: follow ? C.cyan : C.dim, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> следовать за live
            </label>
          </div>
          <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 6, alignContent: "start" }}>
            {flow.map((h, i) => {
              const done = i < step, now = i === step - 1;
              return (
                <div key={i} style={{ border: `1px solid ${now ? C.red : done ? C.line : "transparent"}`, opacity: done ? 1 : .35, background: C.panel2, borderRadius: 8, padding: "7px 9px", fontSize: 11.5 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span style={{ ...mono, color: now ? C.red : C.dim }}>{String(i + 1).padStart(2, "0")}</span>
                    <b style={{ color: C.text }}>{NODES[h.f].t} → {NODES[h.t].t}</b>
                  </div>
                  <div style={{ color: C.dim, margin: "3px 0 2px" }}>{h.payload}</div>
                  <span style={{ ...mono, fontSize: 10, color: C.amber, border: `1px solid ${C.amber}44`, borderRadius: 4, padding: "1px 5px" }}>{h.iface}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
