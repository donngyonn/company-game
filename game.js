'use strict';

// ============================================================
// 廃墟再生株式会社 - ゲームロジック v3
// ============================================================

const SAVE_KEY       = 'haikisei_v3';
const SLOT_KEYS      = [null, 'haikisei_slot_1', 'haikisei_slot_2', 'haikisei_slot_3'];
const MAX_OFFLINE_SEC = 4 * 3600;

// ---- 時間定数 ----
const WEEK_SEC     = 30;   // 1ゲーム週 = 30リアル秒
const MONTH_WEEKS  = 4;    // 1ヶ月 = 4週
const YEAR_MONTHS  = 12;   // 1期 = 12ヶ月
const YEAR_WEEKS   = MONTH_WEEKS * YEAR_MONTHS;  // 48週
const EXPENSE_WEEK = MONTH_WEEKS; // 毎月末（4週ごと）に引き落とし

const LOAN_RATE = 1.05;  // 借入利率（元本×5%一括、12回均等返済）

// ---- 事務所レベル ----
// level 0 = 事務所なし（初期状態）
const OFFICE_LEVELS = [
  { level: 0, name: '事務所なし',       capacity: 0,   upgradeCost: 0 },
  { level: 1, name: '自宅・リモート',   capacity: 5,   upgradeCost: 500000 },
  { level: 2, name: 'レンタルオフィス', capacity: 15,  upgradeCost: 3000000 },
  { level: 3, name: 'ミニオフィス',     capacity: 40,  upgradeCost: 30000000 },
  { level: 4, name: '中規模オフィス',   capacity: 120, upgradeCost: 300000000 },
  { level: 5, name: '大規模オフィス',   capacity: 400, upgradeCost: 3000000000 },
  { level: 6, name: '本社ビル',         capacity: 1500, upgradeCost: 30000000000 },
];

// ---- 部署定義 ----
// 営業部のみ雇用型。フリーランスは weekly 採用。global のみ直接収益。
const DEPT_DEFS = [
  {
    id: 'sales',
    name: '営業部（クライアント・要員担当）',
    emoji: '💼',
    desc: '社員がクライアントを開拓し、フリーランスを採用・配置。月給35〜40万＋社保15%が固定費。売上は生まない。',
    incomePerSec: 0,
    marginRate: null, salaryLabel: '人件費',
    monthlySalary: 375000,   // 35〜40万の平均
    insuranceRate: 0.15,
    recruitChance: 0.40,     // 週40%でFLエンジニア1名採用
    baseCost: 700000, costMult: 1.22, unlockAt: 0,
  },
  {
    id: 'hr',
    name: '人材育成部',
    emoji: '🎓',
    desc: 'スキルUP支援でFL採用確率＋3%/人。採用コスト削減も（−3%/人）',
    incomePerSec: 0, marginRate: null, salaryLabel: null, monthlySalary: null,
    baseCost: 200000000, costMult: 1.20, unlockAt: 300000000,
    special: 'costReduction', specialValue: 0.03,
  },
  {
    id: 'finance',
    name: '財務部',
    emoji: '📊',
    desc: '単価交渉・CF管理で全体収益UP（＋8%/人）',
    incomePerSec: 0, marginRate: null, salaryLabel: null, monthlySalary: null,
    baseCost: 2000000000, costMult: 1.20, unlockAt: 5000000000,
    special: 'multiplier', specialValue: 0.08,
  },
  {
    id: 'strategy',
    name: '経営企画部',
    emoji: '🎯',
    desc: 'SES戦略立案・新規事業開拓（＋15%/人）',
    incomePerSec: 0, marginRate: null, salaryLabel: null, monthlySalary: null,
    baseCost: 25000000000, costMult: 1.20, unlockAt: 40000000000,
    special: 'multiplier', specialValue: 0.15,
  },
  {
    id: 'global',
    name: 'グローバル部',
    emoji: '🌏',
    desc: '海外大型SES案件を直接受注。圧倒的な直接収益源。',
    incomePerSec: 5000000,
    marginRate: 0.80, salaryLabel: '人件費', monthlySalary: null,
    baseCost: 10000000000, costMult: 1.15, unlockAt: 30000000000,
  },
];

// ---- 週次イベント定義 ----
const WEEK_EVENTS = [
  {
    type: 'good', emoji: '📢', title: '大手SIerから大型案件受注！',
    desc: '年間契約の大型プロジェクトが成立。臨時売上が一括入金。',
    effect: s => { const b = getTotalIncome() * 300; s.money += b; s.totalEarned += b; return `臨時収益 ＋${yen(b)}`; },
  },
  {
    type: 'good', emoji: '🏆', title: 'ITサービス企業アワード受賞！',
    desc: '業界誌に特集掲載。クライアントからの問い合わせが急増！',
    effect: s => { s.eventBoost = { mult: 2.0, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×2.0（2週間）'; },
  },
  {
    type: 'good', emoji: '🤝', title: '大手コンサルと業務提携！',
    desc: '高単価プロジェクトへのアクセスを確保。収益が継続的にUP。',
    effect: s => { s.eventBoost = { mult: 1.5, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×1.5（3週間）'; },
  },
  {
    type: 'good', emoji: '📈', title: 'エンジニア単価が市場上昇！',
    desc: 'IT人材不足が深刻化。業界全体でエンジニア単価がUP。',
    effect: s => { s.eventBoost = { mult: 1.3, expiresAt: s.elapsedSeconds + WEEK_SEC * 4 }; return '収益×1.3（4週間）'; },
  },
  {
    type: 'good', emoji: '💡', title: 'DX案件で引き合いが急増！',
    desc: 'クライアントのDX推進需要が爆発。臨時売上が発生。',
    effect: s => { const b = getTotalIncome() * 500; s.money += b; s.totalEarned += b; return `臨時収益 ＋${yen(b)}`; },
  },
  {
    type: 'good', emoji: '🎓', title: 'IT人材育成補助金を獲得！',
    desc: '国の助成金が採択され、研修費が大幅に補助されました。',
    effect: s => { const b = getTotalIncome() * 200; s.money += b; s.totalEarned += b; return `補助金 ＋${yen(b)}`; },
  },
  {
    type: 'bad', emoji: '😱', title: 'フリーランスが競合に引き抜かれた！',
    desc: '高待遇オファーにより稼働中のエンジニアが突然退場した。',
    effect: s => {
      const flFavor = (s.morale && s.morale.freelance) || 70;
      const departChance = Math.max(0.05, Math.min(0.80, 0.40 - (flFavor - 70) * 0.006));
      const loss = Math.random() < departChance ? Math.min(s.freelancers || 0, 1) : 0;
      if (loss > 0 && s.flData && s.flData.length > 0) s.flData.pop();
      s.freelancers = Math.max(0, (s.freelancers || 0) - loss);
      return loss > 0 ? `フリーランス ${loss}名が離脱` : 'FL引き抜き未遂（被害なし）';
    },
  },
  {
    type: 'bad', emoji: '💥', title: '取引先クライアントが倒産！',
    desc: '主要取引先が業績不振で倒産。売掛金が全額回収不能に。',
    effect: s => { const loss = Math.floor(s.money * 0.25); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の損失`; },
  },
  {
    type: 'bad', emoji: '⚠️', title: '労務コンプライアンス違反が発覚！',
    desc: '労務管理の不備が露呈。是正対応と弁護士費用が発生。',
    effect: s => { const loss = Math.floor(s.money * 0.15); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の対応費`; },
  },
  {
    type: 'bad', emoji: '📉', title: 'クライアントがIT予算を凍結！',
    desc: '景気悪化でIT投資が全社的に凍結。収益が大幅に落ち込む。',
    effect: s => { s.eventBoost = { mult: 0.7, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×0.7（2週間）'; },
  },
  {
    type: 'bad', emoji: '🔥', title: 'サーバー障害で業務が停止！',
    desc: 'システム障害が発生し、24時間業務が停止。緊急対応費用が発生。',
    effect: s => { const loss = Math.floor(s.money * 0.10); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の損害`; },
  },
  {
    type: 'bad', emoji: '😤', title: '案件トラブルでクレーム多発！',
    desc: '常駐エンジニアのトラブルが重なり、クライアントとの関係が悪化。',
    effect: s => { s.eventBoost = { mult: 0.8, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×0.8（3週間）'; },
  },
];

// ---- アップグレード定義 ----
// dept: 'sales'     → deptMults['sales'] に乗算（採用確率に反映）
// dept: 'freelancer'→ state.freelancerMult に乗算（FL単価に反映）
const UPGRADE_DEFS = [
  // 営業部：採用確率UP
  { id: 'u_crm',      name: '案件管理システム導入',    emoji: '🗂️', cost: 5000000,     dept: 'sales',      mult: 1.5, req: { sales: 1 } },
  { id: 'u_network',  name: '人材エージェント連携',    emoji: '🤝', cost: 80000000,    dept: 'sales',      mult: 1.5, req: { sales: 5 } },
  { id: 'u_brand',    name: 'SESブランド確立',         emoji: '🏆', cost: 800000000,   dept: 'sales',      mult: 2,   req: { sales: 15 } },
  { id: 'u_vision',   name: 'ビジョン採用戦略',        emoji: '🚩', cost: 8000000000,  dept: 'sales',      mult: 2,   req: { sales: 30 } },
  // フリーランス単価UP
  { id: 'u_skill',    name: '単価交渉マニュアル整備',  emoji: '📋', cost: 8000000,     dept: 'freelancer', mult: 1.5, req: { sales: 1 } },
  { id: 'u_niche',    name: 'ニッチ技術特化戦略',      emoji: '🔬', cost: 100000000,   dept: 'freelancer', mult: 1.5, req: { sales: 5 } },
  { id: 'u_prime',    name: 'プライム案件専任体制',    emoji: '🥇', cost: 1000000000,  dept: 'freelancer', mult: 2,   req: { sales: 10 } },
  { id: 'u_aidev',    name: 'AI・クラウド専門化',      emoji: '🤖', cost: 10000000000, dept: 'freelancer', mult: 2,   req: { sales: 20 } },
  // 管理部門
  { id: 'u_training', name: '体系的研修プログラム',    emoji: '📚', cost: 500000000,   dept: 'hr',         mult: 2,   req: { hr: 1 } },
  { id: 'u_accounting',name:'単価交渉強化マニュアル',  emoji: '💹', cost: 8000000000,  dept: 'finance',    mult: 2,   req: { finance: 1 } },
  { id: 'u_mba',      name: '中長期SES戦略策定',       emoji: '🗺️', cost: 80000000000, dept: 'strategy',   mult: 2,   req: { strategy: 1 } },
  { id: 'u_english',  name: '英語対応スキルシート整備', emoji: '🗣️', cost: 500000000000, dept: 'global',   mult: 2,   req: { global: 1 } },
];

// ---- 会社ステージ ----
const STAGE_DEFS = [
  { threshold: 0,            name: '廃墟SES',      emoji: '🏚️', color: '#6c757d', desc: 'エンジニア0人・案件0件。ボロオフィスで途方に暮れている。' },
  { threshold: 3000000,      name: '個人事業',     emoji: '🧑‍💻', color: '#8B7355', desc: '社長自らが客先に常駐中。「社長＝全戦力」のSES。' },
  { threshold: 30000000,     name: '零細SES',      emoji: '🏢', color: '#2E8B57', desc: 'FL数名でなんとか回している。案件は口コミのみ。' },
  { threshold: 300000000,    name: '中小SES',      emoji: '🏬', color: '#2166AC', desc: '案件が安定してきた。協力会社との取引も始まった。' },
  { threshold: 3000000000,   name: '成長SES',      emoji: '🏭', color: '#762A83', desc: '「御社のFL、また来月もお願いします！」が増えてきた。' },
  { threshold: 30000000000,  name: '大手SES',      emoji: '🏙️', color: '#D4A017', desc: 'IT業界誌の特集記事。「IT人材不足を解決する企業」として注目。' },
  { threshold: 60000000000,  name: '上場準備中',   emoji: '📈', color: '#C0392B', desc: '証券会社から打診。「SES業界のリーディングカンパニーとして...」' },
  { threshold: 80000000000,  name: '上場直前',     emoji: '🚀', color: '#E67E22', desc: '東証プライム申請完了！ITサービス企業として全国注目。' },
];

const IPO_THRESHOLD  = 100000000000; // 1000億
const CORP_TAX_RATE  = 0.30;          // 法人税率30%（3月決算）

// ---- ゲームステート ----
let state = {
  money: 10000000,
  totalEarned: 0,
  elapsedSeconds: 0,
  lastTimestamp: Date.now(),
  prestige: 0,
  prestigeMult: 1,
  employees: {},
  upgrades: {},
  deptMults: {},
  deptRevenue: {},
  deptCost: {},
  freelancers: 0,       // フリーランスエンジニア人数
  flData: [],           // FL毎データ [{gross, profitRate}]
  flGrossRevenue: 0,    // FL累計総売上
  officeLevel: 0,       // 事務所レベル (0=なし, 1-6)
  freelancerMult: 1,    // フリーランス単価倍率
  lastEventWeek: 0,
  eventBoost: null,
  lastExpenseWeek: 0,
  lastTaxPeriod: 0,     // 前回法人税を徴収した期
  periodEarned: 0,      // 当期累計収益（3月決算で課税）
  loans: [],
  morale: { ceo: 70, employee: 70, freelance: 70 },
  gameStarted: false,   // 事務所契約後に true
  bankrupt: false,
  weeklyIncomeAccum: 0, // 週中の部署収益累積
  gameSpeed: 1,         // 倍速（1x / 2x / 4x）
  ceoSalary: 500000,    // 社長月次報酬
  reportHistory: [],    // 週次レポート履歴（最大52件）
};

DEPT_DEFS.forEach(d => {
  state.employees[d.id] = 0;
  state.deptMults[d.id] = 1;
  state.deptRevenue[d.id] = 0;
  state.deptCost[d.id] = 0;
});

// ---- 計算系 ----

function getCurrentCapacity() {
  const lvl = state.officeLevel ?? 0;
  const idx = Math.min(lvl, OFFICE_LEVELS.length - 1);
  return OFFICE_LEVELS[idx].capacity;
}

function getTotalPeople() {
  const emp = Object.values(state.employees).reduce((a, b) => a + b, 0);
  return emp + (state.freelancers || 0);
}

function getEmployeeCount() {
  return Object.values(state.employees).reduce((a, b) => a + b, 0);
}

function getMoraleMultiplier() {
  const m = state.morale;
  const avg = (m.ceo + m.employee + m.freelance) / 3;
  return 1 + (avg - 50) * 0.01;
}

function getGlobalMultiplier() {
  let mult = state.prestigeMult;
  DEPT_DEFS.forEach(d => {
    if (d.special === 'multiplier') {
      mult *= 1 + d.specialValue * (state.employees[d.id] || 0);
    }
  });
  mult *= getMoraleMultiplier();
  if (adBoostActive) mult *= 2;
  if (state.eventBoost && state.eventBoost.expiresAt > state.elapsedSeconds) {
    mult *= state.eventBoost.mult;
  } else {
    state.eventBoost = null;
  }
  return mult;
}

function getCostReduction() {
  const hr = DEPT_DEFS.find(d => d.id === 'hr');
  return Math.max(0.1, 1 - hr.specialValue * (state.employees['hr'] || 0));
}

function getRecruitChance() {
  const salesMult = state.deptMults['sales'] || 1;
  const hrBonus   = (state.employees['hr'] || 0) * 0.03;
  return Math.min(0.95, (0.40 + hrBonus) * salesMult);
}

function getDeptIncome(deptId) {
  const def = DEPT_DEFS.find(d => d.id === deptId);
  if (!def || def.special || def.incomePerSec === 0) return 0;
  return def.incomePerSec * (state.employees[deptId] || 0) * (state.deptMults[deptId] || 1);
}

function getFlWeeklyGross() {
  if (!state.flData || state.flData.length === 0) return 0;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  const mult = (state.freelancerMult || 1) * getGlobalMultiplier();
  return state.flData
    .filter(fl => (fl.hiredWeek ?? 0) < currentWeek)
    .reduce((sum, fl) => sum + Math.floor(fl.gross / 4 * mult), 0);
}

function getFlWeeklyIncome() {
  if (!state.flData || state.flData.length === 0) return 0;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  const flFavor = (state.morale && state.morale.freelance) || 70;
  const favorMult = 1 + (flFavor - 70) * 0.002;
  const mult = (state.freelancerMult || 1) * getGlobalMultiplier() * Math.max(0.5, favorMult);
  return state.flData
    .filter(fl => (fl.hiredWeek ?? 0) < currentWeek)
    .reduce((sum, fl) => sum + Math.floor(fl.gross / 4 * fl.profitRate * mult), 0);
}

function getFlWeeklyCost() {
  return getFlWeeklyGross() - getFlWeeklyIncome();
}

function getFlActiveCount() {
  if (!state.flData) return 0;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  return state.flData.filter(fl => (fl.hiredWeek ?? 0) < currentWeek).length;
}

function getFreelancerBaseIncome() {
  return 0;
}

// 表示用週次収益（部署の秒収益×WEEK_SEC + FL週次利益）
function getDisplayWeeklyIncome() {
  const deptPerWeek = getTotalIncome() * WEEK_SEC;
  const flPerWeek = getFlWeeklyIncome();
  return deptPerWeek + flPerWeek;
}

function getTotalIncome() {
  let base = 0;
  DEPT_DEFS.forEach(d => { base += getDeptIncome(d.id); });
  base += getFreelancerBaseIncome();
  return base * getGlobalMultiplier();
}

function getHireCost(deptId) {
  const def = DEPT_DEFS.find(d => d.id === deptId);
  const count = state.employees[deptId] || 0;
  return Math.ceil(def.baseCost * Math.pow(def.costMult, count) * getCostReduction());
}

function getCurrentStageIdx() {
  let idx = 0;
  for (let i = 0; i < STAGE_DEFS.length; i++) {
    if (state.totalEarned >= STAGE_DEFS[i].threshold) idx = i;
  }
  return idx;
}

// ---- 現在の期/月/週を取得 ----
function getGameTime() {
  const totalWeeks = Math.floor((state.elapsedSeconds || 0) / WEEK_SEC);
  const period     = Math.floor(totalWeeks / YEAR_WEEKS) + 1;            // 期
  const monthInPeriod = Math.floor((totalWeeks % YEAR_WEEKS) / MONTH_WEEKS) + 1; // 1-12
  const weekInMonth   = (totalWeeks % MONTH_WEEKS) + 1;                  // 1-4
  const weekProgress  = ((state.elapsedSeconds || 0) % WEEK_SEC) / WEEK_SEC;
  return { period, month: monthInPeriod, week: weekInMonth, totalWeeks, weekProgress };
}

// ---- 数値フォーマット ----
function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '0';
  if (n < 0) return '-' + fmt(-n);
  return Math.floor(n).toLocaleString('ja-JP');
}
const yen = n => '¥' + fmt(n);

// ---- ゲームロジック ----

function hire(deptId) {
  if (getEmployeeCount() >= getCurrentCapacity()) {
    showToast('🏢 事務所が満員です！拡張してください。');
    return;
  }
  const cost = getHireCost(deptId);
  if (state.money < cost) { showToast('資金が足りません！'); return; }
  state.money -= cost;
  state.employees[deptId] = (state.employees[deptId] || 0) + 1;
  state.deptCost[deptId] = (state.deptCost[deptId] || 0) + cost;
  renderDepts();
  renderUpgrades();
}

function upgradeOffice() {
  const cur  = state.officeLevel ?? 0;
  const next = OFFICE_LEVELS[cur + 1];
  if (!next) { showToast('最高レベルに達しています！'); return; }
  if (next.upgradeCost > 0 && state.money < next.upgradeCost) { showToast('資金が足りません！'); return; }
  if (next.upgradeCost > 0) state.money -= next.upgradeCost;
  state.officeLevel = cur + 1;
  if (cur === 0) {
    state.gameStarted = true;
    state.lastTimestamp = Date.now(); // ここから時計スタート
    showToast(`🏢 ${next.name}を開設！ゲームスタート！`);
  } else {
    showToast(`🏢 ${next.name}に移転！収容人数 ${next.capacity}名`);
  }
  renderDepts();
  renderHeader();
}

function buyUpgrade(upgradeId) {
  if (state.upgrades[upgradeId]) return;
  const def = UPGRADE_DEFS.find(u => u.id === upgradeId);
  if (!def || state.money < def.cost) { showToast('資金が足りません！'); return; }
  state.money -= def.cost;
  state.upgrades[upgradeId] = true;
  if (def.dept === 'freelancer') {
    state.freelancerMult = (state.freelancerMult || 1) * def.mult;
    showToast(`✅ ${def.name} 導入！FL単価 ×${def.mult}`);
  } else {
    state.deptMults[def.dept] = (state.deptMults[def.dept] || 1) * def.mult;
    state.deptCost[def.dept]  = (state.deptCost[def.dept]  || 0) + def.cost;
    const deptName = DEPT_DEFS.find(d => d.id === def.dept)?.name || '';
    showToast(`✅ ${def.name} 導入！${deptName} ×${def.mult}`);
  }
  renderAll();
}


function calcIpoFunds() {
  const annualRevenue = getTotalIncome() * 365;
  return Math.floor(annualRevenue * 3 * 0.25);
}

function checkIPO() {
  const modal = document.getElementById('ipo-modal');
  if (state.totalEarned >= IPO_THRESHOLD && !modal.classList.contains('shown')) {
    modal.classList.remove('hidden');
    modal.classList.add('shown');
    const funds = calcIpoFunds();
    const income = getTotalIncome();
    document.getElementById('ipo-count').textContent = state.prestige + 1;
    document.getElementById('ipo-mult').textContent  = (state.prestigeMult * 1.5).toFixed(1);
    document.getElementById('ipo-annual-rev').textContent  = yen(income * 365);
    document.getElementById('ipo-market-cap').textContent  = yen(income * 365 * 3);
    document.getElementById('ipo-funds').textContent       = yen(funds);
  }
}

function doPrestige() {
  const funds = calcIpoFunds();
  state.prestige++;
  state.prestigeMult *= 1.5;
  state.money += funds;
  state.totalEarned = 0;
  state.periodEarned = 0;
  DEPT_DEFS.forEach(d => { state.deptRevenue[d.id] = 0; state.deptCost[d.id] = 0; });
  state.lastTimestamp = Date.now();
  document.getElementById('ipo-modal').classList.add('hidden');
  document.getElementById('ipo-modal').classList.remove('shown');
  renderAll();
  showToast(`🎉 第${state.prestige}回上場！${yen(funds)}を調達。`);
}

// ---- 月次費用 ----

function calcMonthlyExpenses() {
  const totalPeople = getEmployeeCount();
  const hasOffice = (state.officeLevel ?? 0) > 0;
  let rent = 0;
  if (hasOffice) {
    const lvl = state.officeLevel;
    if      (lvl <= 1) rent = 50000;
    else if (lvl <= 2) rent = 200000;
    else if (lvl <= 3) rent = 800000;
    else if (lvl <= 4) rent = 3000000;
    else if (lvl <= 5) rent = 12000000;
    else               rent = 50000000;
  }
  const utilities = hasOffice ? 8000 + totalPeople * 1500 : 0;
  const supplies  = hasOffice ? 3000 + totalPeople * 800  : 0;

  const salesDef      = DEPT_DEFS.find(d => d.id === 'sales');
  const salesCount    = state.employees['sales'] || 0;
  const avgSalary     = salesDef.monthlySalary || 375000;
  const insRate       = salesDef.insuranceRate  || 0.15;
  const salesperson   = salesCount * avgSalary * (1 + insRate);

  const loanPay   = state.loans.reduce((a, l) => a + Math.min(l.remaining, l.monthlyPayment), 0);
  const ceoSalary = state.ceoSalary || 0;

  return {
    rent, utilities, supplies,
    salesperson, loanPay, ceoSalary,
    total: rent + utilities + supplies + salesperson + loanPay + ceoSalary,
  };
}

function showExpenseModal(exp, before) {
  let rows = '';
  if (exp.rent > 0)          rows += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(exp.rent)}</span></div>`;
  if (exp.utilities > 0)     rows += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(exp.utilities)}</span></div>`;
  if (exp.supplies > 0)      rows += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(exp.supplies)}</span></div>`;
  if (exp.salesperson > 0)   rows += `<div class="expense-row"><span>👔 営業部 人件費＋社保</span><span>−${yen(exp.salesperson)}</span></div>`;
  if (exp.ceoSalary > 0)     rows += `<div class="expense-row"><span>🤵 社長報酬</span><span>−${yen(exp.ceoSalary)}</span></div>`;
  if (exp.loanPay > 0)       rows += `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(exp.loanPay)}</span></div>`;

  const after = before - exp.total;
  document.getElementById('expense-detail').innerHTML = rows;
  document.getElementById('expense-total').textContent  = `−${yen(exp.total)}`;
  document.getElementById('expense-before').textContent = yen(before);
  document.getElementById('expense-after').textContent  = yen(after);
  document.getElementById('expense-after').style.color  = after < 0 ? '#f87171' : '#4ade80';
  document.getElementById('expense-modal').classList.remove('hidden');
}

function closeExpenseModal() {
  document.getElementById('expense-modal').classList.add('hidden');
  if (state.money < 0 && !state.bankrupt) {
    triggerBankruptcy();
  }
}

// ---- 週次サマリーモーダル ----

let pendingWeeklyEvent = null;
let weeklyModalShowing = false;
let reportViewIndex = 0;

function _renderWeeklyModalContent(idx) {
  const r = state.reportHistory[idx];
  if (!r) return;
  const total = state.reportHistory.length;

  let html = '';
  html += `<div class="expense-row" style="color:#4ade80"><span>🏢 部署収益</span><span>＋${yen(Math.floor(r.deptIncome))}</span></div>`;
  if (r.flGross > 0) {
    html += `<div class="expense-row" style="color:#4ade80"><span>👨‍💻 FL売上（${r.flCount}名）</span><span>＋${yen(Math.floor(r.flGross))}</span></div>`;
    html += `<div class="expense-row" style="color:#f87171"><span>💸 FL報酬（${r.flCount}名）</span><span>−${yen(Math.floor(r.flCost))}</span></div>`;
    html += `<div class="expense-row" style="color:#93c5fd"><span>💹 FL利益（${r.flCount}名）</span><span>＋${yen(Math.floor(r.flIncome))}</span></div>`;
  }
  const totalIncome = Math.floor(r.deptIncome) + Math.floor(r.flIncome);
  html += `<div class="expense-row" style="font-weight:700;color:#4ade80;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>収入合計</span><span>＋${yen(totalIncome)}</span></div>`;

  if (r.monthlyExp) {
    const mExp = r.monthlyExp;
    html += `<div class="weekly-section-title">📋 月次経費（第${r.monthNum}月末）</div>`;
    if (mExp.rent > 0)        html += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(mExp.rent)}</span></div>`;
    if (mExp.utilities > 0)   html += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(mExp.utilities)}</span></div>`;
    if (mExp.supplies > 0)    html += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(mExp.supplies)}</span></div>`;
    if (mExp.salesperson > 0) html += `<div class="expense-row"><span>👔 営業部 人件費</span><span>−${yen(mExp.salesperson)}</span></div>`;
    if (mExp.ceoSalary > 0)   html += `<div class="expense-row"><span>🤵 社長報酬</span><span>−${yen(mExp.ceoSalary)}</span></div>`;
    if (mExp.loanPay > 0)     html += `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(mExp.loanPay)}</span></div>`;
    html += `<div class="expense-row" style="font-weight:700;color:#f87171;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>支出合計</span><span>−${yen(mExp.total)}</span></div>`;
    const net = totalIncome - mExp.total;
    const netColor = net >= 0 ? '#4ade80' : '#f87171';
    html += `<div class="expense-row" style="font-weight:800;font-size:14px;color:${netColor};margin-top:4px"><span>週次収支</span><span>${net >= 0 ? '＋' : '−'}${yen(Math.abs(net))}</span></div>`;
    html += `<div class="expense-balance" style="margin-top:8px"><div>引落前: ${yen(r.beforeMoney)}</div><div style="color:${r.afterMoney < 0 ? '#f87171' : '#4ade80'}">引落後: ${yen(r.afterMoney)}</div></div>`;
  }

  document.getElementById('weekly-period').textContent = `第${r.period}期 第${r.monthNum}月 第${r.weekInMonth}週`;
  document.getElementById('report-nav-label').textContent = `${idx + 1} / ${total}`;
  document.getElementById('weekly-detail').innerHTML = html;
}

function prevReport() {
  if (reportViewIndex > 0) {
    reportViewIndex--;
    _renderWeeklyModalContent(reportViewIndex);
  }
}

function nextReport() {
  if (reportViewIndex < (state.reportHistory || []).length - 1) {
    reportViewIndex++;
    _renderWeeklyModalContent(reportViewIndex);
  }
}

function showWeeklyModal(weekNum, deptIncome, flWeeklyIncome, flGross, flCost, monthlyExp, beforeMoney) {
  const period      = Math.floor((weekNum - 1) / YEAR_WEEKS) + 1;
  const monthNum    = Math.floor(((weekNum - 1) % YEAR_WEEKS) / MONTH_WEEKS) + 1;
  const weekInMonth = ((weekNum - 1) % MONTH_WEEKS) + 1;
  const flCount     = state.freelancers || 0;

  if (!state.reportHistory) state.reportHistory = [];
  state.reportHistory.push({
    weekNum, period, monthNum, weekInMonth,
    deptIncome, flIncome: flWeeklyIncome, flCount, flGross, flCost,
    monthlyExp, beforeMoney, afterMoney: state.money,
  });
  if (state.reportHistory.length > 52) state.reportHistory.shift();

  reportViewIndex = state.reportHistory.length - 1;
  _renderWeeklyModalContent(reportViewIndex);
  weeklyModalShowing = true;
  document.getElementById('weekly-modal').classList.remove('hidden');
}

function closeWeeklyModal() {
  weeklyModalShowing = false;
  document.getElementById('weekly-modal').classList.add('hidden');
  renderAll();
  if (state.money < 0 && !state.bankrupt) {
    triggerBankruptcy();
    return;
  }
  if (pendingWeeklyEvent) {
    const ev = pendingWeeklyEvent;
    pendingWeeklyEvent = null;
    const resultText = ev.effect(state);
    showEventModal(ev, resultText);
    renderAll();
  }
}

function triggerBankruptcy() {
  state.bankrupt = true;
  state.gameStarted = false;
  const gt = getGameTime();
  document.getElementById('bankrupt-period').textContent  = `第${gt.period}期 ${gt.month}月`;
  document.getElementById('bankrupt-fl').textContent      = state.freelancers || 0;
  document.getElementById('bankrupt-earned').textContent  = yen(state.totalEarned);
  document.getElementById('bankrupt-prestige').textContent = state.prestige;
  document.getElementById('bankrupt-modal').classList.remove('hidden');
}

function restartGame() {
  localStorage.removeItem(SAVE_KEY);
  SLOT_KEYS.forEach(k => k && localStorage.removeItem(k));
  location.reload();
}

// ---- 3月決算・法人税 ----

function processCorpTax() {
  const taxable = state.periodEarned || 0;
  if (taxable <= 0) return;
  const tax = Math.floor(taxable * CORP_TAX_RATE);
  const before = state.money;
  state.money -= tax;
  state.periodEarned = 0;

  // 法人税モーダルを流用（expense-modal）
  const rows = `<div class="expense-row" style="color:#f87171"><span>🏛️ 法人税（当期収益の30%）</span><span>−${yen(tax)}</span></div>`;
  document.getElementById('expense-detail').innerHTML =
    `<div style="text-align:center;font-size:13px;color:#fbbf24;margin-bottom:10px">📅 3月決算 ― 法人税納付</div>` + rows;
  document.getElementById('expense-total').textContent  = `−${yen(tax)}`;
  document.getElementById('expense-before').textContent = yen(before);
  document.getElementById('expense-after').textContent  = yen(state.money);
  document.getElementById('expense-after').style.color  = state.money < 0 ? '#f87171' : '#4ade80';
  document.getElementById('expense-modal').classList.remove('hidden');
  renderAll();
  showToast(`🏛️ 法人税 ${yen(tax)} を納付しました（当期収益の30%）`);
}

// ---- 銀行借入 ----

const LOAN_OPTIONS = [
  { amount: 1000000   },
  { amount: 5000000   },
  { amount: 20000000  },
  { amount: 100000000 },
  { amount: 500000000 },
];

function takeLoan(amount) {
  const totalRepay     = Math.ceil(amount * LOAN_RATE);
  const monthlyPayment = Math.ceil(totalRepay / 12);
  state.loans.push({ id: Date.now(), remaining: totalRepay, monthlyPayment });
  state.money += amount;
  showToast(`🏦 ${yen(amount)}の融資実行！月次返済${yen(monthlyPayment)}×12回`);
  renderBank();
  renderHeader();
}

function renderBank() {
  const container = document.getElementById('bank-content');
  if (!container) return;

  const hasFinance = (state.employees['finance'] || 0) > 0;
  const bankBtn = document.getElementById('bank-tab-btn');
  if (bankBtn) {
    bankBtn.disabled = !hasFinance;
    bankBtn.innerHTML = hasFinance ? '🏦 銀行' : '🔒 銀行';
  }

  if (!hasFinance) {
    container.innerHTML = `
      <div class="bank-locked">
        <div class="bank-lock-icon">🔒</div>
        <div class="bank-locked-title">銀行取引は利用できません</div>
        <p class="bank-locked-desc">財務部を設置すると、銀行との取引口座が開設されます</p>
      </div>`;
    return;
  }

  const totalDebt   = state.loans.reduce((a, l) => a + l.remaining, 0);
  const monthlyRepay = state.loans.reduce((a, l) => a + l.monthlyPayment, 0);
  const exp = calcMonthlyExpenses();

  const loanListHtml = state.loans.length > 0
    ? state.loans.map(l => `
        <div class="loan-item">
          <div><span class="loan-remaining">残 ${yen(l.remaining)}</span></div>
          <div class="loan-monthly">月返済 ${yen(l.monthlyPayment)}</div>
        </div>`).join('')
    : '<p class="no-loan">現在ローンなし</p>';

  const loanBtnsHtml = LOAN_OPTIONS.map(opt => {
    const repay   = Math.ceil(opt.amount * LOAN_RATE);
    const monthly = Math.ceil(repay / 12);
    return `<button class="loan-btn" onclick="takeLoan(${opt.amount})">
      <span class="loan-amount">${yen(opt.amount)}</span>
      <div class="loan-detail">利率5% · 月返済 ${yen(monthly)} × 12回</div>
    </button>`;
  }).join('');

  container.innerHTML = `
    <div class="bank-section">
      <div class="bank-subheader">💳 借入状況</div>
      <div class="bank-debt-box">
        <div class="bank-debt-label">総借入残高</div>
        <div class="bank-debt-amount" style="color:${totalDebt > 0 ? '#f87171' : '#4ade80'}">${yen(totalDebt)}</div>
        ${totalDebt > 0 ? `<div class="bank-debt-label">月次返済合計 ${yen(monthlyRepay)}</div>` : ''}
      </div>
      <div>${loanListHtml}</div>
    </div>
    <div class="bank-section">
      <div class="bank-subheader">💰 新規借入申請</div>
      ${loanBtnsHtml}
    </div>
    <div class="bank-section">
      <div class="bank-subheader">📋 次回月次費用予測</div>
      <div class="expense-preview">
        <div class="expense-row"><span>🏢 事務所費</span><span>${yen(exp.rent + exp.utilities + exp.supplies)}</span></div>
        ${exp.salesperson > 0 ? `<div class="expense-row"><span>👔 営業部人件費</span><span>${yen(exp.salesperson)}</span></div>` : ''}
        ${exp.ceoSalary > 0 ? `<div class="expense-row"><span>🤵 社長報酬</span><span>${yen(exp.ceoSalary)}</span></div>` : ''}
        ${exp.loanPay > 0 ? `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>${yen(exp.loanPay)}</span></div>` : ''}
        <div class="expense-row" style="font-weight:700"><span>合計</span><span>${yen(exp.total)}</span></div>
      </div>
    </div>`;
}

// ---- 交流タブ（精神状況） ----

const EXCHANGE_ACTIONS = [
  { id: 'ex_party',       name: '🍻 社内交流会',          desc: '社員・FLの好感度を上げる懇親会',         cost: () => Math.max(500000, getTotalIncome() * 200),    targets: ['employee','freelance'], gain: 8,  color: '#4ade80',  flOnly: false },
  { id: 'ex_seminar',     name: '📚 研修・セミナー開催',   desc: '社員のスキルアップと充実感を高める',      cost: () => Math.max(2000000, getTotalIncome() * 500),   targets: ['employee'],             gain: 12, color: '#60a5fa',  flOnly: false },
  { id: 'ex_ceo_round',   name: '☕ 社長懇談会',           desc: '社長が社員と直接対話。全員の好感度UP',    cost: () => Math.max(1000000, getTotalIncome() * 300),   targets: ['ceo','employee'],        gain: 10, color: '#a78bfa',  flOnly: false },
  { id: 'ex_client',      name: '🥂 クライアント接待',     desc: '社長が得意先を接待。社長の好感度が大幅UP',cost: () => Math.max(3000000, getTotalIncome() * 800),   targets: ['ceo'],                  gain: 20, color: '#fbbf24',  flOnly: false },
  { id: 'ex_retreat',     name: '🏔️ 合宿・チームビルディング', desc: '全員参加の泊まり込み合宿。全好感度UP', cost: () => Math.max(10000000, getTotalIncome() * 2000), targets: ['ceo','employee','freelance'], gain: 18, color: '#f97316', flOnly: false },
  { id: 'ex_bonus',       name: '💴 特別ボーナス支給',     desc: '社員・FLへの臨時ボーナスで大幅改善',     cost: () => Math.max(20000000, getTotalIncome() * 4000), targets: ['employee','freelance'], gain: 25, color: '#ec4899',  flOnly: false },
  { id: 'ex_fl_lunch',    name: '🍱 FL懇親ランチ',         desc: 'FLと昼食をともにする。FL好感度UP',        cost: () => Math.max(50000, getTotalIncome() * 30),      targets: ['freelance'],            gain: 10, color: '#93c5fd',  flOnly: true  },
  { id: 'ex_fl_visit',    name: '🏢 FL常駐先への差し入れ', desc: '常駐先へ差し入れ訪問。FL好感度が大幅UP',  cost: () => Math.max(150000, getTotalIncome() * 80),     targets: ['freelance'],            gain: 20, color: '#7dd3fc',  flOnly: true  },
  { id: 'ex_fl_event',    name: '🎉 FL専用交流イベント',   desc: 'FL限定の感謝イベント。離脱率が激減',      cost: () => Math.max(500000, getTotalIncome() * 300),    targets: ['freelance'],            gain: 35, color: '#a78bfa',  flOnly: true  },
];

function doExchangeAction(actionId) {
  const action = EXCHANGE_ACTIONS.find(a => a.id === actionId);
  if (!action) return;
  const cost = action.cost();
  if (state.money < cost) { showToast('💸 資金が不足しています'); return; }
  state.money -= cost;
  action.targets.forEach(t => { state.morale[t] = Math.min(100, (state.morale[t] || 70) + action.gain); });
  showToast(`${action.name}を実施！好感度+${action.gain}`);
  renderAll();
}

function renderExchange() {
  const container = document.getElementById('exchange-content');
  if (!container) return;

  const m = state.morale;
  const mc  = v => v >= 70 ? '#4ade80' : v >= 40 ? '#fbbf24' : '#f87171';
  const ml  = v => v >= 80 ? '絶好調' : v >= 60 ? '良好' : v >= 40 ? '疲弊中' : '崩壊寸前';
  const avg = (m.ceo + m.employee + m.freelance) / 3;
  const eff = ((avg - 50) * 0.01 * 100).toFixed(0);

  const flFavor = m.freelance || 70;
  const departChance = Math.max(0.05, Math.min(0.80, 0.40 - (flFavor - 70) * 0.006));
  const favorBonus   = ((flFavor - 70) * 0.002 * 100).toFixed(1);

  const rows = [
    { key: 'ceo',       label: '👔 社長' },
    { key: 'employee',  label: '👨‍💼 社員' },
    { key: 'freelance', label: '💻 FL好感度' },
  ].map(({ key, label }) => {
    const v = m[key] || 70;
    const extra = key === 'freelance'
      ? `<span style="font-size:10px;color:#93c5fd;margin-left:4px">離脱率 ${(departChance*100).toFixed(0)}% / 利益${Number(favorBonus)>=0?'+':''}${favorBonus}%</span>`
      : '';
    return `<div class="morale-row">
      <span class="morale-label">${label}</span>
      <div class="morale-bar-wrap"><div class="morale-bar" style="width:${v}%;background:${mc(v)}"></div></div>
      <span class="morale-value" style="color:${mc(v)}">${v}</span>
      <span style="font-size:11px;color:${mc(v)};min-width:52px;text-align:right">${ml(v)}</span>
      ${extra}
    </div>`;
  }).join('');

  const makeBtn = a => {
    const cost = a.cost();
    const ok   = state.money >= cost && (state.freelancers > 0 || !a.flOnly);
    const disabledReason = a.flOnly && state.freelancers === 0 ? 'FL在籍なし' : ok ? '' : '資金不足';
    return `<button class="exchange-btn" onclick="doExchangeAction('${a.id}')" ${(ok && disabledReason === '') ? '' : 'disabled'}>
      <div class="exchange-btn-left">
        <span class="exchange-btn-name">${a.name}</span>
        <span class="exchange-btn-desc">${a.desc}</span>
      </div>
      <div class="exchange-btn-right">
        <span class="exchange-btn-cost" style="color:${ok?'#fbbf24':'#666'}">${disabledReason || yen(cost)}</span>
        <span class="exchange-btn-effect" style="color:${a.color}">好感度+${a.gain}</span>
      </div>
    </button>`;
  };

  const generalBtns = EXCHANGE_ACTIONS.filter(a => !a.flOnly).map(makeBtn).join('');
  const flBtns      = EXCHANGE_ACTIONS.filter(a =>  a.flOnly).map(makeBtn).join('');

  container.innerHTML = `
    <div class="exchange-morale-box">
      <div class="exchange-morale-title">📊 好感度メーター</div>
      ${rows}
      <div class="morale-effect">売上影響: <strong style="color:${Number(eff)>=0?'#4ade80':'#f87171'}">${Number(eff)>=0?'+':''}${eff}%</strong>（平均 ${avg.toFixed(0)}/100）</div>
    </div>
    <div class="exchange-actions">
      <div class="exchange-action-title">🤝 社内施策</div>
      ${generalBtns}
    </div>
    <div class="exchange-actions" style="margin-top:12px">
      <div class="exchange-action-title" style="color:#93c5fd">👨‍💻 FL関係施策</div>
      ${flBtns}
    </div>`;
}

// ---- 週次イベント ----

function triggerWeeklyEvent() {
  const ev = WEEK_EVENTS[Math.floor(Math.random() * WEEK_EVENTS.length)];
  const resultText = ev.effect(state);
  showEventModal(ev, resultText);
  renderAll();
}

function showEventModal(ev, resultText) {
  setOfficeEventFx(ev.type);
  const label = document.getElementById('event-type-label');
  label.textContent = ev.type === 'good' ? '📰 グッドニュース！' : '📰 バッドニュース…';
  label.style.color = ev.type === 'good' ? '#4ade80' : '#f87171';
  document.getElementById('event-emoji-big').textContent = ev.emoji;
  document.getElementById('event-title').textContent     = ev.title;
  document.getElementById('event-desc').textContent      = ev.desc;
  const resEl = document.getElementById('event-result');
  resEl.textContent = '結果：' + resultText;
  resEl.style.color = ev.type === 'good' ? '#4ade80' : '#f87171';
  document.getElementById('event-modal').classList.remove('hidden');
}

function closeEventModal() {
  document.getElementById('event-modal').classList.add('hidden');
}

// ---- 広告 ----

let adBoostActive = false;

function watchAd() {
  if (adBoostActive) { showToast('広告ブースト中です！'); return; }
  showToast('動画広告を視聴中...');
  setTimeout(() => {
    adBoostActive = true;
    showToast('✅ 収益2倍！30秒間有効');
    setTimeout(() => { adBoostActive = false; showToast('広告ブースト終了'); }, 30000);
  }, 2000);
}

// ---- セーブ / ロード ----

function save() {
  state.lastTimestamp = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    const now = Date.now();
    const offlineSec = Math.min((now - (saved.lastTimestamp || now)) / 1000, MAX_OFFLINE_SEC);
    Object.assign(state, saved);
    state.lastTimestamp = now;
    // 互換性
    if (!state.elapsedSeconds)  state.elapsedSeconds  = 0;
    if (!state.lastEventWeek)   state.lastEventWeek   = 0;
    if (!state.eventBoost)      state.eventBoost      = null;
    if (!state.lastExpenseWeek) state.lastExpenseWeek = 0;
    if (!state.loans)           state.loans           = [];
    if (!state.morale)          state.morale          = { ceo: 70, employee: 70, freelance: 70 };
    if (!state.freelancers)          state.freelancers  = 0;
    if (state.officeLevel === undefined) state.officeLevel = 0;
    if (state.gameStarted === undefined) state.gameStarted = (state.officeLevel > 0);
    if (!state.bankrupt) state.bankrupt = false;
    if (!state.freelancerMult)  state.freelancerMult  = 1;
    if (!state.lastTaxPeriod)   state.lastTaxPeriod   = 0;
    if (!state.periodEarned)    state.periodEarned    = 0;
    // 旧データマイグレーション
    ['dev','marketing'].forEach(old => {
      if (state.employees[old]) { delete state.employees[old]; }
    });
    if (state.employees['recruit']) {
      state.freelancers = (state.freelancers || 0) + state.employees['recruit'];
      delete state.employees['recruit'];
    }
    if (state.employees['outsource']) { delete state.employees['outsource']; }
    if (state.employees['contractor_sales']) { delete state.employees['contractor_sales']; }
    // 初期化されていない部署キーをリセット
    DEPT_DEFS.forEach(d => {
      if (state.employees[d.id] === undefined) state.employees[d.id] = 0;
      if (state.deptMults[d.id] === undefined) state.deptMults[d.id] = 1;
      if (state.deptRevenue[d.id] === undefined) state.deptRevenue[d.id] = 0;
      if (state.deptCost[d.id] === undefined) state.deptCost[d.id] = 0;
    });
    if (!state.weeklyIncomeAccum) state.weeklyIncomeAccum = 0;
    if (state.gameSpeed === undefined)  state.gameSpeed = 1;
    if (state.ceoSalary === undefined)  state.ceoSalary = 500000;
    if (!state.reportHistory)           state.reportHistory = [];
    if (!state.flData) state.flData = [];
    { const preFlCount = state.freelancers || 0;
      while (state.flData.length < preFlCount) {
        state.flData.push({ gross: 600000 + Math.floor(Math.random() * 400001), profitRate: 0.10 + Math.random() * 0.10 });
      }
      state.freelancers = state.flData.length; }
    if (state.flGrossRevenue === undefined) state.flGrossRevenue = 0;
    if (offlineSec > 30) {
      const deptIncome     = getTotalIncome() * offlineSec;
      const offlineWeeks   = Math.floor(offlineSec / WEEK_SEC);
      const flOfflineIncome = getFlWeeklyIncome() * offlineWeeks;
      const income = deptIncome + flOfflineIncome;
      if (income > 0) {
        state.money += income;
        state.totalEarned += income;
        state.periodEarned = (state.periodEarned || 0) + income;
        state.elapsedSeconds += offlineSec;
        showOfflineModal(offlineSec, income);
      }
    }
  } catch (e) { console.error(e); }
}

function resetGame() {
  if (!confirm('セーブデータを削除してリセットしますか？')) return;
  localStorage.removeItem(SAVE_KEY);
  SLOT_KEYS.forEach(k => k && localStorage.removeItem(k));
  location.reload();
}

// ---- セーブスロット ----

function saveToSlot(n) {
  const existing = localStorage.getItem(SLOT_KEYS[n]);
  if (existing && !confirm(`スロット${n}に上書きしますか？`)) return;
  localStorage.setItem(SLOT_KEYS[n], JSON.stringify({ ...state, slotSavedAt: Date.now(), slotStageIdx: getCurrentStageIdx() }));
  showToast(`💾 スロット${n}にセーブ！`);
  renderSlots();
}

function loadFromSlot(n) {
  const raw = localStorage.getItem(SLOT_KEYS[n]);
  if (!raw) return;
  if (!confirm(`スロット${n}をロードします。現在の状態は失われます。`)) return;
  try {
    const saved = JSON.parse(raw);
    const offlineSec = Math.min((Date.now() - (saved.lastTimestamp || Date.now())) / 1000, MAX_OFFLINE_SEC);
    Object.assign(state, saved);
    state.lastTimestamp = Date.now();
    if (!state.flData) state.flData = [];
    { const preFlCount = state.freelancers || 0;
      while (state.flData.length < preFlCount) {
        state.flData.push({ gross: 600000 + Math.floor(Math.random() * 400001), profitRate: 0.10 + Math.random() * 0.10 });
      }
      state.freelancers = state.flData.length; }
    if (state.flGrossRevenue === undefined) state.flGrossRevenue = 0;
    if (offlineSec > 30) {
      const deptIncome      = getTotalIncome() * offlineSec;
      const offlineWeeks    = Math.floor(offlineSec / WEEK_SEC);
      const flOfflineIncome = getFlWeeklyIncome() * offlineWeeks;
      const income = deptIncome + flOfflineIncome;
      if (income > 0) { state.money += income; state.totalEarned += income; showOfflineModal(offlineSec, income); }
    }
    renderAll();
    showToast(`📂 スロット${n}をロードしました！`);
  } catch (e) { showToast('ロードに失敗しました'); }
}

function deleteSlot(n) {
  if (!confirm(`スロット${n}のデータを削除しますか？`)) return;
  localStorage.removeItem(SLOT_KEYS[n]);
  showToast(`🗑️ スロット${n}を削除しました`);
  renderSlots();
}

function renderSlots() {
  const container = document.getElementById('slots-list');
  if (!container) return;
  let html = '';
  for (let n = 1; n <= 3; n++) {
    const raw = localStorage.getItem(SLOT_KEYS[n]);
    if (!raw) {
      html += `<div class="slot-card empty">
        <div class="slot-num">スロット ${n}</div>
        <div class="slot-empty-label">― 空きスロット ―</div>
        <div class="slot-actions"><button class="slot-save-btn full" onclick="saveToSlot(${n})">💾 ここにセーブ</button></div>
      </div>`;
    } else {
      try {
        const data = JSON.parse(raw);
        const sIdx  = Math.min(data.slotStageIdx ?? 0, STAGE_DEFS.length - 1);
        const stage = STAGE_DEFS[sIdx];
        const d = new Date(data.slotSavedAt || data.lastTimestamp);
        const ds = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} `
                 + `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        html += `<div class="slot-card">
          <div class="slot-header">
            <div class="slot-num">スロット ${n}</div>
            <button class="slot-del-btn" onclick="deleteSlot(${n})">🗑️</button>
          </div>
          <div class="slot-stage">${stage.emoji} ${stage.name}</div>
          <div class="slot-meta">累計売上: <strong>${yen(data.totalEarned || 0)}</strong></div>
          <div class="slot-meta">FL: ${data.freelancers||0}名　上場: ${data.prestige||0}回</div>
          <div class="slot-date">📅 ${ds}</div>
          <div class="slot-actions">
            <button class="slot-save-btn" onclick="saveToSlot(${n})">💾 上書き</button>
            <button class="slot-load-btn" onclick="loadFromSlot(${n})">📂 ロード</button>
          </div>
        </div>`;
      } catch (e) {
        html += `<div class="slot-card empty"><div class="slot-num">スロット ${n}（エラー）</div><button class="slot-del-btn" onclick="deleteSlot(${n})">🗑️</button></div>`;
      }
    }
  }
  container.innerHTML = html;
}

// ---- レンダリング ----

function renderHeader() {
  const stageIdx    = getCurrentStageIdx();
  const stage       = STAGE_DEFS[stageIdx];
  const income      = getTotalIncome();
  const weeklyIncome = getDisplayWeeklyIncome();
  const marketCap   = income * 365 * 3;

  document.getElementById('money-display').textContent  = yen(state.money);
  document.getElementById('income-display').textContent = yen(weeklyIncome) + '/週';
  document.getElementById('company-stage').textContent  = stage.emoji + ' ' + stage.name;
  document.getElementById('total-earned').textContent   = '累計売上 ' + yen(state.totalEarned);
  document.getElementById('market-cap').textContent     = '時価総額 ' + yen(marketCap);
  document.documentElement.style.setProperty('--theme', stage.color);
  renderOfficeScene();

  // 期/月/週 表示
  const gt = getGameTime();
  document.getElementById('week-label').textContent =
    `第${gt.period}期 第${gt.month}月 第${gt.week}週`;
  document.getElementById('week-progress').style.width = (gt.weekProgress * 100) + '%';

  // ステージ進捗バー
  const allStages = [...STAGE_DEFS, { threshold: IPO_THRESHOLD, name: '上場！', emoji: '🎉' }];
  const nextStage = allStages[stageIdx + 1];
  if (nextStage) {
    const prev = allStages[stageIdx].threshold;
    const prog = Math.min(1, (state.totalEarned - prev) / (nextStage.threshold - prev));
    document.getElementById('stage-progress').style.width = (prog * 100) + '%';
    document.getElementById('stage-label').textContent =
      `次: ${nextStage.emoji} ${nextStage.name} まで ${yen(nextStage.threshold - state.totalEarned)}`;
  } else {
    document.getElementById('stage-progress').style.width = '100%';
    document.getElementById('stage-label').textContent = '🎉 最高峰に到達！';
  }
}

// ---- 部署描画ヘルパー ----

function _buildOfficeCard() {
  const curLvl = state.officeLevel ?? 0;
  const offlvl = OFFICE_LEVELS[curLvl];
  const total  = getEmployeeCount();
  const cap    = getCurrentCapacity();
  const nextLvl = OFFICE_LEVELS[curLvl + 1];

  if (curLvl === 0) {
    const firstOffice = OFFICE_LEVELS[1];
    const canAfford = state.money >= firstOffice.upgradeCost;
    return `<div class="dept-card" style="border-color:#fbbf24;border-width:2px;margin-bottom:14px">
      <div class="dept-emoji">🏢</div>
      <div class="dept-info">
        <div class="dept-name" style="color:#fbbf24">事務所を借りる</div>
        <div class="dept-desc">まず事務所を契約して営業を雇えるようにしよう。資本金 ¥10,000,000 を活用して。</div>
        <div class="dept-income" style="color:#fbbf24">→ ${firstOffice.name}（${firstOffice.capacity}名収容）</div>
      </div>
      <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="upgradeOffice()">
        契約<br><small>${yen(firstOffice.upgradeCost)}</small>
      </button>
    </div>`;
  }

  const capPct   = cap > 0 ? Math.min(100, total / cap * 100) : 0;
  const capColor = capPct >= 90 ? '#f87171' : capPct >= 70 ? '#fbbf24' : '#4ade80';
  const upgradeBtn = nextLvl
    ? `<button class="hire-btn${state.money >= nextLvl.upgradeCost ? '' : ' disabled'}" onclick="upgradeOffice()">
        移転<br><small>${yen(nextLvl.upgradeCost)}</small>
       </button>`
    : `<div style="font-size:11px;color:#4ade80;text-align:center">最大</div>`;

  return `<div class="dept-card active" style="border-color:${capColor};margin-bottom:14px">
    <div class="dept-emoji">🏢</div>
    <div class="dept-info">
      <div class="dept-name">${offlvl.name} <span class="emp-count">${total}/${cap}名</span></div>
      <div class="dept-desc">${nextLvl ? `次: ${nextLvl.name}（${nextLvl.capacity}名）→ ${yen(nextLvl.upgradeCost)}` : '最大規模の事務所'}</div>
      <div class="dept-income">
        <div style="background:#2a2a50;border-radius:4px;height:5px;overflow:hidden;margin-top:5px">
          <div style="height:100%;width:${capPct}%;background:${capColor};border-radius:4px;transition:width 0.6s"></div>
        </div>
      </div>
    </div>
    ${upgradeBtn}
  </div>`;
}

function _buildFLCard() {
  const fl            = state.freelancers || 0;
  const activeFL      = getFlActiveCount();
  const salesCount    = state.employees['sales'] || 0;
  const recruitChance = getRecruitChance();
  const flWeeklyGross = getFlWeeklyGross();
  const flWeeklyNet   = getFlWeeklyIncome();
  const flWeeklyCost  = getFlWeeklyCost();

  const pendingNote   = (fl > activeFL) ? `（うち${fl - activeFL}名は翌週稼働開始）` : '';
  const incomeDetail  = activeFL > 0
    ? `売上 ${yen(flWeeklyGross)} − 報酬 ${yen(flWeeklyCost)} = 利益 ${yen(flWeeklyNet)}/週 ${pendingNote}`
    : fl > 0
      ? `採用済み（翌週から稼働）${pendingNote}`
      : '1人あたり: 売上¥150k〜¥250k/週 − 報酬 → 利益¥15k〜¥50k/週';

  return `<div class="island-row ${fl > 0 ? 'island-row-active' : ''}">
    <div class="dept-emoji">👨‍💻</div>
    <div class="dept-info">
      <div class="dept-name" style="color:#93c5fd">フリーランスエンジニア <span class="emp-count" style="background:#3b5bdb">${fl}名</span></div>
      <div class="dept-desc">${incomeDetail}</div>
      ${salesCount > 0
        ? `<div class="dept-margin"><span class="ml" style="color:#a78bfa">採用確率 ${(recruitChance*100).toFixed(1)}%/週 × 営業${salesCount}名</span></div>`
        : `<div class="dept-margin"><span class="ml" style="color:#555">営業を雇うと毎週採用活動</span></div>`}
    </div>
  </div>`;
}

function _buildDeptRow(id) {
  const def      = DEPT_DEFS.find(d => d.id === id);
  if (!def) return '';
  const emp      = state.employees[id] || 0;
  const unlocked = state.totalEarned >= def.unlockAt || emp > 0;

  if (!unlocked) {
    const farFuture = def.unlockAt > state.totalEarned * 25 && state.totalEarned > 0;
    return `<div class="island-row island-row-locked">
      <div class="dept-emoji" style="font-size:24px;opacity:0.4">🔒</div>
      <div class="dept-info">
        <div class="dept-name" style="opacity:0.5">${def.name}</div>
        <div class="dept-unlock">${farFuture ? '…まだ先の話' : `累計売上 ${yen(def.unlockAt)} で解放`}</div>
      </div>
    </div>`;
  }

  const hireCost  = getHireCost(id);
  const atCap     = getEmployeeCount() >= getCurrentCapacity();
  const canAfford = state.money >= hireCost && !atCap;

  let incomeText = '';
  if (def.special === 'multiplier') {
    incomeText = `全体収益 ×${(1 + def.specialValue * emp).toFixed(2)}`;
  } else if (def.special === 'costReduction') {
    const r = (1 - getCostReduction()) * 100;
    incomeText = `採用コスト −${Math.min(r, 90).toFixed(0)}%　FL採用確率 ＋${(emp*3).toFixed(0)}%`;
  } else if (id === 'sales') {
    incomeText = `採用確率 ${(getRecruitChance()*100).toFixed(1)}%/週/人　月次固定費 ${yen(Math.ceil(def.monthlySalary*(1+def.insuranceRate)*emp))}/月`;
  } else {
    const inc = getDeptIncome(id);
    incomeText = `${yen(inc)}/秒　(${yen(def.incomePerSec*(state.deptMults[id]||1))}/秒/人)`;
  }

  return `<div class="island-row ${emp > 0 ? 'island-row-active' : ''}">
    <div class="dept-emoji">${def.emoji}</div>
    <div class="dept-info">
      <div class="dept-name">${def.name} <span class="emp-count">${emp}人</span></div>
      <div class="dept-desc">${def.desc}</div>
      <div class="dept-income">${incomeText}</div>
    </div>
    <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="hire('${id}')">
      採用<br><small>${atCap ? '満員' : yen(hireCost)}</small>
    </button>
  </div>`;
}

function renderDepts() {
  const container = document.getElementById('depts-list');

  let html = _buildOfficeCard();

  // 島1: 営業部（営業 + FL + 人事）
  html += `<div class="dept-island island-sales">
    <div class="island-hdr"><span class="island-icon">💼</span><span>営業部</span></div>
    ${_buildDeptRow('sales')}
    ${_buildFLCard()}
    ${_buildDeptRow('hr')}
  </div>`;

  // 島2: 財務部（財務 + 戦略）
  html += `<div class="dept-island island-finance">
    <div class="island-hdr"><span class="island-icon">💹</span><span>財務部</span></div>
    ${_buildDeptRow('finance')}
    ${_buildDeptRow('strategy')}
  </div>`;

  // 島3: グローバル部
  html += `<div class="dept-island island-global">
    <div class="island-hdr"><span class="island-icon">🌐</span><span>グローバル部</span></div>
    ${_buildDeptRow('global')}
  </div>`;

  container.innerHTML = html;
}

function renderUpgrades() {
  const container = document.getElementById('upgrades-list');
  let html = '';
  let count = 0;

  UPGRADE_DEFS.forEach(def => {
    if (state.upgrades[def.id]) return;
    const reqMet = Object.entries(def.req).every(([id, n]) => (state.employees[id] || 0) >= n);
    if (!reqMet) return;
    count++;
    const canAfford = state.money >= def.cost;
    const deptName  = def.dept === 'freelancer' ? '👨‍💻 FL単価'
                    : (DEPT_DEFS.find(d => d.id === def.dept)?.name || '');
    html += `<div class="upgrade-card${canAfford ? '' : ' cant-afford'}">
      <div class="upgrade-emoji">${def.emoji}</div>
      <div class="upgrade-info">
        <div class="upgrade-name">${def.name}</div>
        <div class="upgrade-effect">${deptName} ×${def.mult}</div>
        <div class="upgrade-cost">${yen(def.cost)}</div>
      </div>
      <button class="buy-btn${canAfford ? '' : ' disabled'}" onclick="buyUpgrade('${def.id}')">購入</button>
    </div>`;
  });

  if (count === 0) {
    html = '<div class="empty-msg">部署に社員を雇うと<br>アップグレードが解放されます 🔓</div>';
  }

  const badge = document.getElementById('upgrade-badge');
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
  container.innerHTML = html;
}

function setCeoSalary(amount) {
  state.ceoSalary = amount;
  renderLabor();
}

function renderLabor() {
  const totalEmp   = Object.values(state.employees).reduce((a, b) => a + b, 0);
  const fl         = state.freelancers || 0;
  const activeFL   = getFlActiveCount();
  const gt         = getGameTime();
  const ceoSalary  = state.ceoSalary || 0;

  const SALARY_OPTIONS = [0, 100000, 300000, 500000, 1000000, 2000000];
  const SALARY_LABELS  = ['¥0', '¥10万', '¥30万', '¥50万', '¥100万', '¥200万'];
  const salaryBtns = SALARY_OPTIONS.map((v, i) =>
    `<button class="salary-btn${ceoSalary === v ? ' active' : ''}" onclick="setCeoSalary(${v})">${SALARY_LABELS[i]}</button>`
  ).join('');

  // FL収益内訳（エンジニア毎ランダムレートで算出）
  const flWeeklyGross = getFlWeeklyGross();
  const flWeeklyNet   = getFlWeeklyIncome();
  const flWeeklyCost  = getFlWeeklyCost();

  // P&L rows
  const plRows = DEPT_DEFS
    .filter(d => (state.deptCost[d.id] || 0) > 0)
    .map(d => {
      const rev   = state.deptRevenue[d.id] || 0;
      const sga   = d.marginRate && rev > 0 ? rev * (1 - d.marginRate) : 0;
      const cost  = state.deptCost[d.id] || 0;
      const opPft = rev - sga - cost;
      const mg    = rev > 0 ? (opPft / rev * 100) : null;
      const mc    = mg === null ? '#888' : mg >= 60 ? '#4ade80' : mg >= 30 ? '#a3e635' : mg >= 0 ? '#facc15' : '#f87171';
      const mgText = mg === null ? '―' : (mg >= 0 ? `▲${mg.toFixed(1)}%` : `▼${Math.abs(mg).toFixed(1)}%`);
      return `<tr>
        <td>${d.emoji} ${d.name}</td>
        <td class="num">${yen(rev)}</td>
        <td class="num" style="color:#f87171">${sga > 0 ? yen(sga) : '―'}</td>
        <td class="num" style="color:#94a3b8">${yen(cost)}</td>
        <td class="num" style="color:${mc};font-weight:700">${mgText}</td>
      </tr>`;
    }).join('');

  // FL P&L row
  const flRevCum   = state.deptRevenue['freelancer'] || 0;
  const flGrossCum = state.flGrossRevenue || 0;
  const flCostCum  = flGrossCum - flRevCum;
  const flMgText   = flGrossCum > 0 ? `▲${(flRevCum / flGrossCum * 100).toFixed(1)}%` : '―';
  const flPlRow    = flRevCum > 0 ? `<tr>
    <td>👨‍💻 FL（累計）</td>
    <td class="num" style="color:#4ade80">${yen(flGrossCum)}</td>
    <td class="num" style="color:#f87171">${yen(flCostCum)}</td>
    <td class="num" style="color:#94a3b8">―</td>
    <td class="num" style="color:#4ade80;font-weight:700">${flMgText}</td>
  </tr>` : '';

  document.getElementById('labor-content').innerHTML = `
    <div class="labor-section">
      <div class="labor-section-title">🤵 社長報酬設定</div>
      <div class="labor-ceo-current">現在: <strong>${yen(ceoSalary)}/月</strong>　次回月末経費に反映</div>
      <div class="salary-btn-group">${salaryBtns}</div>
    </div>

    <div class="stats-grid">
      <div class="stat-item"><div class="stat-label">第${gt.period}期 ${gt.month}月目</div><div class="stat-value">第${gt.week}週</div></div>
      <div class="stat-item"><div class="stat-label">社員数</div><div class="stat-value">${totalEmp}名</div></div>
      <div class="stat-item"><div class="stat-label">FL在籍</div><div class="stat-value">${fl}名 <small style="color:#93c5fd;font-size:10px">稼働${activeFL}名</small></div></div>
      <div class="stat-item"><div class="stat-label">週次収益</div><div class="stat-value">${yen(getDisplayWeeklyIncome())}/週</div></div>
      <div class="stat-item"><div class="stat-label">累計売上</div><div class="stat-value">${yen(state.totalEarned)}</div></div>
      <div class="stat-item"><div class="stat-label">当期収益</div><div class="stat-value">${yen(state.periodEarned)}</div></div>
      <div class="stat-item"><div class="stat-label">上場回数</div><div class="stat-value">${state.prestige}回</div></div>
      <div class="stat-item"><div class="stat-label">株主倍率</div><div class="stat-value">×${state.prestigeMult.toFixed(1)}</div></div>
      <div class="stat-item"><div class="stat-label">FL単価倍率</div><div class="stat-value">×${(state.freelancerMult||1).toFixed(2)}</div></div>
    </div>

    ${activeFL > 0 ? `<div class="labor-section">
      <div class="labor-section-title">👨‍💻 FL収益内訳（週次・稼働${activeFL}名）</div>
      <div class="expense-row" style="color:#4ade80"><span>売上（${activeFL}名合算）</span><span>＋${yen(flWeeklyGross)}</span></div>
      <div class="expense-row" style="color:#f87171"><span>FL報酬（${activeFL}名合算）</span><span>−${yen(flWeeklyCost)}</span></div>
      <div class="expense-row" style="color:#93c5fd;font-weight:700;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>利益（${activeFL}名合算）</span><span>＋${yen(flWeeklyNet)}</span></div>
    </div>` : fl > 0 ? `<div class="labor-section"><div class="labor-section-title" style="color:#888">👨‍💻 FL${fl}名 採用済み（翌週から稼働）</div></div>` : ''}

    ${plRows || flPlRow ? `
    <div class="pl-table-wrap">
      <div class="pl-header"><span>📋 部署別 損益計算書（累計）</span></div>
      <table class="pl-table">
        <thead><tr><th>部署</th><th>売上高</th><th>変動費</th><th>採用/強化</th><th>利益率</th></tr></thead>
        <tbody>${plRows}${flPlRow}</tbody>
      </table>
    </div>` : ''}

    <div class="ad-section">
      <h3>🎬 広告視聴で収益2倍（30秒）</h3>
      <button class="ad-btn" onclick="watchAd()">動画広告を見る</button>
    </div>
    ${state.totalEarned >= IPO_THRESHOLD ? `<div class="ipo-ready-banner" onclick="document.getElementById('ipo-modal').classList.remove('hidden')">🚀 上場可能！タップして上場する</div>` : ''}
    <div class="danger-zone">
      <button class="reset-btn" onclick="resetGame()">🗑️ データをリセット</button>
    </div>
  `;
}

// ---- オフィスキャンバス（ドット絵描画エンジン） ----

const OCV_W = 360, OCV_H = 160, OCV_HORIZON = 60;

const OCV_THEMES = [
  { wall:'#1c0808', floor:'#130404', sky:'#090606', winFr:'#3a1414' },
  { wall:'#0e0e30', floor:'#070718', sky:'#0a1030', winFr:'#282858' },
  { wall:'#0a1225', floor:'#060b16', sky:'#081535', winFr:'#162856' },
  { wall:'#080f22', floor:'#04080f', sky:'#081855', winFr:'#142858' },
  { wall:'#06081c', floor:'#03040e', sky:'#080895', winFr:'#101888' },
  { wall:'#030510', floor:'#020208', sky:'#050668', winFr:'#080c70' },
  { wall:'#020208', floor:'#010104', sky:'#030555', winFr:'#050960' },
];
const OCV_SHIRT  = ['#3868d0','#cc4040','#40a856','#c87828','#8838cc','#28a0c8','#cc28a0'];
const OCV_HAIR   = ['#280e04','#481808','#080808','#480800','#382804','#c89828'];
const OCV_SKIN   = ['#eec070','#c09850','#987040','#d8a858'];
const OCV_SCREEN = ['#58a8ff','#58ffa0','#ff9028','#d858ff','#58f0f8','#ff5888'];

let ocvCtx = null, ocvTime = 0, ocvAnimId = null;

// Deterministic pseudo-random (no flickering)
function prand(n) {
  n = ((n ^ 61) ^ (n >>> 16)) >>> 0;
  n = (n + (n << 3)) >>> 0;
  n = (n ^ (n >>> 4)) >>> 0;
  n = Math.imul(n, 0x27d4eb2d) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  return n / 0xffffffff;
}

function lhex(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.min(255,Math.round(r+a*255))},${Math.min(255,Math.round(g+a*255))},${Math.min(255,Math.round(b+a*255))})`;
}

function initOCV() {
  const cv = document.getElementById('office-canvas');
  if (!cv) return;
  cv.width = OCV_W; cv.height = OCV_H;
  ocvCtx = cv.getContext('2d');
  ocvCtx.imageSmoothingEnabled = false;
  if (ocvAnimId) cancelAnimationFrame(ocvAnimId);
  (function loop() { ocvTime += 0.016; ocvDraw(); ocvAnimId = requestAnimationFrame(loop); })();
}

function ocvDraw() {
  if (!ocvCtx) return;
  const ctx   = ocvCtx;
  const lvl   = state.officeLevel ?? 0;
  const m     = state.morale || { ceo:70, employee:70, freelance:70 };
  const mor   = (m.ceo + m.employee + m.freelance) / 3;
  const count = getTotalPeople();
  const th    = OCV_THEMES[Math.min(lvl, OCV_THEMES.length-1)];
  ctx.clearRect(0, 0, OCV_W, OCV_H);
  ocvBG(ctx, th, lvl, mor);
  if (state.gameStarted) {
    ocvDeptIslands(ctx, mor);
  } else {
    ocvPeople(ctx, count, mor);
  }
  ocvOverlay(ctx, mor, count);
}

function ocvBG(ctx, th, lvl, mor) {
  // Wall
  let g = ctx.createLinearGradient(0,0,0,OCV_HORIZON);
  g.addColorStop(0, lhex(th.wall,0.07)); g.addColorStop(1, th.wall);
  ctx.fillStyle=g; ctx.fillRect(0,0,OCV_W,OCV_HORIZON);
  // Floor
  g = ctx.createLinearGradient(0,OCV_HORIZON,0,OCV_H);
  g.addColorStop(0, lhex(th.floor,0.10)); g.addColorStop(1, th.floor);
  ctx.fillStyle=g; ctx.fillRect(0,OCV_HORIZON,OCV_W,OCV_H-OCV_HORIZON);
  // Baseboard
  ctx.fillStyle = lhex(th.floor,0.16); ctx.fillRect(0,OCV_HORIZON,OCV_W,2);
  // Ceiling lights
  if (lvl >= 2) {
    const n = Math.min(3, Math.floor(lvl/2));
    for (let i=0;i<n;i++) {
      const lx = OCV_W*(i+0.5)/n - 35;
      ctx.fillStyle=`rgba(180,210,255,${0.10+lvl*0.018})`; ctx.fillRect(lx,0,70,2);
      ctx.fillStyle=`rgba(180,210,255,0.04)`;              ctx.fillRect(lx-10,0,90,10);
    }
  }
  // Windows
  ocvWindows(ctx, th, lvl, mor, lvl>=4?3:2);
  // Nameplate
  if (lvl >= 3) {
    ctx.fillStyle='rgba(70,52,15,0.55)'; ctx.fillRect(OCV_W/2-55,OCV_HORIZON-18,110,14);
    ctx.strokeStyle='rgba(160,120,35,0.5)'; ctx.lineWidth=1;
    ctx.strokeRect(OCV_W/2-55,OCV_HORIZON-18,110,14);
    ctx.fillStyle='rgba(255,205,90,0.7)'; ctx.font='7px monospace'; ctx.textAlign='center';
    ctx.fillText('廃墟再生株式会社', OCV_W/2, OCV_HORIZON-7); ctx.textAlign='left';
  }
  // Perspective floor lines
  ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=1;
  for (let fi=1;fi<=4;fi++) {
    const fy=OCV_HORIZON+(OCV_H-OCV_HORIZON)*fi/5;
    ctx.beginPath(); ctx.moveTo(0,fy); ctx.lineTo(OCV_W,fy); ctx.stroke();
  }
}

function ocvWindows(ctx, th, lvl, mor, n) {
  const wW=n===3?80:100, wH=44, wY=7;
  const tot=n*wW+(n-1)*18, sx=(OCV_W-tot)/2;
  for (let wi=0;wi<n;wi++) {
    const wx=sx+wi*(wW+18);
    const sg=ctx.createLinearGradient(wx,wY,wx,wY+wH);
    if (mor<30) { sg.addColorStop(0,'#090909'); sg.addColorStop(1,'#141010'); }
    else        { sg.addColorStop(0,th.sky);    sg.addColorStop(1,lhex(th.sky,0.12)); }
    ctx.fillStyle=sg; ctx.fillRect(wx,wY,wW,wH);
    if (mor<30) ocvRain(ctx,wx,wY,wW,wH,wi);
    else        ocvSky(ctx,wx,wY,wW,wH,lvl,wi);
    // Frame
    ctx.strokeStyle=lhex(th.winFr,0.30); ctx.lineWidth=2; ctx.strokeRect(wx,wY,wW,wH);
    ctx.strokeStyle=lhex(th.winFr,0.18); ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(wx+wW/2,wY); ctx.lineTo(wx+wW/2,wY+wH);
    ctx.moveTo(wx,wY+wH/2); ctx.lineTo(wx+wW,wY+wH/2); ctx.stroke();
    // Inner shadow
    ctx.fillStyle='rgba(0,0,0,0.12)';
    ctx.fillRect(wx+2,wY+2,wW-4,2); ctx.fillRect(wx+2,wY+2,2,wH-4);
  }
}

function ocvRain(ctx, wx, wy, ww, wh, wi) {
  ctx.strokeStyle='rgba(70,120,200,0.4)'; ctx.lineWidth=0.8;
  for (let r=0;r<10;r++) {
    const oy=(ocvTime*65+r*13.7+wi*9)%(wh+8), rx=wx+(r*7.3+wi*23)%ww;
    ctx.beginPath(); ctx.moveTo(rx,wy+oy-8); ctx.lineTo(rx-1.2,wy+oy-8+7); ctx.stroke();
  }
}

function ocvSky(ctx, wx, wy, ww, wh, lvl, wi) {
  if (lvl <= 1) {
    // Night: moon + stars
    ctx.fillStyle='rgba(220,225,175,0.8)';
    ctx.beginPath(); ctx.arc(wx+ww-14,wy+12,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(220,225,175,0.22)';
    ctx.beginPath(); ctx.arc(wx+ww-10,wy+10,6,0,Math.PI*2); ctx.fill();
    for (let s=0;s<9;s++) {
      const sx=wx+prand(wi*20+s)*(ww-4)+2, sy=wy+prand(wi*20+s+50)*(wh*0.55)+2;
      ctx.fillStyle=`rgba(255,255,220,${(0.55+Math.sin(ocvTime*1.5+s)*0.3)*0.7})`; ctx.fillRect(sx,sy,1,1);
    }
  } else if (lvl <= 3) {
    // Day: clouds + sun
    for (let c=0;c<2;c++) {
      const cx=wx+((ocvTime*(6+c*2)+wi*45+c*55)%(ww+40))-20, cy=wy+wh*0.28+c*9;
      ctx.fillStyle='rgba(195,210,230,0.18)';
      ctx.beginPath(); ctx.ellipse(cx,cy,13,6,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+10,cy-3,9,5,0,0,Math.PI*2); ctx.fill();
    }
    if (wi===0 && lvl>=2) {
      const sr=ctx.createRadialGradient(wx+10,wy+11,0,wx+10,wy+11,14);
      sr.addColorStop(0,'rgba(255,215,75,0.38)'); sr.addColorStop(1,'rgba(255,215,75,0)');
      ctx.fillStyle=sr; ctx.fillRect(wx,wy,30,26);
    }
  } else {
    // City skyline
    const bdata=[[0.02,0.11,0.55],[0.15,0.09,0.78],[0.26,0.12,0.42],
                 [0.40,0.10,0.68],[0.52,0.12,0.58],[0.66,0.09,0.82],[0.77,0.14,0.48]];
    const tick=Math.floor(ocvTime*0.04);
    bdata.forEach(([bx,bw,bh],bi) => {
      const X=wx+bx*ww, W=bw*ww, H=bh*wh, Y=wy+wh-H;
      const bg=ctx.createLinearGradient(X,Y,X+W,Y);
      bg.addColorStop(0,'rgba(18,28,58,0.72)'); bg.addColorStop(1,'rgba(12,20,45,0.72)');
      ctx.fillStyle=bg; ctx.fillRect(X,Y,W,H);
      const rows=Math.floor(H/5), cols=Math.floor(W/5);
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
        if (prand(bi*1000+r*50+c+tick*100)>0.48) {
          ctx.fillStyle='rgba(255,215,95,0.52)'; ctx.fillRect(X+c*5+1,Y+r*5+1,2,2);
        }
      }
    });
    ctx.fillStyle=`rgba(${lvl>=5?'60,80,255':'40,65,180'},0.1)`;
    ctx.fillRect(wx,wy+wh*0.85,ww,wh*0.15);
  }
}

function ocvDeptIslands(ctx, mor) {
  const IW = 108, IH = 44, HGAP = 12, VGAP = 8;
  const OX = 6, OY = 64;
  const DESK_W = 22, DESK_GAP = 3;

  const islands = [
    { label: '社長室', col: 0, row: 0, total: state.gameStarted ? 1 : 0 },
    { label: '営業部', col: 1, row: 0, total: state.employees['sales'] || 0 },
    { label: 'FL',     col: 2, row: 0, total: state.freelancers || 0 },
    { label: '財務/経企', col: 0, row: 1, total: (state.employees['finance'] || 0) + (state.employees['strategy'] || 0) },
    { label: '人材育成', col: 1, row: 1, total: state.employees['hr'] || 0 },
    { label: 'GBL',    col: 2, row: 1, total: state.employees['global'] || 0 },
  ];

  const borderColors = [
    'rgba(255,200,50,0.45)', 'rgba(100,180,255,0.35)', 'rgba(147,197,253,0.35)',
    'rgba(100,255,180,0.35)', 'rgba(200,130,255,0.35)', 'rgba(255,140,100,0.35)',
  ];
  const bgColors = [
    'rgba(255,200,50,0.07)', 'rgba(100,180,255,0.06)', 'rgba(147,197,253,0.06)',
    'rgba(100,255,180,0.06)', 'rgba(200,130,255,0.06)', 'rgba(255,140,100,0.06)',
  ];

  ctx.save();
  islands.forEach((isl, ii) => {
    const ix    = OX + isl.col * (IW + HGAP);
    const iy    = OY + isl.row * (IH + VGAP);
    const count = Math.min(3, isl.total);

    ctx.fillStyle = bgColors[ii];
    ctx.fillRect(ix, iy, IW, IH);
    ctx.strokeStyle = borderColors[ii];
    ctx.lineWidth = 1;
    ctx.strokeRect(ix + 0.5, iy + 0.5, IW - 1, IH - 1);

    ctx.font = '6px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.textAlign = 'center';
    ctx.fillText(isl.label, ix + IW / 2, iy + 8);

    if (count === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.fillText('― 空 ―', ix + IW / 2, iy + IH / 2 + 3);
      ctx.textAlign = 'left';
      return;
    }

    const totalW = count * DESK_W + (count - 1) * DESK_GAP;
    const startX = ix + Math.floor((IW - totalW) / 2);
    const baseY  = iy + 37;
    for (let di = 0; di < count; di++) {
      ocvDesk(ctx, startX + di * (DESK_W + DESK_GAP), baseY, DESK_W, ii * 3 + di, mor, 0.55);
    }

    if (isl.total > 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.58)';
      ctx.font = 'bold 6px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`+${isl.total - 3}`, ix + IW - 3, iy + IH - 3);
    }
    ctx.textAlign = 'left';
  });
  ctx.restore();
}

function ocvPeople(ctx, count, mor) {
  if (count === 0) {
    ctx.fillStyle='rgba(255,255,255,0.16)'; ctx.font='10px sans-serif'; ctx.textAlign='center';
    ctx.fillText('まだ誰もいない...', OCV_W/2, 112); ctx.textAlign='left'; return;
  }
  const vis=Math.min(count,10), dW=54, dG=6;
  const back=Math.min(vis,5), front=Math.max(0,vis-5);
  if (back > 0) {
    const tot=back*(dW+dG)-dG, sx=(OCV_W-tot)/2;
    for (let i=0;i<back;i++) ocvDesk(ctx, sx+i*(dW+dG), 98, dW, i, mor, 0.76);
  }
  if (front > 0) {
    const tot=front*(dW+dG)-dG, sx=(OCV_W-tot)/2;
    for (let i=0;i<front;i++) ocvDesk(ctx, sx+i*(dW+dG), 140, dW, i+5, mor, 1.0);
  }
  if (count > 10) {
    ctx.fillStyle='rgba(255,255,255,0.42)'; ctx.font='bold 9px sans-serif'; ctx.textAlign='right';
    ctx.fillText(`+${count-10}名`, OCV_W-5, OCV_H-4); ctx.textAlign='left';
  }
}

function ocvDesk(ctx, x, baseY, w, idx, mor, sc) {
  const dH=Math.round(8*sc), dD=Math.round(4*sc);
  const mW=Math.round(18*sc), mH=Math.round(13*sc);
  const scr=OCV_SCREEN[idx%OCV_SCREEN.length];

  // Desk surface
  ctx.fillStyle='#5c3c18'; ctx.fillRect(x, baseY-dH, w, dH);
  ctx.fillStyle='#7a5428'; ctx.fillRect(x, baseY-dH, w, 1);
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fillRect(x, baseY-dH+1, w, 2);
  ctx.fillStyle='#3c2808'; ctx.fillRect(x, baseY, w, dD);
  // Legs
  const lw=Math.max(2,Math.round(3*sc));
  ctx.fillStyle='#2e1e06';
  ctx.fillRect(x+2, baseY+dD, lw, Math.max(2,Math.round(5*sc)));
  ctx.fillRect(x+w-2-lw, baseY+dD, lw, Math.max(2,Math.round(5*sc)));

  // Monitor body
  const mX=Math.round(x+(w-mW)/2), mY=baseY-dH-mH-1;
  ctx.fillStyle='#18182a'; ctx.fillRect(mX,mY,mW,mH);
  // Screen gradient
  const mg=ctx.createLinearGradient(mX,mY,mX,mY+mH);
  mg.addColorStop(0,scr+'cc'); mg.addColorStop(1,scr+'44');
  ctx.fillStyle=mg; ctx.fillRect(mX+1,mY+1,mW-2,mH-3);
  // Code lines on screen
  for (let l=0;l<3;l++) {
    ctx.fillStyle='rgba(255,255,255,0.45)';
    ctx.fillRect(mX+2, mY+2+l*Math.round(3.5*sc), Math.round((4+prand(idx*10+l)*8)*sc), 1);
  }
  // Screen glow halo
  ctx.globalAlpha=0.07; ctx.fillStyle=scr; ctx.fillRect(mX-3,mY-3,mW+6,mH+6); ctx.globalAlpha=1;
  // Monitor stand
  ctx.fillStyle='#18182a';
  const sw=Math.max(2,Math.round(2*sc));
  ctx.fillRect(mX+mW/2-sw/2, mY+mH, sw, Math.max(2,Math.round(3*sc)));
  ctx.fillRect(mX+mW/2-Math.round(4*sc), mY+mH+Math.round(3*sc), Math.round(8*sc), 2);

  // Keyboard
  if (sc > 0.65) {
    const kW=Math.round(mW*0.88), kH=Math.max(2,Math.round(3*sc));
    const kX=mX+Math.round((mW-kW)/2);
    ctx.fillStyle='#222232'; ctx.fillRect(kX, baseY-dH+2, kW, kH);
    ctx.fillStyle='rgba(255,255,255,0.10)'; ctx.fillRect(kX+1, baseY-dH+3, kW-2, 1);
  }
  if (sc > 0.75) {
    ctx.fillStyle='#2a2a3a'; ctx.fillRect(mX+mW+3, baseY-dH+2, Math.round(4*sc), Math.round(6*sc));
  }

  // Person
  ocvPerson(ctx, x+w/2, baseY-dH-1, idx, mor, sc);
}

function ocvPerson(ctx, cx, footY, idx, mor, sc) {
  const s=Math.max(1, sc*2.1), t=ocvTime;
  const hc=OCV_HAIR[idx%OCV_HAIR.length];
  const sc2=OCV_SHIRT[idx%OCV_SHIRT.length];
  const sk=OCV_SKIN[idx%OCV_SKIN.length];

  // Head
  const hW=Math.round(s*5.5), hH=Math.round(s*5.5);
  const hX=Math.round(cx-hW/2), hY=Math.round(footY-hH-s*3.2);

  // Hair
  ctx.fillStyle=hc;
  ctx.fillRect(hX, hY, hW, Math.round(s));
  ctx.fillRect(hX, hY+Math.round(s), Math.round(s), Math.round(s));
  ctx.fillRect(hX+hW-Math.round(s), hY+Math.round(s), Math.round(s), Math.round(s));
  ctx.fillRect(hX, hY+Math.round(s*2), Math.round(s*0.5), Math.round(s));

  // Face skin
  ctx.fillStyle=sk; ctx.fillRect(hX+Math.round(s), hY+Math.round(s), hW-Math.round(s*2), hH);

  // Eyes + blink
  const blink=Math.sin(t*0.28+idx*2.4)>0.93;
  const eyeY=hY+Math.round(s*2.3), eyeW=Math.max(1,Math.round(s*0.75));
  ctx.fillStyle='#1a0808';
  if (!blink) {
    ctx.fillRect(hX+Math.round(s*1.1), eyeY, eyeW, eyeW);
    ctx.fillRect(hX+hW-Math.round(s*1.9), eyeY, eyeW, eyeW);
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillRect(hX+Math.round(s*1.1)+1, eyeY, 1, 1);
    ctx.fillRect(hX+hW-Math.round(s*1.9)+1, eyeY, 1, 1);
  } else {
    ctx.fillRect(hX+Math.round(s*1.1), eyeY+Math.round(s*0.4), eyeW, 1);
    ctx.fillRect(hX+hW-Math.round(s*1.9), eyeY+Math.round(s*0.4), eyeW, 1);
  }

  // Mouth / expression
  const mY2=hY+hH-Math.round(s*0.6);
  ctx.fillStyle='#882020';
  if (mor < 30) {
    ctx.fillRect(hX+Math.round(s*1.2), mY2, Math.round(s*0.6), Math.round(s*0.4));
    ctx.fillRect(hX+hW-Math.round(s*1.8), mY2, Math.round(s*0.6), Math.round(s*0.4));
  } else if (mor > 70) {
    ctx.fillStyle='#cc2020';
    ctx.fillRect(hX+Math.round(s*1.0), mY2, hW-Math.round(s*2.0), Math.round(s*0.4));
  } else {
    ctx.fillRect(hX+Math.round(s*1.2), mY2, hW-Math.round(s*2.4), Math.round(s*0.4));
  }

  // Shoulders/torso
  const shW=Math.round(hW+s*2.5), shH=Math.round(s*3.2);
  const shX=Math.round(cx-shW/2), shY=Math.round(footY-shH);
  ctx.fillStyle=sc2; ctx.fillRect(shX, shY, shW, shH);
  ctx.fillStyle=lhex(sc2,0.12); ctx.fillRect(shX, shY, shW, Math.round(s*0.5));

  // Arms: typing animation
  const anim=Math.sin(t*5.5+idx*1.4)*s*0.7;
  const aW=Math.max(1,Math.round(s)), aH=Math.max(1,Math.round(s*2+anim));
  ctx.fillStyle=sc2;
  ctx.fillRect(shX-aW, shY+Math.round(s*0.5), aW, aH);
  ctx.fillRect(shX+shW, shY+Math.round(s*0.5), aW, aH);
  // Hands
  ctx.fillStyle=sk;
  const handY=shY+Math.round(s*0.5)+aH;
  ctx.fillRect(shX-aW, handY, aW, Math.max(1,Math.round(s*0.6)));
  ctx.fillRect(shX+shW, handY, aW, Math.max(1,Math.round(s*0.6)));
}

function ocvOverlay(ctx, mor, count) {
  if (mor < 30) {
    const a=(30-mor)/30;
    ctx.fillStyle=`rgba(8,0,0,${a*0.38})`; ctx.fillRect(0,0,OCV_W,OCV_H);
    ctx.fillStyle=`rgba(60,60,60,${a*0.15})`; ctx.fillRect(0,0,OCV_W,OCV_H);
  } else if (mor > 80) {
    const a=(mor-80)/20*0.055;
    ctx.fillStyle=`rgba(255,195,70,${a})`; ctx.fillRect(0,0,OCV_W,OCV_H);
  }
  // HUD chip
  const empCnt=getEmployeeCount(), cap=getCurrentCapacity(), full=empCnt>=cap&&cap>0;
  ctx.fillStyle='rgba(0,0,0,0.48)'; ctx.fillRect(4,4,108,17);
  const nm=(OFFICE_LEVELS[Math.min(state.officeLevel??0,OFFICE_LEVELS.length-1)]||{}).name||'';
  ctx.fillStyle='rgba(200,200,200,0.55)'; ctx.font='6.5px monospace';
  ctx.fillText(nm.slice(0,10), 7, 12);
  ctx.fillStyle=full?'rgba(248,100,100,0.8)':'rgba(80,215,100,0.72)';
  ctx.fillText(`\u{1F465} ${empCnt}/${cap}`, 7, 19);
}

let _ocvEventTimer = null;
function setOfficeEventFx(type) {
  const fx = document.getElementById('ov-fx');
  if (!fx) return;
  fx.className = ''; void fx.offsetWidth;
  fx.className = `fx-${type}`;
  clearTimeout(_ocvEventTimer);
  _ocvEventTimer = setTimeout(() => { const el=document.getElementById('ov-fx'); if(el) el.className=''; }, 2200);
}

function renderOfficeScene() {
  const descEl = document.getElementById('office-desc');
  if (!descEl) return;
  const m = state.morale || { ceo:70, employee:70, freelance:70 };
  const mor = (m.ceo + m.employee + m.freelance) / 3;
  if (!state.gameStarted)  descEl.textContent = '資本金 ¥10,000,000。事務所を借りてSES会社を始めよう！';
  else if (mor < 30)       descEl.textContent = '😔 重苦しい空気…誰も目を合わせない。交流会が必要かも。';
  else if (mor < 50)       descEl.textContent = '😑 疲弊した空気が漂っている。士気を上げる施策を検討しよう。';
  else if (mor > 85)       descEl.textContent = '🤩 最高の職場！全員がいきいきと輝いている！';
  else if (mor > 70)       descEl.textContent = '😊 活気に満ちたオフィス。チームの成長が感じられる。';
  else                     descEl.textContent = STAGE_DEFS[getCurrentStageIdx()].desc;
}

function renderAll() {
  renderHeader();   // renderHeader が renderOfficeScene を呼ぶ
  renderDepts();
  renderUpgrades();
  renderLabor();
  renderSlots();
  renderBank();
  renderExchange();
}

// ---- タブ切り替え ----

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.remove('hidden');
  btn.classList.add('active');
  if (tabId === 'labor')    renderLabor();
  if (tabId === 'slots')    renderSlots();
  if (tabId === 'bank')     renderBank();
  if (tabId === 'exchange') renderExchange();
}

// ---- モーダル ----

function showOfflineModal(seconds, income) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  document.getElementById('offline-time').textContent   = h > 0 ? `${h}時間${m}分` : `${m}分`;
  document.getElementById('offline-income').textContent = yen(income);
  document.getElementById('offline-modal').classList.remove('hidden');
}

function closeOfflineModal() {
  document.getElementById('offline-modal').classList.add('hidden');
}

// ---- トースト ----

function showToast(msg) {
  const el = document.createElement('div');
  el.className   = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---- メインループ ----

let lastRender       = 0;
let lastUpgradeCheck = 0;

function setGameSpeed(s) {
  state.gameSpeed = s;
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.speed) === s);
  });
}

function isGamePaused() {
  return ['weekly-modal', 'event-modal', 'expense-modal', 'ipo-modal'].some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

function gameLoop(ts) {
  const now     = Date.now();
  const rawElapsed = (now - state.lastTimestamp) / 1000;
  const elapsed = rawElapsed * (state.gameSpeed || 1);
  state.lastTimestamp = now;

  if (state.gameStarted && !state.bankrupt && !isGamePaused()) {
    state.elapsedSeconds += elapsed;

    // 収益確率変動
    let incomeVariance = 1.0;
    const rnd = Math.random();
    if      (rnd < 0.05) incomeVariance = 2.0;
    else if (rnd < 0.10) incomeVariance = 0.5;
    else if (rnd < 0.40) incomeVariance = 1.2;

    const income = getTotalIncome() * elapsed * incomeVariance;
    state.money        += income;
    state.totalEarned  += income;
    state.periodEarned  = (state.periodEarned || 0) + income;
    state.weeklyIncomeAccum = (state.weeklyIncomeAccum || 0) + income;

    // 部署別売上高積算
    const globalMult = getGlobalMultiplier();
    DEPT_DEFS.forEach(d => {
      const net = getDeptIncome(d.id) * globalMult * elapsed * incomeVariance;
      if (net > 0) {
        const gross = d.marginRate ? net / d.marginRate : net;
        state.deptRevenue[d.id] = (state.deptRevenue[d.id] || 0) + gross;
      }
    });

    // ---- 週次チェック ----
    const currentWeekNum = Math.floor(state.elapsedSeconds / WEEK_SEC);
    if (currentWeekNum > (state.lastEventWeek || 0) && currentWeekNum > 0 && !weeklyModalShowing) {
      state.lastEventWeek = currentWeekNum;

      // FL週次利益の分配（エンジニア毎ランダムレート）
      const flWeeklyGross  = getFlWeeklyGross();
      const flWeeklyIncome = getFlWeeklyIncome();
      const flWeeklyCost   = flWeeklyGross - flWeeklyIncome;
      if (flWeeklyIncome > 0) {
        state.money += flWeeklyIncome;
        state.totalEarned += flWeeklyIncome;
        state.periodEarned = (state.periodEarned || 0) + flWeeklyIncome;
        state.deptRevenue['freelancer'] = (state.deptRevenue['freelancer'] || 0) + flWeeklyIncome;
        state.flGrossRevenue = (state.flGrossRevenue || 0) + flWeeklyGross;
      }

      // 月次経費（4週ごと）
      let monthlyExp = null;
      const beforeMoney = state.money;
      const isMonthEnd = currentWeekNum > 0 && (currentWeekNum % MONTH_WEEKS) === 0;
      if (isMonthEnd) {
        const lastExp    = state.lastExpenseWeek || 0;
        const expDueWeek = Math.floor(currentWeekNum / EXPENSE_WEEK) * EXPENSE_WEEK;
        if (expDueWeek > 0 && expDueWeek > lastExp) {
          state.lastExpenseWeek = expDueWeek;
          monthlyExp = calcMonthlyExpenses();
          state.loans.forEach(l => {
            const pay = Math.min(l.remaining, l.monthlyPayment);
            l.remaining -= pay;
          });
          state.loans = state.loans.filter(l => l.remaining > 0);
          state.money -= monthlyExp.total;
        }
      }

      // 週次イベント（週次モーダルを閉じた後に適用・表示）
      if (Math.random() < 0.75) {
        const ev = WEEK_EVENTS[Math.floor(Math.random() * WEEK_EVENTS.length)];
        setOfficeEventFx(ev.type);
        pendingWeeklyEvent = ev;
      }

      // モラル低下
      ['ceo','employee','freelance'].forEach(k => {
        state.morale[k] = Math.max(10, (state.morale[k] || 70) - 2);
      });

      // FL採用
      const salesCount    = state.employees['sales'] || 0;
      const recruitChance = getRecruitChance();
      const hiredWeek = currentWeekNum;
      let newFL = 0;
      for (let i = 0; i < salesCount; i++) {
        if (Math.random() < recruitChance) {
          if (!state.flData) state.flData = [];
          state.flData.push({ gross: 600000 + Math.floor(Math.random() * 400001), profitRate: 0.10 + Math.random() * 0.10, hiredWeek });
          state.freelancers = state.flData.length;
          newFL++;
        }
      }
      if (newFL > 0) showToast(`👨‍💻 フリーランス ${newFL}名が採用されました！`);

      // 週次サマリーモーダル表示
      showWeeklyModal(currentWeekNum, state.weeklyIncomeAccum || 0, flWeeklyIncome, flWeeklyGross, flWeeklyCost, monthlyExp, beforeMoney);
      state.weeklyIncomeAccum = 0;
    }

    // ---- 3月決算（毎期末） ----
    const currentPeriod = Math.floor(currentWeekNum / YEAR_WEEKS);
    if (currentPeriod > (state.lastTaxPeriod || 0) && currentWeekNum > 0) {
      state.lastTaxPeriod = currentPeriod;
      processCorpTax();
    }
  }

  if (ts - lastRender > 100) {
    lastRender = ts;
    renderHeader();
  }
  if (ts - lastUpgradeCheck > 1000) {
    lastUpgradeCheck = ts;
    renderUpgrades();
    checkIPO();
  }

  requestAnimationFrame(gameLoop);
}

setInterval(save, 5000);

window.addEventListener('DOMContentLoaded', () => {
  load();
  setGameSpeed(state.gameSpeed || 1);
  renderAll();
  initOCV();
  requestAnimationFrame(gameLoop);
});
