'use strict';

// ============================================================
// 廃墟再生株式会社 - ゲームロジック v3
// ============================================================

const SAVE_KEY       = 'haikisei_v3';
const SLOT_KEYS      = [null, 'haikisei_slot_1', 'haikisei_slot_2', 'haikisei_slot_3'];
const MAX_OFFLINE_SEC = 4 * 3600;

// ---- 時間定数 ----
const WEEK_SEC     = 60;   // 1ゲーム週 = 60リアル秒
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
    recruitChance: 0.25,     // 週25%でFLエンジニア1名採用
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
    desc: '高待遇オファーにより稼働中のエンジニアが突然退場した。FL信頼度が高いほど被害が少ない。',
    effect: s => {
      const loyalty = s.morale?.freelance ?? 50;
      let maxLoss;
      if      (loyalty >= 75) maxLoss = 0;
      else if (loyalty >= 50) maxLoss = 1;
      else if (loyalty >= 30) maxLoss = 3;
      else                    maxLoss = 5;
      const loss = Math.min(s.freelancers || 0, maxLoss);
      s.freelancers = Math.max(0, (s.freelancers || 0) - loss);
      if (loss === 0 && (s.freelancers || 0) > 0) return `引き抜き防止成功！（FL信頼度${loyalty}）`;
      return loss > 0 ? `FL${loss}名が離脱（FL信頼度: ${loyalty}）` : 'FLなし（被害なし）';
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
  { id: 'u_crm',      name: '案件管理システム導入',    emoji: '🗂️', cost: 5000000,     dept: 'sales',      mult: 1.5, req: { sales: 1 },    durationWeeks: 4 },
  { id: 'u_network',  name: '人材エージェント連携',    emoji: '🤝', cost: 80000000,    dept: 'sales',      mult: 1.5, req: { sales: 5 },    durationWeeks: 4 },
  { id: 'u_brand',    name: 'SESブランド確立',         emoji: '🏆', cost: 800000000,   dept: 'sales',      mult: 2,   req: { sales: 15 },   durationWeeks: 8 },
  { id: 'u_vision',   name: 'ビジョン採用戦略',        emoji: '🚩', cost: 8000000000,  dept: 'sales',      mult: 2,   req: { sales: 30 },   durationWeeks: 8 },
  // フリーランス単価UP
  { id: 'u_skill',    name: '単価交渉マニュアル整備',  emoji: '📋', cost: 8000000,     dept: 'freelancer', mult: 1.5, req: { sales: 1 },    durationWeeks: 4 },
  { id: 'u_niche',    name: 'ニッチ技術特化戦略',      emoji: '🔬', cost: 100000000,   dept: 'freelancer', mult: 1.5, req: { sales: 5 },    durationWeeks: 4 },
  { id: 'u_prime',    name: 'プライム案件専任体制',    emoji: '🥇', cost: 1000000000,  dept: 'freelancer', mult: 2,   req: { sales: 10 },   durationWeeks: 8 },
  { id: 'u_aidev',    name: 'AI・クラウド専門化',      emoji: '🤖', cost: 10000000000, dept: 'freelancer', mult: 2,   req: { sales: 20 },   durationWeeks: 8 },
  // 管理部門
  { id: 'u_training', name: '体系的研修プログラム',    emoji: '📚', cost: 500000000,   dept: 'hr',         mult: 2,   req: { hr: 1 },       durationWeeks: 8 },
  { id: 'u_accounting',name:'単価交渉強化マニュアル',  emoji: '💹', cost: 8000000000,  dept: 'finance',    mult: 2,   req: { finance: 1 },  durationWeeks: 8 },
  { id: 'u_mba',      name: '中長期SES戦略策定',       emoji: '🗺️', cost: 80000000000, dept: 'strategy',   mult: 2,   req: { strategy: 1 }, durationWeeks: 12 },
  { id: 'u_english',  name: '英語対応スキルシート整備', emoji: '🗣️', cost: 500000000000, dept: 'global',   mult: 2,   req: { global: 1 },   durationWeeks: 12 },
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
  freelancers: 0,         // フリーランスエンジニア人数（稼働中）
  pendingFreelancers: 0,  // 翌週から稼働するFL（採用済・未稼働）
  officeLevel: 0,         // 事務所レベル (0=なし, 1-6)
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
  // FLは客先常駐のためオフィス定員に含めない
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

function getMaxFL() {
  return (state.employees['sales'] || 0) * 15;
}

function getRecruitChance() {
  const salesMult   = state.deptMults['sales'] || 1;
  const hrBonus     = (state.employees['hr'] || 0) * 0.03;
  const moraleBonus = ((state.morale?.employee ?? 50) - 50) / 50 * 0.15;
  return Math.min(0.95, (0.25 + hrBonus + Math.max(-0.15, moraleBonus)) * salesMult);
}

function recalcMults() {
  const currentWeekNum = Math.floor((state.elapsedSeconds || 0) / WEEK_SEC);
  DEPT_DEFS.forEach(d => { state.deptMults[d.id] = 1; });
  state.freelancerMult = 1;
  UPGRADE_DEFS.forEach(def => {
    const exp = state.upgrades[def.id];
    if (typeof exp === 'number' && exp > currentWeekNum) {
      if (def.dept === 'freelancer') {
        state.freelancerMult = (state.freelancerMult || 1) * def.mult;
      } else {
        state.deptMults[def.dept] = (state.deptMults[def.dept] || 1) * def.mult;
      }
    }
  });
}

function getDeptIncome(deptId) {
  const def = DEPT_DEFS.find(d => d.id === deptId);
  if (!def || def.special || def.incomePerSec === 0) return 0;
  return def.incomePerSec * (state.employees[deptId] || 0) * (state.deptMults[deptId] || 1);
}

function getFreelancerBaseIncome() {
  return 0; // FL収益は週次で¥25,000/人として分配
}

// FL週次利益の平均値（売上¥600K〜¥1,000K × 利益率10〜15% の期待値）
function getFLWeeklyIncomeAvg() {
  const fl = state.freelancers || 0;
  if (fl === 0) return 0;
  const flMorale    = state.morale?.freelance ?? 50;
  const moraleBonus = (flMorale - 50) / 50 * 0.05;
  const avgMargin   = Math.min(0.25, 0.125 + moraleBonus);
  return Math.floor(fl * 800000 * avgMargin / 4 * (state.freelancerMult || 1) * getGlobalMultiplier());
}

// 表示用週次収益（部署の秒収益×WEEK_SEC + FL週次利益平均）
function getDisplayWeeklyIncome() {
  return getTotalIncome() * WEEK_SEC + getFLWeeklyIncomeAvg();
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
  if (getTotalPeople() >= getCurrentCapacity()) {
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
  const def = UPGRADE_DEFS.find(u => u.id === upgradeId);
  if (!def || state.money < def.cost) { showToast('資金が足りません！'); return; }
  const currentWeekNum = Math.floor((state.elapsedSeconds || 0) / WEEK_SEC);
  const existing = state.upgrades[upgradeId];
  if (typeof existing === 'number' && existing > currentWeekNum) {
    showToast('⚠️ すでに適用中です');
    return;
  }
  state.money -= def.cost;
  state.upgrades[upgradeId] = currentWeekNum + def.durationWeeks;
  if (def.dept !== 'freelancer') {
    state.deptCost[def.dept] = (state.deptCost[def.dept] || 0) + def.cost;
  }
  recalcMults();
  const deptName = def.dept === 'freelancer' ? 'FL単価' : (DEPT_DEFS.find(d => d.id === def.dept)?.name || '');
  showToast(`✅ ${def.name} 導入！${deptName} ×${def.mult}（${def.durationWeeks}週間有効）`);
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
  const totalPeople = getTotalPeople();
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

  const loanPay = state.loans.reduce((a, l) => a + Math.min(l.remaining, l.monthlyPayment), 0);

  return {
    rent, utilities, supplies,
    salesperson, loanPay,
    total: rent + utilities + supplies + salesperson + loanPay,
  };
}

function showExpenseModal(exp, before) {
  let rows = '';
  if (exp.rent > 0)          rows += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(exp.rent)}</span></div>`;
  if (exp.utilities > 0)     rows += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(exp.utilities)}</span></div>`;
  if (exp.supplies > 0)      rows += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(exp.supplies)}</span></div>`;
  if (exp.salesperson > 0)   rows += `<div class="expense-row"><span>👔 営業部 人件費＋社保</span><span>−${yen(exp.salesperson)}</span></div>`;
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

function showWeeklyModal(weekNum, deptIncome, flIncome, monthlyExp, beforeMoney) {
  const period       = Math.floor((weekNum - 1) / YEAR_WEEKS) + 1;
  const monthNum     = Math.floor(((weekNum - 1) % YEAR_WEEKS) / MONTH_WEEKS) + 1;
  const weekInMonth  = ((weekNum - 1) % MONTH_WEEKS) + 1;
  const totalIncome  = deptIncome + flIncome;

  let html = '';
  html += `<div class="expense-row" style="color:#4ade80"><span>🏢 部署収益</span><span>＋${yen(Math.floor(deptIncome))}</span></div>`;
  if (flIncome > 0) {
    html += `<div class="expense-row" style="color:#4ade80"><span>👨‍💻 FL利益（${state.freelancers}名）</span><span>＋${yen(Math.floor(flIncome))}</span></div>`;
  }
  const pendingFL = state.pendingFreelancers || 0;
  if (pendingFL > 0) {
    html += `<div class="expense-row" style="color:#60a5fa"><span>👨‍💻 来週稼働開始FL</span><span>＋${pendingFL}名</span></div>`;
  }
  html += `<div class="expense-row" style="font-weight:700;color:#4ade80;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>収入合計</span><span>＋${yen(Math.floor(totalIncome))}</span></div>`;

  if (monthlyExp) {
    html += `<div class="weekly-section-title">📋 月次経費（第${monthNum}月末）</div>`;
    if (monthlyExp.rent > 0)        html += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(monthlyExp.rent)}</span></div>`;
    if (monthlyExp.utilities > 0)   html += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(monthlyExp.utilities)}</span></div>`;
    if (monthlyExp.supplies > 0)    html += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(monthlyExp.supplies)}</span></div>`;
    if (monthlyExp.salesperson > 0) html += `<div class="expense-row"><span>👔 営業部 人件費</span><span>−${yen(monthlyExp.salesperson)}</span></div>`;
    if (monthlyExp.loanPay > 0)     html += `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(monthlyExp.loanPay)}</span></div>`;
    html += `<div class="expense-row" style="font-weight:700;color:#f87171;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>支出合計</span><span>−${yen(monthlyExp.total)}</span></div>`;
    const net = Math.floor(totalIncome) - monthlyExp.total;
    const netColor = net >= 0 ? '#4ade80' : '#f87171';
    html += `<div class="expense-row" style="font-weight:800;font-size:14px;color:${netColor};margin-top:4px"><span>週次収支</span><span>${net >= 0 ? '＋' : '−'}${yen(Math.abs(net))}</span></div>`;
    html += `<div class="expense-balance" style="margin-top:8px"><div>引落前: ${yen(beforeMoney)}</div><div style="color:${state.money < 0 ? '#f87171' : '#4ade80'}">引落後: ${yen(state.money)}</div></div>`;
  }

  document.getElementById('weekly-period').textContent = `第${period}期 第${monthNum}月 第${weekInMonth}週`;
  document.getElementById('weekly-detail').innerHTML = html;
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
        ${exp.loanPay > 0 ? `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>${yen(exp.loanPay)}</span></div>` : ''}
        <div class="expense-row" style="font-weight:700"><span>合計</span><span>${yen(exp.total)}</span></div>
      </div>
    </div>`;
}

// ---- 交流タブ（精神状況） ----

const EXCHANGE_ACTIONS = [
  { id: 'ex_party',       name: '🍻 社内交流会',          desc: '社員・FLの士気を上げる懇親会',            cost: () => Math.max(500000, getTotalIncome() * 200),    targets: ['employee','freelance'], gain: 8,  color: '#4ade80', flOnly: false },
  { id: 'ex_seminar',     name: '📚 研修・セミナー開催',   desc: '社員のスキルアップと充実感を高める',        cost: () => Math.max(2000000, getTotalIncome() * 500),   targets: ['employee'],             gain: 12, color: '#60a5fa', flOnly: false },
  { id: 'ex_ceo_round',   name: '☕ 社長懇談会',           desc: '社長が社員と直接対話。全員の士気UP',        cost: () => Math.max(1000000, getTotalIncome() * 300),   targets: ['ceo','employee'],        gain: 10, color: '#a78bfa', flOnly: false },
  { id: 'ex_client',      name: '🥂 クライアント接待',     desc: '社長が得意先を接待。社長の士気が大幅UP',    cost: () => Math.max(3000000, getTotalIncome() * 800),   targets: ['ceo'],                  gain: 20, color: '#fbbf24', flOnly: false },
  { id: 'ex_retreat',     name: '🏔️ 合宿・チームビルディング', desc: '全員参加の泊まり込み合宿',           cost: () => Math.max(10000000, getTotalIncome() * 2000), targets: ['ceo','employee','freelance'], gain: 18, color: '#f97316', flOnly: false },
  { id: 'ex_bonus',       name: '💴 特別ボーナス支給',     desc: '社員・FLへの臨時ボーナスで大幅改善',       cost: () => Math.max(20000000, getTotalIncome() * 4000), targets: ['employee','freelance'], gain: 25, color: '#ec4899', flOnly: false },
  { id: 'ex_fl_talk',     name: '💬 FL個別面談',           desc: 'FL1人ひとりと面談し、信頼度を高める',       cost: () => Math.max(1000000, getTotalIncome() * 250),   targets: ['freelance'],            gain: 15, color: '#60a5fa', flOnly: true },
  { id: 'ex_fl_study',    name: '📖 FL向け勉強会',         desc: 'スキルアップ機会を提供してFL定着率を向上',  cost: () => Math.max(500000, getTotalIncome() * 100),    targets: ['freelance'],            gain: 10, color: '#34d399', flOnly: true },
  { id: 'ex_fl_salary',   name: '💰 FL単価交渉支援',       desc: 'FL単価をUPして引き抜き耐性を大幅改善',      cost: () => Math.max(5000000, getTotalIncome() * 1000),  targets: ['freelance'],            gain: 25, color: '#fbbf24', flOnly: true },
];

function doExchangeAction(actionId) {
  const action = EXCHANGE_ACTIONS.find(a => a.id === actionId);
  if (!action) return;
  const cost = action.cost();
  if (state.money < cost) { showToast('💸 資金が不足しています'); return; }
  state.money -= cost;
  action.targets.forEach(t => { state.morale[t] = Math.min(100, (state.morale[t] || 50) + action.gain); });
  showToast(`${action.name}を実施！士気+${action.gain}`);
  renderAll();
}

function renderExchange() {
  const container = document.getElementById('exchange-content');
  if (!container) return;

  const m = state.morale;
  const mc  = v => v >= 70 ? '#4ade80' : v >= 40 ? '#fbbf24' : '#f87171';
  const ml  = v => v >= 80 ? '絶好調' : v >= 60 ? '普通' : v >= 40 ? '疲弊中' : '崩壊寸前';
  const avg = (m.ceo + m.employee + m.freelance) / 3;
  const eff = ((avg - 50) * 0.01 * 100).toFixed(0);

  const rows = [
    { key: 'ceo', label: '👔 社長' },
    { key: 'employee', label: '👨‍💼 社員' },
    { key: 'freelance', label: '💻 フリーランス' },
  ].map(({ key, label }) => {
    const v = m[key] || 50;
    return `<div class="morale-row">
      <span class="morale-label">${label}</span>
      <div class="morale-bar-wrap"><div class="morale-bar" style="width:${v}%;background:${mc(v)}"></div></div>
      <span class="morale-value" style="color:${mc(v)}">${v}</span>
      <span style="font-size:11px;color:${mc(v)};min-width:52px;text-align:right">${ml(v)}</span>
    </div>`;
  }).join('');

  const makeBtnHtml = (a) => {
    const cost = a.cost();
    const ok   = state.money >= cost;
    return `<button class="exchange-btn" onclick="doExchangeAction('${a.id}')" ${ok ? '' : 'disabled'}>
      <div class="exchange-btn-left">
        <span class="exchange-btn-name">${a.name}</span>
        <span class="exchange-btn-desc">${a.desc}</span>
      </div>
      <div class="exchange-btn-right">
        <span class="exchange-btn-cost" style="color:${ok ? '#fbbf24' : '#666'}">¥${fmt(cost)}</span>
        <span class="exchange-btn-effect" style="color:${a.color}">FL信頼度+${a.gain}</span>
      </div>
    </button>`;
  };

  const generalBtns = EXCHANGE_ACTIONS.filter(a => !a.flOnly).map(a => {
    const cost = a.cost();
    const ok   = state.money >= cost;
    return `<button class="exchange-btn" onclick="doExchangeAction('${a.id}')" ${ok ? '' : 'disabled'}>
      <div class="exchange-btn-left">
        <span class="exchange-btn-name">${a.name}</span>
        <span class="exchange-btn-desc">${a.desc}</span>
      </div>
      <div class="exchange-btn-right">
        <span class="exchange-btn-cost" style="color:${ok ? '#fbbf24' : '#666'}">¥${fmt(cost)}</span>
        <span class="exchange-btn-effect" style="color:${a.color}">士気+${a.gain}</span>
      </div>
    </button>`;
  }).join('');

  const flLoyalty = m.freelance || 50;
  const flCount   = state.freelancers || 0;
  let riskText, riskColor;
  if      (flLoyalty >= 75) { riskText = 'なし（引き抜き防止）';  riskColor = '#4ade80'; }
  else if (flLoyalty >= 50) { riskText = '低（最大1名離脱）';     riskColor = '#a3e635'; }
  else if (flLoyalty >= 30) { riskText = '中（最大3名離脱）';     riskColor = '#fbbf24'; }
  else                       { riskText = '高（最大5名離脱）';     riskColor = '#f87171'; }

  const flBtns = EXCHANGE_ACTIONS.filter(a => a.flOnly).map(makeBtnHtml).join('');

  const flSection = flCount > 0 ? `
    <div class="fl-retention-box">
      <div class="fl-retention-title">🔐 FL定着管理</div>
      <div class="fl-risk-row">
        <span>引き抜きリスク</span>
        <span style="color:${riskColor};font-weight:700">${riskText}</span>
      </div>
      <div class="fl-risk-bar-row">
        <span style="min-width:60px;color:#94a3b8">FL信頼度</span>
        <div class="morale-bar-wrap" style="flex:1">
          <div class="morale-bar" style="width:${flLoyalty}%;background:${mc(flLoyalty)}"></div>
        </div>
        <span style="color:${mc(flLoyalty)};min-width:28px;text-align:right;font-weight:700">${flLoyalty}</span>
      </div>
      <div class="exchange-action-title" style="margin-top:10px">💼 FL定着アクション</div>
      ${flBtns}
    </div>` : '';

  container.innerHTML = `
    <div class="exchange-morale-box">
      <div class="exchange-morale-title">📊 精神状況メーター</div>
      ${rows}
      <div class="morale-effect">売上影響: <strong style="color:${Number(eff)>=0?'#4ade80':'#f87171'}">${Number(eff)>=0?'+':''}${eff}%</strong>（平均 ${avg.toFixed(0)}/100）</div>
    </div>
    ${flSection}
    <div class="exchange-actions">
      <div class="exchange-action-title">🤝 社内政治アクション</div>
      ${generalBtns}
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
  renderAll();
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
    if (!state.weeklyIncomeAccum)    state.weeklyIncomeAccum    = 0;
    if (state.gameSpeed === undefined) state.gameSpeed = 1;
    if (!state.pendingFreelancers)   state.pendingFreelancers   = 0;
    // 旧boolean upgrade → 期限切れ扱い（再購入可能に）
    Object.keys(state.upgrades).forEach(id => {
      if (state.upgrades[id] === true) state.upgrades[id] = 0;
    });
    recalcMults();
    if (offlineSec > 30) {
      const deptIncome      = getTotalIncome() * offlineSec;
      const offlineWeeks    = Math.floor(offlineSec / WEEK_SEC);
      const flOfflineIncome = getFLWeeklyIncomeAvg() * offlineWeeks;
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
    if (offlineSec > 30) {
      const deptIncome      = getTotalIncome() * offlineSec;
      const offlineWeeks    = Math.floor(offlineSec / WEEK_SEC);
      const flOfflineIncome = getFLWeeklyIncomeAvg() * offlineWeeks;
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

function renderDepts() {
  const container = document.getElementById('depts-list');
  let html = '';

  // ---- 事務所情報カード ----
  const curLvl  = state.officeLevel ?? 0;
  const offlvl  = OFFICE_LEVELS[curLvl];
  const total   = getTotalPeople();
  const cap     = getCurrentCapacity();
  const nextLvl = OFFICE_LEVELS[curLvl + 1];

  if (curLvl === 0) {
    // 事務所なし → 借りるボタンを大きく表示
    const firstOffice = OFFICE_LEVELS[1];
    const canAfford = state.money >= firstOffice.upgradeCost;
    html += `<div class="dept-card" style="border-color:#fbbf24;border-width:2px">
      <div class="dept-emoji">🏢</div>
      <div class="dept-info">
        <div class="dept-name" style="color:#fbbf24">事務所を借りる</div>
        <div class="dept-desc">まず事務所を契約して営業を雇えるようにしよう。資本金 ¥10,000,000 を活用して。</div>
        <div class="dept-income" style="color:#fbbf24">→ ${firstOffice.name}（${firstOffice.capacity}名収容）¥${fmt(firstOffice.upgradeCost)}</div>
      </div>
      <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="upgradeOffice()">
        契約<br><small>${yen(firstOffice.upgradeCost)}</small>
      </button>
    </div>`;
  } else {
    const capPct   = cap > 0 ? Math.min(100, total / cap * 100) : 0;
    const capColor = capPct >= 90 ? '#f87171' : capPct >= 70 ? '#fbbf24' : '#4ade80';
    const fl       = state.freelancers || 0;
    const pFL      = state.pendingFreelancers || 0;
    const upgradeBtn = nextLvl
      ? `<button class="hire-btn${state.money >= nextLvl.upgradeCost ? '' : ' disabled'}" onclick="upgradeOffice()">
          移転<br><small>${yen(nextLvl.upgradeCost)}</small>
         </button>`
      : `<div style="font-size:11px;color:#4ade80;text-align:center">最大</div>`;

    html += `<div class="dept-card active" style="border-color:${capColor}">
      <div class="dept-emoji">🏢</div>
      <div class="dept-info">
        <div class="dept-name">${offlvl.name} <span class="emp-count">社員 ${total}/${cap}名</span></div>
        <div class="dept-desc">
          ${nextLvl ? `次: ${nextLvl.name} (${nextLvl.capacity}名収容) → ${yen(nextLvl.upgradeCost)}` : '最大規模の事務所'}
          ${fl > 0 ? `<br><span style="color:#60a5fa">💻 FL ${fl}名稼働中${pFL > 0 ? `（＋${pFL}名来週稼働）` : ''}</span>` : ''}
        </div>
        <div class="dept-income">
          <div style="background:#2a2a50;border-radius:4px;height:6px;overflow:hidden;margin-top:4px">
            <div style="height:100%;width:${capPct}%;background:${capColor};border-radius:4px"></div>
          </div>
        </div>
      </div>
      ${upgradeBtn}
    </div>`;
  }

  // ---- フリーランスエンジニア現員カード ----
  const fl     = state.freelancers || 0;
  const pfl    = state.pendingFreelancers || 0;
  const maxFL  = getMaxFL();
  const salesCount    = state.employees['sales'] || 0;
  const recruitChance = getRecruitChance();
  const flMorale      = state.morale?.freelance ?? 50;
  const moraleBonus   = (flMorale - 50) / 50 * 0.05;
  const avgMargin     = Math.min(0.25, 0.125 + moraleBonus);
  const flWeeklyTotal = Math.floor(fl * 800000 * avgMargin / 4 * (state.freelancerMult || 1) * getGlobalMultiplier());
  const minMarginPct  = Math.floor((0.10 + Math.max(0, (flMorale - 50) / 50 * 0.03)) * 100);
  const maxMarginPct  = Math.ceil((0.15 + Math.max(0, (flMorale - 50) / 50 * 0.05)) * 100);
  const atCap = maxFL > 0 && (fl + pfl) >= maxFL;

  html += `<div class="dept-card ${fl > 0 ? 'active' : ''}" style="border-color:#60a5fa">
    <div class="dept-emoji">👨‍💻</div>
    <div class="dept-info">
      <div class="dept-name" style="color:#60a5fa">フリーランスエンジニア <span class="emp-count">${fl}名稼働中${pfl > 0 ? `（＋${pfl}名来週〜）` : ''}</span></div>
      <div class="dept-desc">売上¥600K〜¥1,000K/月（ランダム）×利益率${minMarginPct}〜${maxMarginPct}%。FL士気が高いほど利益率UP。採用翌週から稼働。</div>
      <div class="dept-income">
        週次利益(平均): ${fl > 0 ? yen(flWeeklyTotal) + '/週' : '―'}
        <span style="color:${atCap ? '#f87171' : '#60a5fa'}"> | 上限: ${fl + pfl}/${maxFL}名</span>
      </div>
      ${salesCount > 0 ? `<div class="dept-margin">
        <span class="ml" style="color:${atCap ? '#f87171' : '#a78bfa'}">${atCap ? '⚠️ 上限到達（営業を増やすと拡大）' : `採用確率 ${(recruitChance*100).toFixed(1)}%/週/営業 × ${salesCount}名`}</span>
      </div>` : '<div class="dept-margin"><span class="ml" style="color:#666">営業部を雇うと毎週採用活動（1人あたり最大15名管理）</span></div>'}
    </div>
  </div>`;

  // ---- 部署カード ----
  DEPT_DEFS.forEach(def => {
    const emp      = state.employees[def.id] || 0;
    const unlocked = state.totalEarned >= def.unlockAt || emp > 0;

    if (!unlocked && def.unlockAt > state.totalEarned * 20 && state.totalEarned > 0) return;
    if (!unlocked && def.unlockAt > 0 && state.totalEarned === 0) return;

    if (!unlocked) {
      html += `<div class="dept-card locked">
        <div class="dept-emoji">🔒</div>
        <div class="dept-info">
          <div class="dept-name">${def.name}</div>
          <div class="dept-unlock">累計売上 ${yen(def.unlockAt)} で解放</div>
        </div>
      </div>`;
      return;
    }

    const hireCost = getHireCost(def.id);
    const atCap    = getTotalPeople() >= getCurrentCapacity();
    const canAfford = state.money >= hireCost && !atCap;

    let incomeText = '';
    if (def.special === 'multiplier') {
      incomeText = `全体収益 ×${(1 + def.specialValue * emp).toFixed(2)}`;
    } else if (def.special === 'costReduction') {
      const r = (1 - getCostReduction()) * 100;
      incomeText = `採用コスト −${Math.min(r, 90).toFixed(0)}%　FL採用確率 ＋${(emp * 3).toFixed(0)}%`;
    } else if (def.id === 'sales') {
      incomeText = `週採用確率 ${(getRecruitChance()*100).toFixed(1)}%/人　（月次固定費 ${yen(Math.ceil(def.monthlySalary * (1 + def.insuranceRate) * emp))}/月）`;
    } else {
      const inc = getDeptIncome(def.id);
      incomeText = `${yen(inc * WEEK_SEC)}/週（${yen(def.incomePerSec * (state.deptMults[def.id]||1) * WEEK_SEC)}/週/人）`;
    }

    html += `<div class="dept-card ${emp > 0 ? 'active' : ''}">
      <div class="dept-emoji">${def.emoji}</div>
      <div class="dept-info">
        <div class="dept-name">${def.name} <span class="emp-count">${emp}人</span></div>
        <div class="dept-desc">${def.desc}</div>
        <div class="dept-income">${incomeText}</div>
      </div>
      <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="hire('${def.id}')">
        採用<br><small>${atCap ? '満員' : yen(hireCost)}</small>
      </button>
    </div>`;
  });

  container.innerHTML = html;
}

function renderUpgrades() {
  const currentWeekNum = Math.floor((state.elapsedSeconds || 0) / WEEK_SEC);
  const container = document.getElementById('upgrades-list');
  let activeHtml = '';
  let purchaseHtml = '';
  let count = 0;

  UPGRADE_DEFS.forEach(def => {
    const exp = state.upgrades[def.id];
    const isActive = typeof exp === 'number' && exp > currentWeekNum;
    const deptName = def.dept === 'freelancer' ? '👨‍💻 FL単価'
                   : (DEPT_DEFS.find(d => d.id === def.dept)?.name || '');

    if (isActive) {
      const remaining = exp - currentWeekNum;
      activeHtml += `<div class="upgrade-card active-upgrade">
        <div class="upgrade-emoji">${def.emoji}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">${def.name}</div>
          <div class="upgrade-effect">${deptName} ×${def.mult}</div>
          <div class="upgrade-remaining">残り ${remaining}週</div>
        </div>
        <div class="upgrade-active-badge">✅ 適用中</div>
      </div>`;
      return;
    }

    const reqMet = Object.entries(def.req).every(([id, n]) => (state.employees[id] || 0) >= n);
    if (!reqMet) return;
    count++;
    const canAfford = state.money >= def.cost;
    const isExpired = typeof exp === 'number' && exp <= currentWeekNum;
    purchaseHtml += `<div class="upgrade-card${canAfford ? '' : ' cant-afford'}">
      <div class="upgrade-emoji">${def.emoji}</div>
      <div class="upgrade-info">
        <div class="upgrade-name">${def.name}${isExpired ? ' 🔄' : ''}</div>
        <div class="upgrade-effect">${deptName} ×${def.mult}</div>
        <div class="upgrade-cost">${yen(def.cost)}<span class="upgrade-duration">/${def.durationWeeks}週間</span></div>
      </div>
      <button class="buy-btn${canAfford ? '' : ' disabled'}" onclick="buyUpgrade('${def.id}')">${isExpired ? '再購入' : '購入'}</button>
    </div>`;
  });

  let html = '';
  if (activeHtml) {
    html += `<div class="upgrade-section-title">⚡ 適用中</div>${activeHtml}`;
  }
  if (purchaseHtml) {
    html += `<div class="upgrade-section-title">🛒 購入可能</div>${purchaseHtml}`;
  }
  if (!html) {
    html = '<div class="empty-msg">部署に社員を雇うと<br>アップグレードが解放されます 🔓</div>';
  }

  const badge = document.getElementById('upgrade-badge');
  badge.textContent = count > 0 ? count : '';
  badge.style.display = count > 0 ? 'flex' : 'none';
  container.innerHTML = html;
}

function renderStats() {
  const income     = getTotalIncome();
  const totalEmp   = Object.values(state.employees).reduce((a, b) => a + b, 0);
  const fl         = state.freelancers || 0;
  const boughtUpgrades = Object.keys(state.upgrades).length;
  const gt         = getGameTime();

  const totalRevenue  = Object.values(state.deptRevenue).reduce((a, b) => a + b, 0);
  const totalInvested = Object.values(state.deptCost).reduce((a, b) => a + b, 0);

  // P&L: フリーランス収益行
  const MONTH_SEC  = EXPENSE_WEEK * WEEK_SEC;
  const flRevMonth = fl * 600000;  // 月次gross
  const flCostMonth = fl * 500000; // 月次FL報酬
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

  document.getElementById('stats-content').innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-label">第${gt.period}期 ${gt.month}月目</div><div class="stat-value">第${gt.week}週</div></div>
      <div class="stat-item"><div class="stat-label">社員数</div><div class="stat-value">${totalEmp}名</div></div>
      <div class="stat-item"><div class="stat-label">FL在籍</div><div class="stat-value">${fl}名</div></div>
      <div class="stat-item"><div class="stat-label">週次収益</div><div class="stat-value">${yen(getDisplayWeeklyIncome())}/週</div></div>
      <div class="stat-item"><div class="stat-label">累計売上</div><div class="stat-value">${yen(state.totalEarned)}</div></div>
      <div class="stat-item"><div class="stat-label">当期収益</div><div class="stat-value">${yen(state.periodEarned)}</div></div>
      <div class="stat-item"><div class="stat-label">上場回数</div><div class="stat-value">${state.prestige}回</div></div>
      <div class="stat-item"><div class="stat-label">株主倍率</div><div class="stat-value">×${state.prestigeMult.toFixed(1)}</div></div>
      <div class="stat-item"><div class="stat-label">FL単価倍率</div><div class="stat-value">×${(state.freelancerMult||1).toFixed(2)}</div></div>
    </div>

    ${plRows ? `
    <div class="pl-table-wrap">
      <div class="pl-header">
        <span>📋 部署別 損益計算書（累計）</span>
      </div>
      <table class="pl-table">
        <thead><tr><th>部署</th><th>売上高</th><th>販管費</th><th>採用/強化</th><th>利益率</th></tr></thead>
        <tbody>${plRows}</tbody>
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

// ---- オフィスビジュアル ----

const OFFICE_DECO = [
  { plants: '',   plate: '' },
  { plants: '🌱', plate: '📋' },
  { plants: '🪴', plate: '📋' },
  { plants: '🌿', plate: '🏷️' },
  { plants: '🌳', plate: '📊' },
  { plants: '🌲', plate: '🏆' },
  { plants: '🌴', plate: '🏆' },
];
const OFFICE_WINDOW_ICONS = ['⛈️','🌙','☁️','🌤️','🌇','🌆','🌃'];

let _officeRenderKey = '';
let _officeEventTimer = null;

function setOfficeEventFx(type) {
  const fx = document.getElementById('ov-fx');
  if (!fx) return;
  fx.className = '';
  void fx.offsetWidth; // reflow to restart animation
  fx.className = `fx-${type}`;
  clearTimeout(_officeEventTimer);
  _officeEventTimer = setTimeout(() => {
    const el = document.getElementById('ov-fx');
    if (el) el.className = '';
  }, 2200);
}

function showHireEffect(count) {
  const fx = document.getElementById('ov-fx');
  if (!fx) return;
  const emojis = ['🎉', '⭐', '✨', '🎊', '💫', '🌟', '🎈', '🥳', '👏'];
  let html = '';
  const n = Math.min(count * 3 + 3, 16);
  for (let i = 0; i < n; i++) {
    const e = emojis[Math.floor(Math.random() * emojis.length)];
    const l = 5 + Math.floor(Math.random() * 90);
    const d = (Math.random() * 0.7).toFixed(2);
    const dur = (1.4 + Math.random() * 1.2).toFixed(2);
    html += `<span class="hire-spark" style="left:${l}%;animation-delay:${d}s;animation-duration:${dur}s">${e}</span>`;
  }
  fx.innerHTML = html;
  clearTimeout(_officeEventTimer);
  _officeEventTimer = setTimeout(() => {
    const el = document.getElementById('ov-fx');
    if (el) { el.innerHTML = ''; el.className = ''; }
  }, 3000);
}

function renderOfficeScene() {
  const visual = document.getElementById('office-visual');
  if (!visual) return;

  const lvl    = state.officeLevel ?? 0;
  const morale = (state.morale.ceo + state.morale.employee + state.morale.freelance) / 3;
  const total  = getTotalPeople();
  const cap    = getCurrentCapacity();
  const mCls   = morale < 30 ? 'atmo-depressed'
               : morale < 50 ? 'atmo-tired'
               : morale > 85 ? 'atmo-amazing'
               : morale > 70 ? 'atmo-energetic' : '';

  // Skip if nothing visible changed
  const key = `${lvl}-${mCls}-${total}-${cap}`;
  if (key === _officeRenderKey) return;
  _officeRenderKey = key;

  visual.className = `office-lv${lvl} ${mCls}`.trim();

  // HUD
  const nameEl  = document.getElementById('ov-office-name');
  const countEl = document.getElementById('ov-people-count');
  if (nameEl)  nameEl.textContent  = OFFICE_LEVELS[lvl]?.name || '―';
  if (countEl) countEl.textContent = `👥 ${total}/${cap}`;

  // 窓の空
  const winIcon = morale < 30 ? '🌧️' : (OFFICE_WINDOW_ICONS[lvl] || '☁️');
  document.querySelectorAll('.ov-window-inner').forEach(w => { w.textContent = winIcon; });

  // 装飾
  const deco = OFFICE_DECO[Math.min(lvl, OFFICE_DECO.length - 1)];
  const pL = document.getElementById('ov-plant-l');
  const pR = document.getElementById('ov-plant-r');
  const pl = document.getElementById('ov-plate');
  if (pL) pL.textContent = deco.plants;
  if (pR) pR.textContent = lvl >= 3 ? deco.plants : '';
  if (pl) pl.textContent = deco.plate;

  // 雰囲気パーティクル
  const atmo = document.getElementById('ov-atmo');
  if (atmo) {
    if (morale < 30) {
      atmo.innerHTML = '<span class="atmo-rain">💧</span><span class="atmo-rain r2">💧</span><span class="atmo-rain r3">💧</span>';
    } else if (morale > 85) {
      atmo.innerHTML = '<span class="atmo-spark s1">✨</span><span class="atmo-spark s2">⭐</span><span class="atmo-note n1">🎵</span><span class="atmo-note n2">🎶</span>';
    } else if (morale > 70) {
      atmo.innerHTML = '<span class="atmo-spark s3">💫</span>';
    } else {
      atmo.innerHTML = '';
    }
  }

  // 人物
  renderOfficePeople(total, morale);

  // 説明テキスト
  const descEl = document.getElementById('office-desc');
  if (descEl) {
    if (!state.gameStarted) {
      descEl.textContent = '資本金 ¥10,000,000。事務所を借りてSES会社を始めよう！';
    } else if (morale < 30) {
      descEl.textContent = '😔 重苦しい空気…誰も目を合わせない。交流会が必要かも。';
    } else if (morale < 50) {
      descEl.textContent = '😑 疲弊した空気が漂っている。士気を上げる施策を検討しよう。';
    } else if (morale > 85) {
      descEl.textContent = '🤩 最高の職場！全員がいきいきと輝いている！';
    } else if (morale > 70) {
      descEl.textContent = '😊 活気に満ちたオフィス。チームの成長が感じられる。';
    } else {
      descEl.textContent = STAGE_DEFS[getCurrentStageIdx()].desc;
    }
  }
}

function renderOfficePeople(count, morale) {
  const container = document.getElementById('ov-people');
  if (!container) return;

  if (count === 0) {
    container.innerHTML = `<div class="office-nobody">まだ誰もいない…<br>営業を雇うとFLエンジニアが集まってくる</div>`;
    return;
  }

  const face = morale < 30 ? '😔' : morale < 50 ? '😑' : morale > 85 ? '🤩' : morale > 70 ? '😊' : '🙂';
  const visible = Math.min(count, 10);
  let html = '';
  for (let i = 0; i < visible; i++) {
    const delay = ((i * 0.37) % 1.5).toFixed(2);
    html += `<div class="op-unit" style="animation-delay:${delay}s"><span class="op-face">${face}</span><span class="op-desk">💻</span></div>`;
  }
  if (count > 10) html += `<div class="op-extra">+${count - 10}名</div>`;
  container.innerHTML = html;
}

function renderAll() {
  renderHeader();   // renderHeader が renderOfficeScene を呼ぶ
  renderDepts();
  renderUpgrades();
  renderStats();
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
  if (tabId === 'stats')    renderStats();
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

function gameLoop(ts) {
  const now     = Date.now();
  const rawElapsed = (now - state.lastTimestamp) / 1000;
  const elapsed = rawElapsed * (state.gameSpeed || 1);
  state.lastTimestamp = now;

  if (state.gameStarted && !state.bankrupt && !weeklyModalShowing) {
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
    if (currentWeekNum > (state.lastEventWeek || 0) && currentWeekNum > 0) {
      state.lastEventWeek = currentWeekNum;

      // 期限切れ強化を反映してmultsを再計算
      recalcMults();

      // 前週採用FLが今週から稼働開始
      const pendingFL = state.pendingFreelancers || 0;
      if (pendingFL > 0) {
        state.freelancers = (state.freelancers || 0) + pendingFL;
        state.pendingFreelancers = 0;
        showHireEffect(pendingFL);
        showToast(`👨‍💻 ${pendingFL}名のFLが今週から稼働開始！`);
      }

      // FL週次利益の分配（売上¥600K〜¥1,000K × 利益率10〜15% ランダム、FL士気で利益率UP）
      const flMorale        = state.morale?.freelance ?? 50;
      const moraleMarginBon = (flMorale - 50) / 50 * 0.05;
      const flRandRev       = 600000 + Math.random() * 400000;
      const flRandMargin    = Math.max(0.05, Math.min(0.25, 0.10 + Math.random() * 0.05 + moraleMarginBon));
      const flPerPersonWkly = Math.floor(flRandRev * flRandMargin / 4);
      const flWeeklyIncome  = Math.floor((state.freelancers || 0) * flPerPersonWkly * (state.freelancerMult || 1) * getGlobalMultiplier());
      if (flWeeklyIncome > 0) {
        state.money += flWeeklyIncome;
        state.totalEarned += flWeeklyIncome;
        state.periodEarned = (state.periodEarned || 0) + flWeeklyIncome;
        state.deptRevenue['freelancer'] = (state.deptRevenue['freelancer'] || 0) + flWeeklyIncome;
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

      // 週次イベント（社長士気でgood/bad比率調整、営業士気で微調整）
      if (Math.random() < 0.75) {
        const ceoMorale  = state.morale?.ceo ?? 50;
        const empMorale  = state.morale?.employee ?? 50;
        const goodProb   = Math.max(0.1, Math.min(0.9,
          0.3 + (ceoMorale / 100) * 0.4 + (empMorale - 50) / 50 * 0.1
        ));
        const goodEvents = WEEK_EVENTS.filter(e => e.type === 'good');
        const badEvents  = WEEK_EVENTS.filter(e => e.type === 'bad');
        const ev = Math.random() < goodProb
          ? goodEvents[Math.floor(Math.random() * goodEvents.length)]
          : badEvents[Math.floor(Math.random() * badEvents.length)];
        setOfficeEventFx(ev.type);
        pendingWeeklyEvent = ev;
      }

      // モラル低下
      ['ceo','employee','freelance'].forEach(k => {
        state.morale[k] = Math.max(10, (state.morale[k] || 50) - 2);
      });

      // FL採用 → pendingFreelancers に追加（翌週から稼働）
      const salesCount    = state.employees['sales'] || 0;
      const recruitChance = getRecruitChance();
      const maxFL         = getMaxFL();
      let newFL = 0;
      for (let i = 0; i < salesCount; i++) {
        if ((state.freelancers || 0) + (state.pendingFreelancers || 0) < maxFL && Math.random() < recruitChance) {
          state.pendingFreelancers = (state.pendingFreelancers || 0) + 1;
          newFL++;
        }
      }
      if (newFL > 0) showToast(`👨‍💻 FL ${newFL}名を採用！来週から稼働開始。`);

      // 週次サマリーモーダル表示
      showWeeklyModal(currentWeekNum, state.weeklyIncomeAccum || 0, flWeeklyIncome, monthlyExp, beforeMoney);
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
  requestAnimationFrame(gameLoop);
});
