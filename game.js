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

const LOAN_FEE_RATE = 0.03;  // 借入手数料（即時3%）

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
    name: '営業',
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
    id: 'staffing',
    name: '営業',
    emoji: '🤝',
    desc: '求職者と企業をマッチング。週10%で人材発掘し年収35%の紹介料を得る。高年収ほど成約難度UP。月給35〜40万＋社保15%。',
    incomePerSec: 0, marginRate: null, salaryLabel: '人件費',
    monthlySalary: 375000, insuranceRate: 0.15,
    baseCost: 1200000, costMult: 1.25, unlockAt: 30000000,
    special: 'staffingSales',
  },
  {
    id: 'marketing',
    name: 'マーケター',
    emoji: '📣',
    desc: '採用広告・ブランディングで認知向上。1人でSES採用率+0.1%・FL利益率+0.1%、紹介採用率+0.05%・紹介利益率+0.05%。月給45〜50万＋社保15%。',
    incomePerSec: 0, marginRate: null, salaryLabel: '人件費',
    monthlySalary: 475000, insuranceRate: 0.15,
    baseCost: 1800000, costMult: 1.28, unlockAt: 120000000,
    special: 'marketing',
  },
  {
    id: 'finance',
    name: '財務スタッフ',
    emoji: '📊',
    desc: '単価交渉・CF管理で全体収益UP（＋8%/人）。月給90万＋社保15%。',
    incomePerSec: 0, marginRate: null, salaryLabel: '人件費',
    monthlySalary: 900000, insuranceRate: 0.15,
    baseCost: 3800000, costMult: 1.20, unlockAt: 100000000,
    special: 'multiplier', specialValue: 0.08,
  },
  {
    id: 'global',
    name: 'グローバル部',
    emoji: '🌏',
    desc: '海外大型SES案件を直接受注。圧倒的な直接収益源。',
    incomePerSec: 5000000,
    marginRate: 0.80, salaryLabel: '人件費', monthlySalary: null,
    baseCost: 10000000000, costMult: 1.15, unlockAt: 10000000000,
  },
  {
    id: 'investment',
    name: '資産運用スタッフ',
    emoji: '📉',
    desc: '株式市場への投資運用を担当。採用すると銀行タブの証券取引所が解放される。月給100万＋社保15%。',
    incomePerSec: 0, marginRate: null, salaryLabel: '人件費',
    monthlySalary: 1000000, insuranceRate: 0.15,
    baseCost: 4200000, costMult: 1.20, unlockAt: 200000000,
  },
];

// ---- 証券定義 ----
const STOCK_DEFS = [
  { id: 'mfg', name: '東栄重工',      type: '製造業', emoji: '🏭', volatility: 0.03, trendBias: 0.001 },
  { id: 'it',  name: 'テックビジョン', type: 'IT',    emoji: '💻', volatility: 0.10, trendBias: 0.003 },
  { id: 'con', name: 'ストラテジークス', type: 'コンサル', emoji: '📊', volatility: 0.06, trendBias: 0.002 },
];

// ---- 経営企画部 役員定義 ----
const EXEC_DEFS = [
  {
    id: 'exec_sales_dir',
    name: '営業部役員',
    emoji: '🤵',
    role: '営業最適化担当',
    desc: 'モラール向上アクションの自動購入（週2回まで）・営業人数の自動最適化・強化の自動購入（週1件・安い順）。各機能はON/OFF可能。',
    cost: 5000000,
    unlockAt: 10000000,
    actions: [
      { key: 'autoMorale',  label: 'モラール自動最適化（週2アクション）', defaultOn: true },
      { key: 'autoSales',   label: '営業人数自動最適化', defaultOn: true },
      { key: 'autoUpgrade', label: '強化の自動購入（週1件・安い順）', defaultOn: true },
    ],
  },
  {
    id: 'exec_finance_dir',
    name: '財務部役員',
    emoji: '📊',
    role: '財務最適化担当',
    desc: '（近日実装）収益分析・資金効率化を担当。',
    cost: 5000000,
    unlockAt: 50000000,
    comingSoon: true,
    actions: [],
  },
  {
    id: 'exec_mkt_dir',
    name: 'マーケット部役員',
    emoji: '📣',
    role: 'マーケット最適化担当',
    desc: '（近日実装）市場分析・ブランド戦略を担当。',
    cost: 5000000,
    unlockAt: 100000000,
    comingSoon: true,
    actions: [],
  },
];

const MANAGER_DEFS = [
  {
    id: 'mgr_ses',
    name: 'SES部門マネージャー',
    emoji: '👔',
    desc: 'FL採用確率＋3%（追加1人ごとに×1.25倍）・FL離脱率−0.5%/人。月給70万＋社保。営業10人につき1人採用可。',
    hireCost: 3000000,
    monthlySalary: 700000,
    unlockAt: 10000000,
    island: 'ses',
  },
  {
    id: 'mgr_staffing',
    name: '紹介部門マネージャー',
    emoji: '📋',
    desc: '紹介発掘確率＋3%（追加1人ごとに×1.25倍）。月給70万＋社保。営業10人につき1人採用可。',
    hireCost: 3000000,
    monthlySalary: 700000,
    unlockAt: 10000000,
    island: 'staffing',
  },
];

// ---- 派遣事業部 定数 ----
const DISPATCH_MONTHLY_SALARY = 345000; // 月収30万+社保15% = 34.5万/人
const DISPATCH_WEEKLY_GROSS   = 103500; // 月額×1.2÷4 ≈ 10.35万/週/人
const DISPATCH_HIRE_COST      = 1500000; // 採用費/人（年収の約35%）
const DISPATCH_QUIT_RATE      = 0.03;   // 週次離脱率

// 受託開発（1件あたり CONTRACT_WORKERS 名を専任）
const CONTRACT_WORKERS      = 10;
// 小型案件（8〜12週、利益率35〜45%）
const CONTRACT_S_MIN_WEEKS  = 8;
const CONTRACT_S_MAX_WEEKS  = 12;
const CONTRACT_S_MULT_MIN   = 1.54; // margin 35%: 1/(1-0.35)
const CONTRACT_S_MULT_MAX   = 1.82; // margin 45%: 1/(1-0.45)
const CONTRACT_S_MARGIN_MIN = 35;
const CONTRACT_S_MARGIN_MAX = 45;
// 大型案件（16〜24週、利益率55〜65%）
const CONTRACT_L_MIN_WEEKS  = 16;
const CONTRACT_L_MAX_WEEKS  = 24;
const CONTRACT_L_MULT_MIN   = 2.22; // margin 55%: 1/(1-0.55)
const CONTRACT_L_MULT_MAX   = 2.86; // margin 65%: 1/(1-0.65)
const CONTRACT_L_MARGIN_MIN = 55;
const CONTRACT_L_MARGIN_MAX = 65;

function getExecMonthlySalary() {
  return 1000000;
}

// ---- 週次イベント定義 ----
// category: 'personnel'=人材増減(20%), 'money'=お金増減(30%), 'multiplier'=係数変動(50%)
function _evWeeklyBase() {
  return Math.max(500000, getFlWeeklyIncome() + getTotalIncome() * WEEK_SEC);
}

const WEEK_EVENTS = [
  // ---- good / money ----
  {
    type: 'good', category: 'money', emoji: '📢', title: '大手SIerから大型案件受注！',
    desc: '年間契約の大型プロジェクトが成立。臨時売上が一括入金。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 3); s.money += b; s.totalEarned += b; return `臨時収益 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '💡', title: 'DX案件で引き合いが急増！',
    desc: 'クライアントのDX推進需要が爆発。臨時売上が発生。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 5); s.money += b; s.totalEarned += b; return `臨時収益 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '🎓', title: 'IT人材育成補助金を獲得！',
    desc: '国の助成金が採択され、研修費が大幅に補助されました。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 2); s.money += b; s.totalEarned += b; return `補助金 ＋${yen(b)}`; },
  },
  // ---- good / multiplier ----
  {
    type: 'good', category: 'multiplier', emoji: '🏆', title: 'ITサービス企業アワード受賞！',
    desc: '業界誌に特集掲載。クライアントからの問い合わせが急増！',
    effect: s => { s.eventBoost = { mult: 2.0, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×2.0（2週間）'; },
  },
  {
    type: 'good', category: 'multiplier', emoji: '🤝', title: '大手コンサルと業務提携！',
    desc: '高単価プロジェクトへのアクセスを確保。収益が継続的にUP。',
    effect: s => { s.eventBoost = { mult: 1.5, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×1.5（3週間）'; },
  },
  {
    type: 'good', category: 'multiplier', emoji: '📈', title: 'エンジニア単価が市場上昇！',
    desc: 'IT人材不足が深刻化。業界全体でエンジニア単価がUP。',
    effect: s => { s.eventBoost = { mult: 1.3, expiresAt: s.elapsedSeconds + WEEK_SEC * 4 }; return '収益×1.3（4週間）'; },
  },
  // ---- good / personnel ----
  {
    type: 'good', category: 'personnel', emoji: '🧑‍💻', title: '優秀なFLエンジニアが自社を選択！',
    desc: '口コミで評判が広まり、優秀なフリーランスが直接問い合わせてきた。',
    effect: s => {
      const currentWeek = Math.floor(s.elapsedSeconds / WEEK_SEC);
      s.flData.push({ gross: 700000 + Math.floor(Math.random() * 300001), profitRate: 0.12 + Math.random() * 0.08, hiredWeek: currentWeek });
      s.freelancers = s.flData.length;
      return `フリーランス1名が無償参加（計${s.freelancers}名）`;
    },
  },
  // ---- bad / money ----
  {
    type: 'bad', category: 'money', emoji: '💥', title: '取引先クライアントが倒産！',
    desc: '主要取引先が業績不振で倒産。売掛金が全額回収不能に。',
    effect: s => { const loss = Math.floor(s.money * 0.25); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の損失`; },
  },
  {
    type: 'bad', category: 'money', emoji: '⚠️', title: '労務コンプライアンス違反が発覚！',
    desc: '労務管理の不備が露呈。是正対応と弁護士費用が発生。',
    effect: s => { const loss = Math.floor(s.money * 0.15); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の対応費`; },
  },
  {
    type: 'bad', category: 'money', emoji: '🔥', title: 'サーバー障害で業務が停止！',
    desc: 'システム障害が発生し、24時間業務が停止。緊急対応費用が発生。',
    effect: s => { const loss = Math.floor(s.money * 0.10); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の損害`; },
  },
  // ---- bad / multiplier ----
  {
    type: 'bad', category: 'multiplier', emoji: '📉', title: 'クライアントがIT予算を凍結！',
    desc: '景気悪化でIT投資が全社的に凍結。収益が大幅に落ち込む。',
    effect: s => { s.eventBoost = { mult: 0.7, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×0.7（2週間）'; },
  },
  {
    type: 'bad', category: 'multiplier', emoji: '😤', title: '案件トラブルでクレーム多発！',
    desc: '常駐エンジニアのトラブルが重なり、クライアントとの関係が悪化。',
    effect: s => { s.eventBoost = { mult: 0.8, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×0.8（3週間）'; },
  },
  // ---- bad / personnel ----
  {
    type: 'bad', category: 'personnel', emoji: '😤', title: 'ベテラン営業が突然退職！',
    desc: '条件面での不満から優秀な営業が競合他社へ転職した。チームの士気が低下。',
    effect: s => {
      const drop = 8 + Math.floor(Math.random() * 8);
      s.morale.employee = Math.max(10, (s.morale.employee || 90) - drop);
      return `社員モラール −${drop}`;
    },
  },

  // ---- 追加: good / money ----
  {
    type: 'good', category: 'money', emoji: '🏦', title: '税務上の還付金が入金！',
    desc: '前期の過払い税金が還付されました。思わぬ臨時収入に。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 1.5); s.money += b; s.totalEarned += b; return `還付金 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '🤑', title: '既存クライアントから追加発注！',
    desc: '満足度の高い既存クライアントがプロジェクトを拡大。追加売上が発生。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 2.5); s.money += b; s.totalEarned += b; return `追加売上 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '🏛️', title: 'デジタル化推進補助金を採択！',
    desc: '中小企業向けDX補助金の採択通知が届いた。即時入金されます。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 2); s.money += b; s.totalEarned += b; return `補助金 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '📦', title: '古い機材の売却益が発生！',
    desc: '不用になったサーバー機材を業者に売却。予想外の収入に。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 0.8); s.money += b; s.totalEarned += b; return `売却益 ＋${yen(b)}`; },
  },
  {
    type: 'good', category: 'money', emoji: '🌸', title: '繁忙期で案件が集中！',
    desc: '年度末の駆け込み需要で案件が殺到。臨時売上が一気に積み上がった。',
    effect: s => { const b = Math.floor(_evWeeklyBase() * 4); s.money += b; s.totalEarned += b; return `繁忙期臨時収益 ＋${yen(b)}`; },
  },

  // ---- 追加: good / multiplier ----
  {
    type: 'good', category: 'multiplier', emoji: '📺', title: 'ビジネス誌に特集掲載！',
    desc: '大手ビジネス誌に成長企業として特集された。問い合わせが急増中！',
    effect: s => { s.eventBoost = { mult: 1.6, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×1.6（3週間）'; },
  },
  {
    type: 'good', category: 'multiplier', emoji: '🌐', title: '海外IT需要が国内に流入！',
    desc: 'グローバルIT需要の高まりが日本市場にも波及。単価が急上昇。',
    effect: s => { s.eventBoost = { mult: 1.4, expiresAt: s.elapsedSeconds + WEEK_SEC * 4 }; return '収益×1.4（4週間）'; },
  },
  {
    type: 'good', category: 'multiplier', emoji: '🎯', title: 'プロジェクト評価が最高評価！',
    desc: 'クライアント満足度調査で最高評価を獲得。次の案件獲得が有利に。',
    effect: s => { s.eventBoost = { mult: 1.8, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×1.8（2週間）'; },
  },
  {
    type: 'good', category: 'multiplier', emoji: '🤖', title: 'AI活用で業務効率が急上昇！',
    desc: '生成AI導入が進み、エンジニアの生産性が大幅に向上。収益率がUP。',
    effect: s => { s.eventBoost = { mult: 1.35, expiresAt: s.elapsedSeconds + WEEK_SEC * 5 }; return '収益×1.35（5週間）'; },
  },

  // ---- 追加: good / personnel ----
  {
    type: 'good', category: 'personnel', emoji: '👥', title: 'リファラル採用で即戦力が加入！',
    desc: '社員の紹介で優秀なフリーランスが参加。チームの雰囲気もUP。',
    effect: s => {
      const currentWeek = Math.floor(s.elapsedSeconds / WEEK_SEC);
      s.flData.push({ gross: 750000 + Math.floor(Math.random() * 250001), profitRate: 0.13 + Math.random() * 0.07, hiredWeek: currentWeek });
      s.freelancers = s.flData.length;
      const gain = 5 + Math.floor(Math.random() * 5);
      s.morale.freelance = Math.min(100, (s.morale.freelance || 90) + gain);
      return `フリーランス1名参加（計${s.freelancers}名）・FLモラール＋${gain}`;
    },
  },
  {
    type: 'good', category: 'personnel', emoji: '😊', title: 'チームビルディングで士気急回復！',
    desc: '自発的なチームイベントが成功。全社のモラールが一気に上昇した。',
    effect: s => {
      const gain = 10 + Math.floor(Math.random() * 8);
      s.morale.employee  = Math.min(100, (s.morale.employee  || 90) + gain);
      s.morale.freelance = Math.min(100, (s.morale.freelance || 90) + Math.floor(gain * 0.6));
      return `社員モラール ＋${gain}、FLモラール ＋${Math.floor(gain * 0.6)}`;
    },
  },
  {
    type: 'good', category: 'personnel', emoji: '🎖️', title: '社長がメンターに選ばれた！',
    desc: '業界団体のメンタープログラムに選出。社長のモラールと社員の尊敬が上昇。',
    effect: s => {
      s.morale.ceo      = Math.min(100, (s.morale.ceo      || 90) + 12);
      s.morale.employee = Math.min(100, (s.morale.employee || 90) + 6);
      return '社長モラール ＋12、社員モラール ＋6';
    },
  },

  // ---- 追加: bad / money ----
  {
    type: 'bad', category: 'money', emoji: '🧾', title: '税務調査が入った！',
    desc: '突然の税務調査で対応費用が発生。経理処理の見直しコストも重なった。',
    effect: s => { const loss = Math.floor(s.money * 0.12); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の対応費`; },
  },
  {
    type: 'bad', category: 'money', emoji: '🌧️', title: '自然災害で事務所が被害！',
    desc: '大雨による浸水で機材が損傷。修繕費と代替費用が発生した。',
    effect: s => { const loss = Math.floor(s.money * 0.08); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の修繕費`; },
  },
  {
    type: 'bad', category: 'money', emoji: '⚡', title: '急なシステム刷新を強いられた！',
    desc: 'セキュリティ脆弱性が発覚し、緊急のシステム更新費用が発生。',
    effect: s => { const loss = Math.floor(_evWeeklyBase() * 2); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の緊急対応費`; },
  },
  {
    type: 'bad', category: 'money', emoji: '📋', title: 'クライアントから損害賠償請求！',
    desc: '納品物に問題が発覚。示談で解決したが、賠償金が発生した。',
    effect: s => { const loss = Math.floor(s.money * 0.18); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の賠償金`; },
  },
  {
    type: 'bad', category: 'money', emoji: '💸', title: '為替変動で外注コストが急増！',
    desc: '円安が進行し、海外ツール・外注費の実質コストが上昇した。',
    effect: s => { const loss = Math.floor(_evWeeklyBase() * 1.2); s.money = Math.max(0, s.money - loss); return `−${yen(loss)}の追加コスト`; },
  },

  // ---- 追加: bad / multiplier ----
  {
    type: 'bad', category: 'multiplier', emoji: '🌩️', title: '景気後退でIT予算が大幅削減！',
    desc: '複数クライアントが一斉にIT投資を縮小。市場全体の単価が急落。',
    effect: s => { s.eventBoost = { mult: 0.6, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×0.6（3週間）'; },
  },
  {
    type: 'bad', category: 'multiplier', emoji: '🏹', title: '大手競合が激安攻勢を開始！',
    desc: '大手SIerが価格破壊を仕掛けてきた。単価競争に引き込まれ収益が圧迫。',
    effect: s => { s.eventBoost = { mult: 0.75, expiresAt: s.elapsedSeconds + WEEK_SEC * 3 }; return '収益×0.75（3週間）'; },
  },
  {
    type: 'bad', category: 'multiplier', emoji: '🤧', title: '感染症でエンジニアが大量欠勤！',
    desc: '感染症が社内で流行。多くのエンジニアが一時的に稼働不能に。',
    effect: s => { s.eventBoost = { mult: 0.65, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×0.65（2週間）'; },
  },
  {
    type: 'bad', category: 'multiplier', emoji: '📰', title: 'IT業界への否定的報道が拡散！',
    desc: '業界スキャンダルが週刊誌に掲載。新規問い合わせが一時的に激減。',
    effect: s => { s.eventBoost = { mult: 0.85, expiresAt: s.elapsedSeconds + WEEK_SEC * 2 }; return '収益×0.85（2週間）'; },
  },

  // ---- 追加: bad / personnel ----
  {
    type: 'bad', category: 'personnel', emoji: '🚪', title: 'FL複数名が同時に離脱！',
    desc: '待遇への不満が重なり、フリーランス複数名が一斉に契約終了を申し出た。',
    effect: s => {
      const n = Math.min(s.flData.length, 2 + Math.floor(Math.random() * 2));
      for (let i = 0; i < n; i++) { if (s.flData.length > 0) s.flData.splice(0, 1); }
      s.freelancers = s.flData.length;
      return `FL ${n}名が離脱（残${s.freelancers}名）`;
    },
  },
  {
    type: 'bad', category: 'personnel', emoji: '😔', title: '社内いじめが発覚！',
    desc: '匿名アンケートで職場内の問題が露呈。全社のモラールが大幅に低下。',
    effect: s => {
      s.morale.employee  = Math.max(10, (s.morale.employee  || 90) - 15);
      s.morale.freelance = Math.max(10, (s.morale.freelance || 90) - 8);
      return '社員モラール −15、FLモラール −8';
    },
  },
  {
    type: 'bad', category: 'personnel', emoji: '😴', title: '過労で社員が長期休職！',
    desc: '長時間労働が続いたベテラン社員が休職に入った。現場への負担が増加。',
    effect: s => {
      const drop = 10 + Math.floor(Math.random() * 10);
      s.morale.employee = Math.max(10, (s.morale.employee || 90) - drop);
      return `社員モラール −${drop}`;
    },
  },
];

function pickWeeklyEvent() {
  const catRand = Math.random();
  let category;
  if (catRand < 0.20)      category = 'personnel';
  else if (catRand < 0.50) category = 'money';
  else                     category = 'multiplier';

  const type = Math.random() < 0.5 ? 'good' : 'bad';
  const pool = WEEK_EVENTS.filter(e => e.category === category && e.type === type);
  if (pool.length === 0) {
    const fallback = WEEK_EVENTS.filter(e => e.type === type);
    return fallback[Math.floor(Math.random() * fallback.length)] || WEEK_EVENTS[0];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- アップグレード定義 ----
// dept: 'sales'     → deptMults['sales'] に乗算（採用確率に反映）
// dept: 'freelancer'→ state.freelancerMult に乗算（FL単価に反映）
const UPGRADE_DEFS = [
  // ---- SES営業：FL採用確率UP ----
  { id: 'u_crm',        name: '案件管理システム導入',        emoji: '🗂️', cost: 2000000,      dept: 'sales',      mult: 1.25, req: { sales: 1 } },
  { id: 'u_network',    name: '人材エージェント連携',        emoji: '🤝', cost: 35000000,     dept: 'sales',      mult: 1.25, req: { sales: 5 } },
  { id: 'u_brand',      name: 'SESブランド確立',             emoji: '🏆', cost: 350000000,    dept: 'sales',      mult: 1.25, req: { sales: 15 } },
  { id: 'u_vision',     name: 'ビジョン採用戦略',            emoji: '🚩', cost: 3500000000,   dept: 'sales',      mult: 1.25, req: { sales: 30 } },
  // ---- FL単価UP ----
  { id: 'u_skill',      name: '単価交渉マニュアル整備',      emoji: '📋', cost: 3000000,      dept: 'freelancer', mult: 1.25, req: { sales: 1 } },
  { id: 'u_niche',      name: 'ニッチ技術特化戦略',          emoji: '🔬', cost: 45000000,     dept: 'freelancer', mult: 1.25, req: { sales: 5 } },
  { id: 'u_prime',      name: 'プライム案件専任体制',        emoji: '🥇', cost: 450000000,    dept: 'freelancer', mult: 1.25, req: { sales: 10 } },
  { id: 'u_aidev',      name: 'AI・クラウド専門化',          emoji: '🤖', cost: 4500000000,   dept: 'freelancer', mult: 1.25, req: { sales: 20 } },
  // ---- 人材紹介営業：発掘・成約率UP ----
  { id: 'u_talent_db',  name: '人材データベース構築',        emoji: '🗄️', cost: 5000000,      dept: 'staffing',   mult: 1.25, req: { staffing: 1 } },
  { id: 'u_headhunt',   name: '積極的ヘッドハンティング',    emoji: '🎯', cost: 50000000,     dept: 'staffing',   mult: 1.25, req: { staffing: 5 } },
  { id: 'u_ai_match',   name: 'AIマッチングシステム',        emoji: '🤖', cost: 500000000,    dept: 'staffing',   mult: 1.25, req: { staffing: 10 } },
  { id: 'u_exec_net',   name: 'エグゼクティブネットワーク',  emoji: '👔', cost: 5000000000,   dept: 'staffing',   mult: 1.25, req: { staffing: 20 } },
  // ---- マーケティング部：採用率UP効果UP ----
  { id: 'u_sns_ads',    name: 'SNS採用広告展開',             emoji: '📱', cost: 3000000,      dept: 'marketing',  mult: 1.25, req: { marketing: 1 } },
  { id: 'u_media_buy',  name: '求人媒体への広告出稿',        emoji: '📰', cost: 30000000,     dept: 'marketing',  mult: 1.25, req: { marketing: 3 } },
  { id: 'u_employer',   name: 'エンプロイヤーブランディング',emoji: '🏅', cost: 300000000,    dept: 'marketing',  mult: 1.25, req: { marketing: 8 } },
  // ---- 財務・戦略・グローバル ----
  { id: 'u_accounting', name: '単価交渉強化マニュアル',      emoji: '💹', cost: 3500000000,   dept: 'finance',    mult: 1.25, req: { finance: 1 } },
  { id: 'u_english',    name: '英語対応スキルシート整備',     emoji: '🗣️', cost: 200000000000, dept: 'global',     mult: 1.25, req: { global: 1 } },
];

// ---- 会社ステージ ----
const STAGE_DEFS = [
  { threshold: 0,            name: '個人事業',     emoji: '🧑‍💻', color: '#8B7355', desc: '社長自らが客先に常駐中。「社長＝全戦力」のSES。' },
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
  periodDeductible: 0,  // 当期損金（家賃・給与）
  loans: [],
  morale: { ceo: 90, employee: 90, freelance: 90 },
  gameStarted: false,   // 事務所契約後に true
  bankrupt: false,
  weeklyIncomeAccum: 0, // 週中の部署収益累積
  gameSpeed: 1,         // 倍速（1x / 2x / 4x）
  ceoSalary: 300000,    // 社長月次報酬
  reportHistory: [],    // 週次レポート履歴（最大52件）
  staffingOpened: false,       // 紹介事業部（累計売上1億で自動解放）
  dispatchOpened: false,       // 派遣事業部（2期目利益率20%以上で解放）
  dispatchCount: 0,      // 派遣スタッフ数
  dispatchSales: 0,      // 派遣事業部の営業人数
  contractDev: [],       // 受託開発 [{ type, startWeek, durationWeeks, mult, marginPct }]
  bankUnlocked: false,   // 銀行タブ解放フラグ（財務タブで審査通過後）
  periodStaffingPlacements: 0, // 今期紹介人数（年度末リセット）
  hideWeeklyReport: false,     // 週次レポート非表示フラグ
  autoCloseWeekly: true,       // 週次レポート自動閉じ
  executives: {},              // 役員雇用状態 { exec_sales_dir: true }
  execSettings: {},            // 役員行動設定 { exec_sales_dir: { autoMorale: true, autoSales: true } }
  managers: {},                // 部門マネージャー { mgr_ses: true, mgr_staffing: true }
  stocks: null,                // 証券取引所 { mfg: {price,shares,avgCost,history}, ... }
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
  const avg = ((m.ceo || 90) + (m.employee || 90) + (m.freelance || 90)) / 3;
  if (avg >= 90) return 1 + (avg - 90) * 0.02;          // 90→±0%、95→+10%、100→+20%
  return Math.max(0.80, 1 - (90 - avg) * (0.20 / 90));  // 90→±0%、0→−20%
}

function getMoraleEffectPct() {
  const m = state.morale;
  const avg = ((m.ceo || 90) + (m.employee || 90) + (m.freelance || 90)) / 3;
  if (avg >= 90) return (avg - 90) * 2;
  return -Math.min(20, (90 - avg) * (20 / 90));
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
  return 1;
}

function getCurrentMonthOfYear() {
  const monthNum = Math.floor(state.elapsedSeconds / (WEEK_SEC * MONTH_WEEKS));
  return (monthNum % 12) + 1;
}

function getSESSeasonal() {
  const m = getCurrentMonthOfYear();
  if ([3, 6, 9, 12].includes(m)) return  0.05;
  if ([2, 8].includes(m))        return -0.05;
  return 0;
}

function getSESSeasonalLabel() {
  const m = getCurrentMonthOfYear();
  if ([3, 6, 9, 12].includes(m)) return `🔥 ${m}月 繁忙月 採用+5%`;
  if ([2, 8].includes(m))        return `❄️ ${m}月 閑散月 採用−5%`;
  return '';
}

function getStaffingSeasonal() {
  const m = getCurrentMonthOfYear();
  if ([3, 10].includes(m)) return  0.05;
  if ([4, 11].includes(m)) return -0.05;
  return 0;
}

function getStaffingSeasonalLabel() {
  const m = getCurrentMonthOfYear();
  if ([3, 10].includes(m)) return `🔥 ${m}月 繁忙月 発掘+5%`;
  if ([4, 11].includes(m)) return `❄️ ${m}月 閑散月 発掘−5%`;
  return '';
}

function getRecruitChance() {
  const salesMult   = state.deptMults['sales'] || 1;
  const mktBonus    = (state.employees['marketing'] || 0) * 0.001;
  const seasonal    = getSESSeasonal();
  const empMorale   = state.morale?.employee || 90;
  const moraleBonus = (empMorale - 90) * 0.001;
  const mgrCount    = state.managers?.mgr_ses || 0;
  const mgrBonus    = mgrCount > 0 ? 0.12 * (Math.pow(1.25, mgrCount) - 1) : 0;
  return Math.min(0.95, Math.max(0.01, (0.45 + mktBonus + seasonal + moraleBonus + mgrBonus) * salesMult));
}

function getStaffingFindRate() {
  const staffingMult = state.deptMults['staffing'] || 1;
  const mktBonus     = (state.employees['marketing'] || 0) * 0.0005;
  const seasonal     = getStaffingSeasonal();
  const mgrCount     = state.managers?.mgr_staffing || 0;
  const mgrBonus     = mgrCount > 0 ? 0.12 * (Math.pow(1.25, mgrCount) - 1) : 0;
  return Math.min(0.80, Math.max(0.01, (0.10 + mktBonus + seasonal + mgrBonus) * staffingMult));
}

function getMarketingFlProfitBonus() {
  return (state.employees['marketing'] || 0) * 0.001;
}

function getMarketingStaffingFeeBonus() {
  return (state.employees['marketing'] || 0) * 0.0005;
}

function getMarketingMult() {
  return state.deptMults['marketing'] || 1;
}

function getDeptIncome(deptId) {
  const def = DEPT_DEFS.find(d => d.id === deptId);
  if (!def || def.special || def.incomePerSec === 0) return 0;
  return def.incomePerSec * (state.employees[deptId] || 0) * (state.deptMults[deptId] || 1);
}

function getEmpMoraleMult() {
  const empMorale = (state.morale && state.morale.employee) || 90;
  return Math.max(0.5, 1 + (empMorale - 90) * 0.005);
}

function getCeoSalaryMoraleMult() {
  const salary = state.ceoSalary || 300000;
  return Math.min(2.0, 1 + Math.max(0, salary - 300000) / 1500000);
}

function getFlWeeklyGross() {
  if (!state.flData || state.flData.length === 0) return 0;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  const mult = getEmpMoraleMult() * (state.freelancerMult || 1);
  return state.flData
    .filter(fl => (fl.hiredWeek ?? 0) < currentWeek)
    .reduce((sum, fl) => sum + Math.floor(fl.gross / 4 * mult), 0);
}

function getFlWeeklyIncome() {
  if (!state.flData || state.flData.length === 0) return 0;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  const mult = getEmpMoraleMult() * (state.freelancerMult || 1);
  const mktProfitBonus = getMarketingFlProfitBonus();
  return state.flData
    .filter(fl => (fl.hiredWeek ?? 0) < currentWeek)
    .reduce((sum, fl) => sum + Math.floor(fl.gross / 4 * Math.min(0.80, fl.profitRate + mktProfitBonus) * mult), 0);
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
  // 資産運用スタッフ初回採用で証券取引所を解放
  if (deptId === 'investment' && state.employees['investment'] === 1) {
    initStocks();
    showToast('📈 証券取引所が解放されました！銀行タブから株取引が可能になります');
  }
  renderDepts();
  renderUpgrades();
}

function initStocks() {
  if (state.stocks) return;
  state.stocks = {};
  STOCK_DEFS.forEach(def => {
    const scale = Math.max(1, Math.floor(state.totalEarned / 100000000));
    const base  = Math.round((800 + scale * 400 + Math.random() * 600) / 100) * 100;
    state.stocks[def.id] = { price: base, shares: 0, avgCost: 0, history: [base] };
  });
}

function buyStock(id, qty) {
  const s = state.stocks?.[id];
  if (!s) return;
  const cost = s.price * qty;
  if (state.money < cost) { showToast('⚠️ 資金不足'); return; }
  const prev = s.shares || 0;
  s.avgCost = prev > 0 ? Math.round((s.avgCost * prev + cost) / (prev + qty)) : s.price;
  s.shares = prev + qty;
  state.money -= cost;
  showToast(`📈 ${STOCK_DEFS.find(d => d.id === id).name} ${qty}株 購入 ${yen(cost)}`);
  renderBank();
  renderHeader();
}

function sellStock(id, qty) {
  const s = state.stocks?.[id];
  if (!s || (s.shares || 0) < qty) { showToast('⚠️ 保有株数不足'); return; }
  const proceeds = s.price * qty;
  const profit   = Math.round((s.price - (s.avgCost || 0)) * qty);
  state.money += proceeds;
  if (profit > 0) {
    state.totalEarned = (state.totalEarned || 0) + profit;
    state.periodEarned = (state.periodEarned || 0) + profit;
  }
  s.shares -= qty;
  if (s.shares === 0) s.avgCost = 0;
  const def = STOCK_DEFS.find(d => d.id === id);
  const sign = profit >= 0 ? '+' : '';
  showToast(`📉 ${def.name} ${qty}株 売却 ${yen(proceeds)}　損益 ${sign}${yen(profit)}`);
  renderBank();
  renderHeader();
}

function fire(deptId) {
  if ((state.employees[deptId] || 0) <= 0) return;
  const def = DEPT_DEFS.find(d => d.id === deptId);
  state.employees[deptId]--;
  state.morale['employee'] = Math.max(10, (state.morale['employee'] || 90) - 5);
  showToast(`👋 ${def?.name || deptId}を1名リストラ（社員モラール−5）`);
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

function recalcMults() {
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  DEPT_DEFS.forEach(d => { state.deptMults[d.id] = 1; });
  state.freelancerMult = 1;
  UPGRADE_DEFS.forEach(def => {
    const ug = state.upgrades[def.id];
    if (!ug) return;
    const purchasedWeek = typeof ug === 'object' ? ug.week : 0;
    if (currentWeek >= purchasedWeek + 4) return; // 4週間で期限切れ
    if (def.dept === 'freelancer') {
      state.freelancerMult = (state.freelancerMult || 1) * def.mult;
    } else {
      state.deptMults[def.dept] = (state.deptMults[def.dept] || 1) * def.mult;
    }
  });
}

function buyUpgrade(upgradeId) {
  const def = UPGRADE_DEFS.find(u => u.id === upgradeId);
  if (!def || state.money < def.cost) { showToast('資金が足りません！'); return; }
  state.money -= def.cost;
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  state.upgrades[upgradeId] = { week: currentWeek };
  state.deptCost[def.dept]  = (state.deptCost[def.dept]  || 0) + def.cost;
  recalcMults();
  if (def.dept === 'freelancer') {
    showToast(`✅ ${def.name} 導入！FL単価 ×${def.mult}（4週間）`);
  } else {
    const deptName = DEPT_DEFS.find(d => d.id === def.dept)?.name || '';
    showToast(`✅ ${def.name} 導入！${deptName} ×${def.mult}（4週間）`);
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
  const salesperson   = salesCount * (salesDef.monthlySalary || 375000) * (1 + (salesDef.insuranceRate || 0.15));

  const staffingDef   = DEPT_DEFS.find(d => d.id === 'staffing');
  const staffingCount = state.employees['staffing'] || 0;
  const staffingSalary = staffingCount * (staffingDef.monthlySalary || 375000) * (1 + (staffingDef.insuranceRate || 0.15));

  const mktDef        = DEPT_DEFS.find(d => d.id === 'marketing');
  const mktCount      = state.employees['marketing'] || 0;
  const marketingSalary = mktCount * (mktDef.monthlySalary || 475000) * (1 + (mktDef.insuranceRate || 0.15));

  const loanPay   = state.loans.reduce((a, l) => a + Math.min(l.remaining, l.monthlyPayment), 0);
  const ceoSalary = state.ceoSalary || 0;

  let execSalary = 0;
  const hiredExecCount = EXEC_DEFS.filter(e => state.executives?.[e.id]).length;
  if (hiredExecCount > 0) execSalary = getExecMonthlySalary() * hiredExecCount;

  const mgrSalary = MANAGER_DEFS
    .filter(m => (state.managers?.[m.id] || 0) > 0)
    .reduce((s, m) => s + Math.ceil(m.monthlySalary * 1.15 * (state.managers[m.id] || 0)), 0);

  const financeDef    = DEPT_DEFS.find(d => d.id === 'finance');
  const financeCount  = state.employees['finance'] || 0;
  const financeSalary = financeCount * (financeDef.monthlySalary || 900000) * (1 + (financeDef.insuranceRate || 0.15));

  const investDef     = DEPT_DEFS.find(d => d.id === 'investment');
  const investCount   = state.employees['investment'] || 0;
  const investmentSalary = investCount * (investDef.monthlySalary || 1000000) * (1 + (investDef.insuranceRate || 0.15));

  const dispatchSalary = (state.dispatchCount || 0) * DISPATCH_MONTHLY_SALARY;

  return {
    rent, utilities, supplies,
    salesperson, staffingSalary, marketingSalary, financeSalary, investmentSalary,
    dispatchSalary, loanPay, ceoSalary, execSalary, mgrSalary,
    total: rent + utilities + supplies + salesperson + staffingSalary + marketingSalary
         + financeSalary + investmentSalary + dispatchSalary
         + loanPay + ceoSalary + execSalary + mgrSalary,
  };
}

function showExpenseModal(exp, before) {
  let rows = '';
  if (exp.rent > 0)            rows += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(exp.rent)}</span></div>`;
  if (exp.utilities > 0)       rows += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(exp.utilities)}</span></div>`;
  if (exp.supplies > 0)        rows += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(exp.supplies)}</span></div>`;
  if (exp.salesperson > 0)     rows += `<div class="expense-row"><span>💼 SES営業（${state.employees['sales']||0}名）人件費＋社保</span><span>−${yen(exp.salesperson)}</span></div>`;
  if (exp.staffingSalary > 0)  rows += `<div class="expense-row"><span>🤝 紹介営業（${state.employees['staffing']||0}名）人件費＋社保</span><span>−${yen(exp.staffingSalary)}</span></div>`;
  if (exp.marketingSalary > 0) rows += `<div class="expense-row"><span>📣 マーケター（${state.employees['marketing']||0}名）人件費＋社保</span><span>−${yen(exp.marketingSalary)}</span></div>`;
  if (exp.ceoSalary > 0)       rows += `<div class="expense-row"><span>🤵 社長報酬</span><span>−${yen(exp.ceoSalary)}</span></div>`;
  if (exp.execSalary > 0)      rows += `<div class="expense-row"><span>🤵 役員報酬</span><span>−${yen(exp.execSalary)}</span></div>`;
  if (exp.mgrSalary > 0)       rows += `<div class="expense-row"><span>👔 部門マネージャー 人件費＋社保</span><span>−${yen(exp.mgrSalary)}</span></div>`;
  if (exp.financeSalary > 0)    rows += `<div class="expense-row"><span>📊 財務スタッフ（${state.employees['finance']||0}名）人件費＋社保</span><span>−${yen(exp.financeSalary)}</span></div>`;
  if (exp.investmentSalary > 0) rows += `<div class="expense-row"><span>📉 資産運用スタッフ（${state.employees['investment']||0}名）人件費＋社保</span><span>−${yen(exp.investmentSalary)}</span></div>`;
  if (exp.dispatchSalary > 0)   rows += `<div class="expense-row"><span>🏭 派遣スタッフ（${state.dispatchCount||0}名）給与＋社保</span><span>−${yen(exp.dispatchSalary)}</span></div>`;
  if (exp.loanPay > 0)          rows += `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(exp.loanPay)}</span></div>`;

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
let weeklyModalIsMonthly = false;
let reportViewIndex = 0;
let weeklyAutoCloseTimer = null;
const WEEKLY_MODAL_AUTO_CLOSE_SEC = 5;

function _renderWeeklyModalContent(idx) {
  const r = state.reportHistory[idx];
  if (!r) return;
  const total = state.reportHistory.length;

  let html = '';

  // ---- 収益サマリー ----
  html += `<div class="weekly-section-title">💰 収益サマリー</div>`;
  html += `<div class="expense-row" style="color:#4ade80"><span>🏢 部署収益</span><span>＋${yen(Math.floor(r.deptIncome))}</span></div>`;
  if (r.flGross > 0) {
    html += `<div class="expense-row" style="color:#4ade80"><span>👨‍💻 FL売上（${r.flCount}名）</span><span>＋${yen(Math.floor(r.flGross))}</span></div>`;
    html += `<div class="expense-row" style="color:#f87171"><span>💸 FL報酬</span><span>−${yen(Math.floor(r.flCost))}</span></div>`;
    html += `<div class="expense-row" style="color:#93c5fd"><span>💹 FL利益</span><span>＋${yen(Math.floor(r.flIncome))}</span></div>`;
  }
  if ((r.staffingFees || 0) > 0) {
    html += `<div class="expense-row" style="color:#38c8e8"><span>🤝 人材紹介フィー（${r.staffingPlacements}件）</span><span>＋${yen(r.staffingFees)}</span></div>`;
  }
  if ((r.dispatchIncome || 0) > 0) {
    html += `<div class="expense-row" style="color:#a3e635"><span>🏭 派遣請求（給与月次払）</span><span>＋${yen(r.dispatchIncome)}</span></div>`;
  }
  const totalIncome = Math.floor(r.deptIncome) + Math.floor(r.flIncome) + (r.staffingFees || 0) + (r.dispatchIncome || 0);
  html += `<div class="expense-row" style="font-weight:700;color:#4ade80;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>収入合計</span><span>＋${yen(totalIncome)}</span></div>`;

  // ---- 在籍人員 ----
  if (r.empSnap) {
    const e = r.empSnap;
    const rows = [
      e.sales      > 0 ? `<span>💼 SES営業 <b>${e.sales}</b>名</span>` : '',
      e.staffing   > 0 ? `<span>🤝 紹介営業 <b>${e.staffing}</b>名</span>` : '',
      e.marketing  > 0 ? `<span>📣 マーケ <b>${e.marketing}</b>名</span>` : '',
      e.finance    > 0 ? `<span>📊 財務 <b>${e.finance}</b>名</span>` : '',
      e.investment > 0 ? `<span>📉 資産運用 <b>${e.investment}</b>名</span>` : '',
      e.dispatch   > 0 ? `<span>🏭 派遣 <b>${e.dispatch}</b>名</span>` : '',
      e.fl         > 0 ? `<span>👨‍💻 FL <b>${e.fl}</b>名</span>` : '',
    ].filter(Boolean);
    if (rows.length > 0) {
      html += `<div class="weekly-section-title">👥 在籍人員</div>`;
      html += `<div style="display:flex;flex-wrap:wrap;gap:6px 12px;padding:4px 0 8px;font-size:12px;color:#cbd5e1">${rows.join('')}</div>`;
    }
  }

  // ---- 月次経費 ----
  if (r.monthlyExp) {
    const mExp = r.monthlyExp;
    html += `<div class="weekly-section-title">📋 月次経費（第${r.monthNum}月末）</div>`;
    if (mExp.rent > 0)           html += `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(mExp.rent)}</span></div>`;
    if (mExp.utilities > 0)      html += `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(mExp.utilities)}</span></div>`;
    if (mExp.supplies > 0)       html += `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(mExp.supplies)}</span></div>`;
    if (mExp.salesperson > 0)    html += `<div class="expense-row"><span>👔 SES営業 人件費</span><span>−${yen(mExp.salesperson)}</span></div>`;
    if (mExp.execSalary > 0)     html += `<div class="expense-row"><span>🤵 役員報酬</span><span>−${yen(mExp.execSalary)}</span></div>`;
    if (mExp.mgrSalary > 0)      html += `<div class="expense-row"><span>👔 部門マネージャー 人件費＋社保</span><span>−${yen(mExp.mgrSalary)}</span></div>`;
    if (mExp.staffingSalary > 0) html += `<div class="expense-row"><span>🤝 紹介営業 人件費</span><span>−${yen(mExp.staffingSalary)}</span></div>`;
    if (mExp.marketingSalary > 0) html += `<div class="expense-row"><span>📣 マーケター 人件費</span><span>−${yen(mExp.marketingSalary)}</span></div>`;
    if (mExp.financeSalary > 0)    html += `<div class="expense-row"><span>📊 財務スタッフ 人件費＋社保</span><span>−${yen(mExp.financeSalary)}</span></div>`;
    if (mExp.investmentSalary > 0) html += `<div class="expense-row"><span>📉 資産運用スタッフ 人件費＋社保</span><span>−${yen(mExp.investmentSalary)}</span></div>`;
    if (mExp.dispatchSalary > 0)   html += `<div class="expense-row"><span>🏭 派遣スタッフ 給与＋社保</span><span>−${yen(mExp.dispatchSalary)}</span></div>`;
    if (mExp.ceoSalary > 0)      html += `<div class="expense-row"><span>🤵 社長報酬</span><span>−${yen(mExp.ceoSalary)}</span></div>`;
    if (mExp.loanPay > 0)        html += `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(mExp.loanPay)}</span></div>`;
    html += `<div class="expense-row" style="font-weight:700;color:#f87171;border-top:2px solid #2a2a50;padding-top:8px;margin-top:4px"><span>支出合計</span><span>−${yen(mExp.total)}</span></div>`;
    const net = totalIncome - mExp.total;
    const netColor = net >= 0 ? '#4ade80' : '#f87171';
    html += `<div class="expense-row" style="font-weight:800;font-size:14px;color:${netColor};margin-top:4px"><span>週次収支</span><span>${net >= 0 ? '＋' : '−'}${yen(Math.abs(net))}</span></div>`;
    html += `<div class="expense-balance" style="margin-top:8px"><div>引落前: ${yen(r.beforeMoney)}</div><div style="color:${r.afterMoney < 0 ? '#f87171' : '#4ade80'}">引落後: ${yen(r.afterMoney)}</div></div>`;
  }

  // ---- 週次ループ一覧 ----
  if (r.weeklyLog && r.weeklyLog.length > 0) {
    html += `<div class="weekly-section-title">🔄 週次ログ</div>`;
    html += r.weeklyLog.map(e =>
      `<div class="expense-row" style="${e.bad ? 'color:#f87171' : 'color:#cbd5e1'}"><span>${e.emoji} ${e.text}</span></div>`
    ).join('');
  }

  // ---- ニュース ----
  if (r.event) {
    const isGood = r.event.type === 'good';
    const evColor = isGood ? '#4ade80' : '#f87171';
    html += `<div class="weekly-section-title" style="color:${evColor}">${isGood ? '📰 グッドニュース！' : '📰 バッドニュース…'}</div>`;
    html += `<div class="weekly-event-row" style="border-color:${evColor}22;background:${evColor}08">
      <span class="weekly-event-emoji">${r.event.emoji}</span>
      <div style="display:flex;flex-direction:column;gap:2px">
        <span class="weekly-event-title" style="color:${evColor}">${r.event.title}</span>
        ${r.event.result ? `<span style="font-size:11px;color:${evColor};opacity:0.85">→ ${r.event.result}</span>` : ''}
      </div>
    </div>`;
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

function showWeeklyModal(weekNum, deptIncome, flWeeklyIncome, flGross, flCost, monthlyExp, beforeMoney, staffingPlacements, staffingFees, dispatchIncome, weeklyLog) {
  const period      = Math.floor((weekNum - 1) / YEAR_WEEKS) + 1;
  const monthNum    = Math.floor(((weekNum - 1) % YEAR_WEEKS) / MONTH_WEEKS) + 1;
  const weekInMonth = ((weekNum - 1) % MONTH_WEEKS) + 1;
  const isMonthly   = weekInMonth === MONTH_WEEKS;
  const flCount     = state.freelancers || 0;

  // イベント効果を即時適用し結果をスナップショット
  let evSnap = null;
  if (pendingWeeklyEvent) {
    const ev = pendingWeeklyEvent;
    pendingWeeklyEvent = null;
    const resultText = ev.effect(state);
    setOfficeEventFx(ev.type);
    evSnap = { type: ev.type, emoji: ev.emoji, title: ev.title, result: resultText };
  }

  if (!state.reportHistory) state.reportHistory = [];
  state.reportHistory.push({
    weekNum, period, monthNum, weekInMonth,
    deptIncome, flIncome: flWeeklyIncome, flCount, flGross, flCost,
    monthlyExp, beforeMoney, afterMoney: state.money,
    event: evSnap,
    staffingPlacements: staffingPlacements || 0,
    staffingFees: staffingFees || 0,
    dispatchIncome: dispatchIncome || 0,
    weeklyLog: weeklyLog || [],
    empSnap: {
      sales:      state.employees['sales']      || 0,
      staffing:   state.employees['staffing']   || 0,
      marketing:  state.employees['marketing']  || 0,
      finance:    state.employees['finance']    || 0,
      investment: state.employees['investment'] || 0,
      dispatch:   state.dispatchCount           || 0,
      fl:         state.freelancers             || 0,
    },
  });
  if (state.reportHistory.length > 52) state.reportHistory.shift();

  // 週次レポートが非表示かつ月次でない場合はモーダルを出さない
  if (state.hideWeeklyReport && !isMonthly) {
    renderAll();
    if (state.money < 0 && !state.bankrupt) triggerBankruptcy();
    return;
  }

  weeklyModalIsMonthly = isMonthly;
  const titleEl = document.getElementById('weekly-modal-title');
  if (titleEl) titleEl.textContent = isMonthly ? '📊 月次レポート' : '📅 週次レポート';

  reportViewIndex = state.reportHistory.length - 1;
  _renderWeeklyModalContent(reportViewIndex);
  weeklyModalShowing = true;
  document.getElementById('weekly-modal').classList.remove('hidden');

  // 週次・月次ともに5秒カウントダウン
  const bar = document.getElementById('weekly-auto-close-bar');
  clearTimeout(weeklyAutoCloseTimer);
  weeklyAutoCloseTimer = null;
  if (state.autoCloseWeekly !== false) {
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '100%';
      void bar.offsetWidth;
      bar.style.transition = `width ${WEEKLY_MODAL_AUTO_CLOSE_SEC}s linear`;
      bar.style.width = '0%';
    }
    weeklyAutoCloseTimer = setTimeout(() => closeWeeklyModal(), WEEKLY_MODAL_AUTO_CLOSE_SEC * 1000);
  } else {
    if (bar) { bar.style.transition = 'none'; bar.style.width = '0%'; }
  }
}

function closeWeeklyModal() {
  clearTimeout(weeklyAutoCloseTimer);
  weeklyAutoCloseTimer = null;
  weeklyModalShowing = false;
  document.getElementById('weekly-modal').classList.add('hidden');
  renderAll();
  if (state.money < 0 && !state.bankrupt) {
    triggerBankruptcy();
  }
}

function weeklyModalOverlayClick() {
  closeWeeklyModal();
}

function toggleWeeklyReport(hide) {
  state.hideWeeklyReport = hide;
}

function toggleAutoClose(enabled) {
  state.autoCloseWeekly = enabled;
}

// ---- 派遣事業部 ----
function getDispatchCapacity() {
  return (state.employees?.['sales'] || 0) * 20;
}

function hireDispatch() {
  const cap     = getDispatchCapacity();
  const current = state.dispatchCount || 0;
  if (cap === 0) { showToast('⚠️ 先にSES営業を採用してください'); return; }
  if (current >= cap) {
    showToast(`⚠️ 上限 ${cap}名（SES営業${state.employees?.['sales'] || 0}名×20）`);
    return;
  }
  if (state.money < DISPATCH_HIRE_COST) { showToast('💸 資金不足'); return; }
  state.money -= DISPATCH_HIRE_COST;
  state.dispatchCount = current + 1;
  state.deptCost['dispatch'] = (state.deptCost['dispatch'] || 0) + DISPATCH_HIRE_COST;
  showToast(`✅ 派遣スタッフ採用（計${state.dispatchCount}名）`);
  renderDepts();
}

function fireDispatch() {
  const locked = (state.contractDev?.length || 0) * CONTRACT_WORKERS;
  if ((state.dispatchCount || 0) <= locked) {
    showToast(locked > 0 ? '⚠️ 受託プロジェクト中のスタッフは削減できません' : '⚠️ 派遣スタッフがいません');
    return;
  }
  if (!(state.dispatchCount > 0)) return;
  state.dispatchCount--;
  state.morale['employee'] = Math.max(10, (state.morale['employee'] || 90) - 2);
  showToast('👋 派遣スタッフを1名削減（社員モラール−2）');
  renderDepts();
}

function startContractDev(type) {
  const count  = state.dispatchCount || 0;
  const locked = (state.contractDev?.length || 0) * CONTRACT_WORKERS;
  const free   = count - locked;
  if (free < CONTRACT_WORKERS) {
    showToast(`⚠️ フリーな派遣スタッフ${CONTRACT_WORKERS}名が必要（現在${free}名）`);
    return;
  }
  const isLarge = type === 'large';
  const minW  = isLarge ? CONTRACT_L_MIN_WEEKS  : CONTRACT_S_MIN_WEEKS;
  const maxW  = isLarge ? CONTRACT_L_MAX_WEEKS  : CONTRACT_S_MAX_WEEKS;
  const minMl = isLarge ? CONTRACT_L_MULT_MIN   : CONTRACT_S_MULT_MIN;
  const maxMl = isLarge ? CONTRACT_L_MULT_MAX   : CONTRACT_S_MULT_MAX;
  const minMg = isLarge ? CONTRACT_L_MARGIN_MIN : CONTRACT_S_MARGIN_MIN;
  const maxMg = isLarge ? CONTRACT_L_MARGIN_MAX : CONTRACT_S_MARGIN_MAX;

  const weeks = minW + Math.floor(Math.random() * (maxW - minW + 1));
  const t     = (weeks - minW) / (maxW - minW);
  const mult  = minMl + t * (maxMl - minMl);
  const marginPct = Math.round(minMg + t * (maxMg - minMg));
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);

  state.contractDev.push({ type, startWeek: currentWeek, durationWeeks: weeks, mult, marginPct });
  const expectedRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * mult * (weeks / 4));
  const label = isLarge ? '大型' : '小型';
  showToast(`🏗️ ${label}受託開始！${weeks}週 完了時売上 ${yen(expectedRev)}（利益率${marginPct}%）`);
  renderDepts();
}

// ---- 銀行審査 ----
function applyBankReview() {
  if (state.bankUnlocked) { showToast('✅ 審査済み（銀行口座開設済み）'); return; }
  const hist = state.reportHistory || [];
  if (hist.length < 4) { showToast('⚠️ データ不足（最低4週分必要）'); return; }
  const last4 = hist.slice(-4);
  const totalIncome  = last4.reduce((s, r) => s + (r.deptIncome || 0) + (r.flIncome || 0) + (r.staffingFees || 0) + (r.dispatchIncome || 0), 0);
  const totalExpense = last4.reduce((s, r) => s + (r.monthlyExp?.total || 0), 0);
  const profit = totalIncome - totalExpense;
  const margin = totalIncome > 0 ? profit / totalIncome : 0;
  if (margin >= 0.20) {
    state.bankUnlocked = true;
    updateTabVisibility();
    renderBank();
    showToast('🏦 審査通過！銀行タブが解放されました');
  } else {
    showToast(`❌ 審査不通過（利益率 ${(margin * 100).toFixed(1)}% — 20%以上が必要）`);
  }
}

// ---- タブ表示更新 ----
function updateTabVisibility() {
  const laborBtn = document.getElementById('labor-tab-btn');
  if (laborBtn) {
    const unlocked = (state.employees?.['finance'] || 0) >= 1;
    laborBtn.disabled  = !unlocked;
    laborBtn.innerHTML = unlocked ? '📊 財務' : '🔒 財務';
  }
  const bankBtn = document.getElementById('bank-tab-btn');
  if (bankBtn) {
    bankBtn.disabled  = !state.bankUnlocked;
    bankBtn.innerHTML = state.bankUnlocked ? '🏦 銀行' : '🔒 銀行';
  }
}

function syncNavTop() {
  const hh  = document.getElementById('header').offsetHeight;
  const nav  = document.getElementById('tab-nav');
  nav.style.top = hh + 'px';
  document.body.style.paddingTop = hh + 'px';
  const navH = nav.offsetHeight;
  document.documentElement.style.setProperty('--morale-box-top', (hh + navH) + 'px');
}

function hireManager(id) {
  const def = MANAGER_DEFS.find(m => m.id === id);
  if (!def) return;
  const salesCount   = state.employees?.['sales'] || 0;
  const maxCount     = Math.floor(salesCount / 10);
  const currentCount = state.managers?.[id] || 0;
  if (currentCount >= maxCount) {
    showToast(`⚠️ 営業${(currentCount + 1) * 10}名で${currentCount + 1}人目採用可`);
    return;
  }
  if (state.money < def.hireCost) { showToast('💸 資金不足'); return; }
  state.money -= def.hireCost;
  if (!state.managers) state.managers = {};
  state.managers[id] = currentCount + 1;
  showToast(`✅ ${def.name}（${state.managers[id]}人目）を採用しました`);
  renderDepts();
  renderAll();
}

function fireManager(id) {
  const def = MANAGER_DEFS.find(m => m.id === id);
  if (!def || !(state.managers?.[id] > 0)) return;
  state.managers[id] = (state.managers[id] || 1) - 1;
  if (state.managers[id] === 0) delete state.managers[id];
  state.morale['employee'] = Math.max(10, (state.morale['employee'] || 90) - 5);
  showToast(`👋 ${def.name}をリストラ（社員モラール−5）`);
  renderDepts();
  renderAll();
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
  // periodEarned = 部署収益 + FL粗利 + 人材紹介フィー（すべてグロス）
  // periodDeductible = FL報酬 + 全給与 + 家賃等（年間累積）
  const revenue    = state.periodEarned     || 0;
  const costs      = state.periodDeductible || 0;
  const netIncome  = revenue - costs;

  // 派遣事業部解放判定（2期目以降・利益率20%以上で決算を迎えた場合）
  if (!state.dispatchOpened && getGameTime().period >= 2 && revenue > 0) {
    const profitRate = netIncome / revenue;
    if (profitRate >= 0.20) {
      state.dispatchOpened = true;
      showToast('🏭 派遣事業部が解放されました！');
    }
  }
  const taxable    = Math.max(0, netIncome);
  state.periodEarned     = 0;
  state.periodDeductible = 0;
  state.periodStaffingPlacements = 0;

  const tax = Math.floor(taxable * CORP_TAX_RATE);
  const before = state.money;
  if (tax > 0) state.money -= tax;

  const netColor = netIncome >= 0 ? '#4ade80' : '#f87171';
  const rows = [
    `<div class="expense-row" style="color:#4ade80"><span>売上収益合計</span><span>＋${yen(revenue)}</span></div>`,
    `<div class="expense-row" style="color:#f87171"><span>費用合計（給与・家賃・FL報酬）</span><span>−${yen(costs)}</span></div>`,
    `<div class="expense-row" style="color:${netColor};font-weight:700;border-top:1px solid #2a2a50;padding-top:6px;margin-top:4px"><span>当期純利益</span><span>${netIncome >= 0 ? '＋' : '−'}${yen(Math.abs(netIncome))}</span></div>`,
    taxable > 0
      ? `<div class="expense-row" style="color:#f87171"><span>🏛️ 法人税（30%）</span><span>−${yen(tax)}</span></div>`
      : `<div class="expense-row" style="color:#94a3b8"><span>🏛️ 法人税</span><span>赤字のため免除</span></div>`,
  ].join('');
  document.getElementById('expense-detail').innerHTML =
    `<div style="text-align:center;font-size:13px;color:#fbbf24;margin-bottom:10px">📅 年度末決算 ― 損益計算書</div>` + rows;
  document.getElementById('expense-total').textContent  = tax > 0 ? `−${yen(tax)}` : '¥0';
  document.getElementById('expense-before').textContent = yen(before);
  document.getElementById('expense-after').textContent  = yen(state.money);
  document.getElementById('expense-after').style.color  = state.money < 0 ? '#f87171' : '#4ade80';
  document.getElementById('expense-modal').classList.remove('hidden');
  renderAll();
  if (tax > 0) showToast(`🏛️ 法人税 ${yen(tax)} を納付（純利益 ${yen(netIncome)} × 30%）`);
  else         showToast(`📊 年度末決算完了。当期は赤字のため法人税なし。`);
}

// ---- 紹介事業部 開設 ----

function openStaffingDivision() {
  if (state.staffingOpened) return;
  if (state.money < 50000000) { showToast('💸 資金が足りません！（必要: ¥50,000,000）'); return; }
  state.money -= 50000000;
  state.staffingOpened = true;
  renderDepts();
  showToast('🤝 紹介事業部を開設しました！');
}

function hireExec(id) {
  const e = EXEC_DEFS.find(x => x.id === id);
  if (!e || e.comingSoon || state.executives?.[id]) return;
  if (state.money < e.cost) { showToast('💸 資金が足りません！'); return; }
  state.money -= e.cost;
  if (!state.executives) state.executives = {};
  state.executives[id] = true;
  if (!state.execSettings) state.execSettings = {};
  state.execSettings[id] = {};
  (e.actions || []).forEach(a => { state.execSettings[id][a.key] = a.defaultOn; });
  showToast(`✅ ${e.name}を採用しました！`);
  renderDepts();
}

function fireExec(id) {
  const e = EXEC_DEFS.find(x => x.id === id);
  if (!e || !state.executives?.[id]) return;
  state.executives[id] = false;
  if (state.execSettings?.[id]) delete state.execSettings[id];
  showToast(`👋 ${e.name}を解雇しました`);
  renderDepts();
}

function toggleExecSetting(execId, key, val) {
  if (!state.execSettings) state.execSettings = {};
  if (!state.execSettings[execId]) state.execSettings[execId] = {};
  state.execSettings[execId][key] = val;
}

// ---- 銀行借入 ----

// { amount, months, monthlyRate, label }
const LOAN_OPTIONS = [
  { amount: 3000000,   months: 12, monthlyRate: 0.025, label: '小口融資' },
  { amount: 30000000,  months: 24, monthlyRate: 0.04,  label: '中口融資' },
  { amount: 200000000, months: 36, monthlyRate: 0.06,  label: '大口融資' },
];

function takeLoan(amount, months, monthlyRate) {
  const fee = Math.ceil(amount * LOAN_FEE_RATE);
  const interest = Math.ceil(amount * monthlyRate * months);
  const totalRepay = amount + interest;
  const monthlyPayment = Math.ceil(totalRepay / months);
  state.loans.push({ id: Date.now(), remaining: totalRepay, monthlyPayment, months, monthlyRate });
  state.money += amount - fee;
  showToast(`🏦 ${yen(amount)}融資実行！手数料${yen(fee)}差引　月返済${yen(monthlyPayment)}×${months}回`);
  renderBank();
  renderHeader();
}

function repayLoanFull(loanId) {
  const loan = state.loans.find(l => l.id === loanId);
  if (!loan) return;
  if (state.money < loan.remaining) { showToast('⚠️ 残高不足で一括返済できません'); return; }
  state.money -= loan.remaining;
  state.loans = state.loans.filter(l => l.id !== loanId);
  showToast(`✅ ${yen(loan.remaining)} 一括返済完了！`);
  renderBank();
  renderHeader();
}

function renderBank() {
  const container = document.getElementById('bank-content');
  if (!container) return;

  updateTabVisibility();

  if (!state.bankUnlocked) {
    container.innerHTML = `
      <div class="bank-locked">
        <div class="bank-lock-icon">🔒</div>
        <div class="bank-locked-title">銀行取引は利用できません</div>
        <p class="bank-locked-desc">財務タブで銀行審査に通過すると取引口座が開設されます</p>
      </div>`;
    return;
  }

  const totalDebt   = state.loans.reduce((a, l) => a + l.remaining, 0);
  const monthlyRepay = state.loans.reduce((a, l) => a + l.monthlyPayment, 0);
  const exp = calcMonthlyExpenses();

  const loanListHtml = state.loans.length > 0
    ? state.loans.map(l => `
        <div class="loan-item">
          <div>
            <span class="loan-remaining">残 ${yen(l.remaining)}</span>
            <span style="font-size:10px;color:#94a3b8;margin-left:6px">月${yen(l.monthlyPayment)}</span>
          </div>
          <button class="hire-btn" onclick="repayLoanFull(${l.id})" style="font-size:10px;padding:4px 8px;flex-shrink:0">一括返済</button>
        </div>`).join('')
    : '<p class="no-loan">現在ローンなし</p>';

  const loanBtnsHtml = LOAN_OPTIONS.map(opt => {
    const fee     = Math.ceil(opt.amount * LOAN_FEE_RATE);
    const interest = Math.ceil(opt.amount * opt.monthlyRate * opt.months);
    const monthly = Math.ceil((opt.amount + interest) / opt.months);
    const rateLabel = (opt.monthlyRate * 100).toFixed(1);
    return `<button class="loan-btn" onclick="takeLoan(${opt.amount},${opt.months},${opt.monthlyRate})">
      <span class="loan-amount">${opt.label} ${yen(opt.amount)}</span>
      <div class="loan-detail">月利${rateLabel}% · ${opt.months}回払 · 月${yen(monthly)} · 手数料${yen(fee)}</div>
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
    </div>
    ${(() => {
      const investCount = state.employees?.['investment'] || 0;
      if (!investCount) {
        return `<div class="bank-section" style="opacity:0.45">
          <div class="bank-subheader">🔒 証券取引所</div>
          <p class="no-loan" style="font-size:11px">財務部の資産運用スタッフを採用すると解放されます</p>
        </div>`;
      }
      if (!state.stocks) {
        return `<div class="bank-section">
          <div class="bank-subheader">📈 証券取引所</div>
          <p class="no-loan">初期化中...</p>
        </div>`;
      }
      const stockCards = STOCK_DEFS.map(def => {
        const s = state.stocks[def.id];
        if (!s) return '';
        const gain      = s.shares > 0 ? Math.round((s.price - s.avgCost) * s.shares) : 0;
        const gainColor = gain > 0 ? '#4ade80' : gain < 0 ? '#f87171' : '#94a3b8';
        const gainSign  = gain > 0 ? '+' : '';
        const hist = (s.history || [s.price]);
        const prevPrice = hist.length >= 2 ? hist[hist.length - 2] : s.price;
        const weekChg   = prevPrice > 0 ? ((s.price - prevPrice) / prevPrice * 100).toFixed(1) : '0.0';
        const chgColor  = parseFloat(weekChg) >= 0 ? '#4ade80' : '#f87171';
        const chgSign   = parseFloat(weekChg) >= 0 ? '+' : '';
        return `<div class="stock-card">
          <div class="stock-header">
            <span class="stock-name">${def.emoji} ${def.name}</span>
            <span class="stock-type-badge">${def.type}</span>
            <span class="stock-price">${yen(s.price)}<span style="font-size:9px;color:${chgColor};margin-left:4px">${chgSign}${weekChg}%</span></span>
          </div>
          ${s.shares > 0 ? `<div class="stock-hold">保有 <b>${s.shares}</b>株　取得単価 ${yen(Math.round(s.avgCost))}　評価損益 <span style="color:${gainColor};font-weight:700">${gainSign}${yen(gain)}</span></div>` : ''}
          <div class="stock-btns">
            <button class="loan-btn" style="flex:1;font-size:11px" onclick="buyStock('${def.id}',100)">100株 買 ${yen(s.price * 100)}</button>
            <button class="loan-btn" style="flex:1;font-size:11px" onclick="buyStock('${def.id}',500)">500株 買 ${yen(s.price * 500)}</button>
            ${s.shares >= 100 ? `<button class="loan-btn" style="flex:1;font-size:11px;border-color:#f87171;color:#f87171" onclick="sellStock('${def.id}',100)">100株 売</button>` : ''}
            ${s.shares > 0 ? `<button class="loan-btn" style="flex:1;font-size:11px;border-color:#f87171;color:#f87171" onclick="sellStock('${def.id}',${s.shares})">全売</button>` : ''}
          </div>
        </div>`;
      }).join('');
      return `<div class="bank-section">
        <div class="bank-subheader">📈 証券取引所</div>
        ${stockCards}
      </div>`;
    })()}`;
}

// ---- 交流タブ（精神状況） ----

const EXCHANGE_ACTIONS = [
  // ---- 社長 ----
  { id: 'ex_ceo_round',  group: 'ceo', name: '☕ 社長懇談会',         desc: '社長が社員と直接対話。社長・社員の好感度UP',        cost: () => Math.max(150000,  getTotalIncome() * 120), targets: ['ceo','employee'], gain: 4,  color: '#a78bfa' },
  { id: 'ex_ceo_onsen',  group: 'ceo', name: '♨️ 経営合宿（温泉地）', desc: '温泉地で経営の振り返り。社長のモラールが大幅回復。',  cost: () => Math.max(400000,  getTotalIncome() * 300), targets: ['ceo'],            gain: 7,  color: '#7dd3fc' },
  { id: 'ex_ceo_media',  group: 'ceo', name: '📺 メディア取材対応',   desc: '経済誌に掲載。自社PRと社長の達成感がUP。',          cost: () => Math.max(1000000, getTotalIncome() * 700), targets: ['ceo'],            gain: 12, color: '#f97316' },
  // ---- 社員（社員1人あたりの費用） ----
  { id: 'ex_seminar', group: 'employee', name: '📚 研修・セミナー開催', desc: '社員のスキルアップと充実感を高める',
    perHead: () => Math.max(1, getEmployeeCount()),
    cost: () => Math.max(10000,  getTotalIncome() * 8)  * Math.max(1, getEmployeeCount()),
    targets: ['employee'], gain: 4, color: '#60a5fa' },
  { id: 'ex_bonus', group: 'employee', name: '💴 特別ボーナス支給', desc: '社員・FLへの臨時ボーナスで大幅改善',
    perHead: () => Math.max(1, getEmployeeCount() + (state.freelancers||0)),
    cost: () => Math.max(50000, getTotalIncome() * 40) * Math.max(1, getEmployeeCount() + (state.freelancers||0)),
    targets: ['employee','freelance'], gain: 10, color: '#ec4899' },
  // ---- 全体（社員+FL 1人あたりの費用） ----
  { id: 'ex_party', group: 'all', name: '🍻 社内交流会', desc: '社員・FLの好感度を上げる懇親会',
    perHead: () => Math.max(1, getEmployeeCount() + (state.freelancers||0)),
    cost: () => Math.max(3000,  getTotalIncome() * 3)  * Math.max(1, getEmployeeCount() + (state.freelancers||0)),
    targets: ['employee','freelance'], gain: 2, color: '#4ade80' },
  // ---- FL（FL1人あたりの費用） ----
  { id: 'ex_fl_visit', group: 'fl', name: '🏢 FL常駐先への差し入れ', desc: '常駐先へ差し入れ訪問。FL好感度UP',
    perHead: () => Math.max(1, state.freelancers||0),
    cost: () => Math.max(5000, getTotalIncome() * 6)   * Math.max(1, state.freelancers||0),
    targets: ['freelance'], gain: 6, color: '#7dd3fc' },
  { id: 'ex_fl_event', group: 'fl', name: '🎉 FL専用交流イベント', desc: 'FL限定の感謝イベント。離脱率が激減',
    perHead: () => Math.max(1, state.freelancers||0),
    cost: () => Math.max(20000, getTotalIncome() * 20) * Math.max(1, state.freelancers||0),
    targets: ['freelance'], gain: 12, color: '#a78bfa' },
];

function doExchangeAction(actionId) {
  const action = EXCHANGE_ACTIONS.find(a => a.id === actionId);
  if (!action) return;
  const cost = action.cost();
  if (state.money < cost) { showToast('💸 資金が不足しています'); return; }
  if (action.group === 'fl' && state.freelancers === 0) { showToast('👨‍💻 FL在籍なし'); return; }
  state.money -= cost;
  const salaryMult = getCeoSalaryMoraleMult();
  const effectiveGain = Math.round(action.gain * salaryMult);
  action.targets.forEach(t => { state.morale[t] = Math.min(100, (state.morale[t] || 90) + effectiveGain); });
  showToast(`${action.name}を実施！好感度+${effectiveGain}${salaryMult > 1 ? `（給料ボーナス×${salaryMult.toFixed(2)}）` : ''}`);
  renderAll();
}

function renderExchange() {
  const container = document.getElementById('exchange-content');
  if (!container) return;

  const m = state.morale;
  const mc  = v => v >= 85 ? '#4ade80' : v >= 60 ? '#fbbf24' : '#f87171';
  const ml  = v => v >= 95 ? '絶好調' : v >= 85 ? '良好' : v >= 70 ? '普通' : v >= 50 ? '疲弊中' : '崩壊寸前';
  const avg = ((m.ceo || 90) + (m.employee || 90) + (m.freelance || 90)) / 3;
  const eff = getMoraleEffectPct().toFixed(0);

  const flFavor    = m.freelance || 90;
  const empMorale  = m.employee || 90;
  const empPenaltyDisp = Math.max(0, (90 - empMorale) * 0.001);
  const mgrQuitReduction = (state.managers?.mgr_ses || 0) * 0.005;
  const departChance   = Math.min(0.55, Math.max(0, 0.02 + (100 - flFavor) * 0.002 + empPenaltyDisp - mgrQuitReduction));
  const empFlMult     = getEmpMoraleMult();
  const salaryMult    = getCeoSalaryMoraleMult();

  const cols = [
    { key: 'ceo',       label: '👔 社長' },
    { key: 'employee',  label: '👨‍💼 社員' },
    { key: 'freelance', label: '💻 FL' },
  ].map(({ key, label }) => {
    const v = m[key] || 90;
    const sub = key === 'freelance'
      ? `<span style="color:#93c5fd">離脱率 ${(departChance*100).toFixed(0)}%</span>`
      : key === 'employee'
        ? `<span style="color:#86efac">収益×${empFlMult.toFixed(2)}</span>`
        : salaryMult > 1
          ? `<span style="color:#fde68a">効果×${salaryMult.toFixed(2)}</span>`
          : `<span style="color:transparent">-</span>`;
    return `<div class="morale-col">
      <div class="morale-col-label">${label}</div>
      <div class="morale-col-val" style="color:${mc(v)}">${v}</div>
      <div class="morale-bar-wrap"><div class="morale-bar" style="width:${v}%;background:${mc(v)}"></div></div>
      <div class="morale-col-status" style="color:${mc(v)}">${ml(v)}</div>
      <div class="morale-col-sub">${sub}</div>
    </div>`;
  }).join('');

  const makeBtn = a => {
    const isFL = a.group === 'fl';
    const cost = a.cost();
    const effectiveGain = Math.round(a.gain * salaryMult);
    const ok   = state.money >= cost && (!isFL || state.freelancers > 0);
    const disabledReason = isFL && state.freelancers === 0 ? 'FL在籍なし' : ok ? '' : '資金不足';
    let costHtml;
    if (disabledReason) {
      costHtml = `<span style="color:#666">${disabledReason}</span>`;
    } else if (a.perHead) {
      const headCount = a.perHead();
      const unitCost = headCount > 0 ? Math.round(cost / headCount) : cost;
      const unit = a.group === 'fl' ? '/FL' : '/人';
      costHtml = `<span style="color:#fbbf24">${yen(unitCost)}${unit}</span><br><span style="font-size:10px;color:#888">計 ${yen(cost)}</span>`;
    } else {
      costHtml = `<span style="color:#fbbf24">${yen(cost)}</span>`;
    }
    return `<button class="exchange-btn" onclick="doExchangeAction('${a.id}')" ${ok ? '' : 'disabled'}>
      <div class="exchange-btn-left">
        <span class="exchange-btn-name">${a.name}</span>
        <span class="exchange-btn-desc">${a.desc}</span>
      </div>
      <div class="exchange-btn-right">
        <div class="exchange-btn-cost">${costHtml}</div>
        <span class="exchange-btn-effect" style="color:${a.color}">好感度+${effectiveGain}</span>
      </div>
    </button>`;
  };

  const ceoBtns  = EXCHANGE_ACTIONS.filter(a => a.group === 'ceo').map(makeBtn).join('');
  const empBtns  = EXCHANGE_ACTIONS.filter(a => a.group === 'employee' || a.group === 'all').map(makeBtn).join('');
  const flBtns   = EXCHANGE_ACTIONS.filter(a => a.group === 'fl').map(makeBtn).join('');

  const ceoWarning = m.ceo < 50
    ? `<div style="font-size:11px;color:#f87171;margin-top:6px;padding:6px 8px;background:#f8717118;border-radius:6px;border:1px solid #f8717133">⚠️ 社長の士気が低下中。社員・FLの士気低下が加速しています。</div>`
    : '';

  container.innerHTML = `
    <div class="exchange-morale-box">
      <div class="morale-cols">${cols}</div>
      ${ceoWarning}
      <div class="morale-effect">売上影響: <strong style="color:${Number(eff)>=0?'#4ade80':'#f87171'}">${Number(eff)>=0?'+':''}${eff}%</strong>（平均 ${avg.toFixed(0)}/100）</div>
    </div>
    <div class="exchange-actions">
      <div class="exchange-action-title" style="color:#fbbf24">👔 社長アクション</div>
      ${ceoBtns}
    </div>
    <div class="exchange-actions" style="margin-top:12px">
      <div class="exchange-action-title" style="color:#86efac">👨‍💼 社員・全体アクション</div>
      ${empBtns}
    </div>
    <div class="exchange-actions" style="margin-top:12px">
      <div class="exchange-action-title" style="color:#93c5fd">👨‍💻 FL アクション</div>
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
    if (!state.morale)          state.morale          = { ceo: 90, employee: 90, freelance: 90 };
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
    if (state.ceoSalary === undefined)  state.ceoSalary = 300000;
    if (!state.reportHistory)           state.reportHistory = [];
    if (state.periodDeductible === undefined) state.periodDeductible = 0;
    if (state.isPaused === undefined)   state.isPaused = false;
    // 旧 upgrades boolean → 週番号変換
    { const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
      Object.keys(state.upgrades || {}).forEach(k => {
        if (state.upgrades[k] === true) state.upgrades[k] = { week: currentWeek };
      }); }
    if (!state.flData) state.flData = [];
    { const preFlCount = state.freelancers || 0;
      while (state.flData.length < preFlCount) {
        state.flData.push({ gross: 600000 + Math.floor(Math.random() * 400001), profitRate: 0.10 + Math.random() * 0.10 });
      }
      state.freelancers = state.flData.length; }
    if (state.flGrossRevenue === undefined)           state.flGrossRevenue = 0;
    if (state.staffingOpened === undefined)           state.staffingOpened = true;
    if (state.dispatchSales === undefined)            state.dispatchSales = 0;
    if (!Array.isArray(state.contractDev))            state.contractDev = state.contractDev ? [state.contractDev] : [];
    if (state.dispatchOpened === undefined)           state.dispatchOpened = (state.dispatchCount || 0) > 0;
    if (state.stocks === undefined)                   state.stocks = null;
    // 資産運用スタッフが既にいてstocksが未初期化の場合は初期化
    if ((state.employees?.['investment'] || 0) >= 1 && !state.stocks) initStocks();
    if (state.periodStaffingPlacements === undefined) state.periodStaffingPlacements = 0;
    if (state.hideWeeklyReport === undefined)         state.hideWeeklyReport = false;
    if (state.autoCloseWeekly === undefined)          state.autoCloseWeekly = true;
    if (!state.executives)                            state.executives = {};
    if (!state.execSettings)                          state.execSettings = {};
    if (!state.managers)                              state.managers = {};
    Object.keys(state.managers).forEach(k => { if (state.managers[k] === true) state.managers[k] = 1; });
    EXEC_DEFS.forEach(e => {
      if (state.executives[e.id] && !state.execSettings[e.id]) {
        state.execSettings[e.id] = {};
        (e.actions || []).forEach(a => { state.execSettings[e.id][a.key] = a.defaultOn; });
      }
    });
    if (state.bgmMuted === undefined)                 state.bgmMuted = false;
    bgmMuted = state.bgmMuted;
    const bgmBtn = document.getElementById('bgm-btn');
    if (bgmBtn) bgmBtn.textContent = bgmMuted ? '🔇' : '🔊';
    const chk = document.getElementById('hide-weekly-report');
    if (chk) chk.checked = !!state.hideWeeklyReport;
    const acChk = document.getElementById('auto-close-report');
    if (acChk) acChk.checked = state.autoCloseWeekly !== false;
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
    if (state.periodDeductible === undefined) state.periodDeductible = 0;
    if (state.isPaused === undefined) state.isPaused = false;
    { const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
      Object.keys(state.upgrades || {}).forEach(k => {
        if (state.upgrades[k] === true) state.upgrades[k] = { week: currentWeek };
      }); }
    recalcMults();
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
  html += `<div class="danger-zone">
    <button class="reset-btn" onclick="resetGame()">🗑️ データをリセット</button>
    <button class="reset-btn" style="margin-top:8px;background:#0f2027;border-color:#38bdf8;color:#38bdf8" onclick="if(confirm('進行中のデータをリセットして最初からスタートしますか？\n（スロットセーブは残ります）')){localStorage.removeItem(SAVE_KEY);location.reload();}">🔄 初めから</button>
  </div>`;
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
  const flCap         = salesCount * 15;
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

  const atCap = salesCount > 0 && fl >= flCap;

  return `<div class="island-row ${fl > 0 ? 'island-row-active' : ''}">
    <div class="dept-emoji">👨‍💻</div>
    <div class="dept-info">
      <div class="dept-name" style="color:#93c5fd">フリーランスエンジニア <span class="emp-count" style="background:#3b5bdb">${fl}名</span>${atCap ? '<span style="font-size:10px;color:#f87171;margin-left:4px">上限</span>' : ''}</div>
      <div class="dept-desc">${incomeDetail}</div>
      ${salesCount > 0
        ? (() => { const sl = getSESSeasonalLabel(); return `<div class="dept-margin"><span class="ml" style="color:#a78bfa">採用確率 ${(recruitChance*100).toFixed(1)}%/週 × 営業${salesCount}名　上限 ${flCap}名</span>${sl ? `<br><span class="ml" style="color:${sl.startsWith('🔥')?'#fb923c':'#93c5fd'}">${sl}</span>` : ''}</div>`; })()
        : `<div class="dept-margin"><span class="ml" style="color:#555">営業を雇うと毎週採用活動（1人あたり最大15名）</span></div>`}
      ${fl > activeFL ? `<div class="dept-margin"><span class="ml" style="color:#c084fc">⏳ 翌週稼働予定 ${fl - activeFL}名</span></div>` : ''}
    </div>
  </div>`;
}


function _buildDispatchCard() {
  const contracts  = state.contractDev || [];
  const count      = state.dispatchCount || 0;
  const cap        = getDispatchCapacity();
  const atCap      = cap > 0 && count >= cap;
  const lockedCnt  = Math.min(contracts.length * CONTRACT_WORKERS, count);
  const freeCount  = Math.max(0, count - lockedCnt);
  const salesCount = state.employees?.['sales'] || 0;
  const canHire    = !atCap && state.money >= DISPATCH_HIRE_COST;
  const canFire    = count > lockedCnt;

  const weeklyGross = freeCount * DISPATCH_WEEKLY_GROSS;
  const weeklyCost  = count * DISPATCH_MONTHLY_SALARY / 4;
  const weeklyNet   = weeklyGross - weeklyCost;

  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  const contractRows = contracts.map(c => {
    const elapsed   = currentWeek - c.startWeek;
    const remaining = Math.max(0, c.durationWeeks - elapsed);
    const progress  = Math.min(100, elapsed / c.durationWeeks * 100).toFixed(0);
    const expectRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * c.mult * (c.durationWeeks / 4));
    const label     = c.type === 'large' ? '大型' : '小型';
    const color     = c.type === 'large' ? '#f59e0b' : '#60a5fa';
    const bgColor   = c.type === 'large' ? 'rgba(245,158,11,0.06)' : 'rgba(96,165,250,0.06)';
    const barColor  = c.type === 'large' ? '#f59e0b' : '#60a5fa';
    const bgBadge   = c.type === 'large' ? '#78350f' : '#1e3a5f';
    return `<div class="island-row island-row-active" style="border-left:3px solid ${color};background:${bgColor};padding-left:11px">
      <div class="dept-emoji">🏗️</div>
      <div class="dept-info">
        <div class="dept-name" style="color:${color}">${label}受託 進行中 <span class="emp-count" style="background:${bgBadge}">${elapsed}/${c.durationWeeks}週</span></div>
        <div class="dept-desc">スタッフ${CONTRACT_WORKERS}名専任　残り${remaining}週で完了</div>
        <div style="margin:4px 0 2px;background:#1f2937;border-radius:4px;height:5px"><div style="height:5px;background:${barColor};width:${progress}%;border-radius:4px"></div></div>
        <div class="dept-margin"><span class="ml">完了時一括: ${yen(expectRev)} 計上（想定利益率${c.marginPct}%）</span></div>
      </div>
    </div>`;
  }).join('');

  const freeSlots = Math.floor(freeCount / CONTRACT_WORKERS);
  let newContractHtml = '';
  if (freeSlots >= 1) {
    const sMinRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * CONTRACT_S_MULT_MIN * (CONTRACT_S_MIN_WEEKS / 4));
    const sMaxRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * CONTRACT_S_MULT_MAX * (CONTRACT_S_MAX_WEEKS / 4));
    const lMinRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * CONTRACT_L_MULT_MIN * (CONTRACT_L_MIN_WEEKS / 4));
    const lMaxRev = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * CONTRACT_L_MULT_MAX * (CONTRACT_L_MAX_WEEKS / 4));
    newContractHtml = `<div class="island-row">
      <div class="dept-emoji">🏗️</div>
      <div class="dept-info">
        <div class="dept-name" style="color:#fbbf24">受託開発受注 <span style="font-size:10px;color:#a3e635;margin-left:4px">スロット×${freeSlots}</span></div>
        <div class="dept-desc">フリースタッフ10名につき1件受注可能。期間中は通常収益なし。</div>
        <div class="dept-margin"><span class="ml">小型: ${CONTRACT_S_MIN_WEEKS}〜${CONTRACT_S_MAX_WEEKS}週 売上${yen(sMinRev)}〜${yen(sMaxRev)}（利益率${CONTRACT_S_MARGIN_MIN}〜${CONTRACT_S_MARGIN_MAX}%）</span></div>
        <div class="dept-margin"><span class="ml">大型: ${CONTRACT_L_MIN_WEEKS}〜${CONTRACT_L_MAX_WEEKS}週 売上${yen(lMinRev)}〜${yen(lMaxRev)}（利益率${CONTRACT_L_MARGIN_MIN}〜${CONTRACT_L_MARGIN_MAX}%）</span></div>
      </div>
      <div class="dept-btn-group">
        <button class="hire-btn" style="background:#1e3a5f;border-color:#60a5fa;color:#93c5fd" onclick="startContractDev('small')">小型<br><small>受注</small></button>
        <button class="hire-btn" style="background:#3d1f00;border-color:#f59e0b;color:#fbbf24" onclick="startContractDev('large')">大型<br><small>受注</small></button>
      </div>
    </div>`;
  }

  return `
    <div class="island-row ${count > 0 ? 'island-row-active' : ''}">
      <div class="dept-emoji">🏭</div>
      <div class="dept-info">
        <div class="dept-name" style="color:#86efac">派遣スタッフ
          <span class="emp-count" style="background:#14532d">${count}名</span>
          ${lockedCnt > 0 ? `<span style="font-size:10px;color:#f59e0b;margin-left:4px">受託${lockedCnt}名拘束</span>` : ''}
          ${atCap ? '<span style="font-size:10px;color:#f87171;margin-left:4px">上限</span>' : ''}
        </div>
        <div class="dept-desc">${count > 0
          ? `フリー${freeCount}名: 請求 ${yen(weeklyGross)}/週　全給与 −${yen(Math.round(weeklyCost))}/週　利益 ${yen(weeklyNet)}/週`
          : `月収30万+社保=34.5万/月　請求=月額×1.2　採用費${yen(DISPATCH_HIRE_COST)}`
        }</div>
        <div class="dept-margin"><span class="ml">上限 ${cap}名（SES営業${salesCount}名×20）　離脱率 ${(DISPATCH_QUIT_RATE*100).toFixed(0)}%/週</span></div>
      </div>
      <div class="dept-btn-group">
        ${canFire ? `<button class="fire-btn" onclick="fireDispatch()">−</button>` : ''}
        <button class="hire-btn${canHire ? '' : ' disabled'}" onclick="hireDispatch()">${cap === 0 ? '要営業' : atCap ? '上限' : '採用'}<br><small>${canHire ? yen(DISPATCH_HIRE_COST) : ''}</small></button>
      </div>
    </div>
    ${contractRows}
    ${newContractHtml}
  `;
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
    const salesCap = emp * 10;
    const curSales = state.employees['sales'] || 0;
    incomeText = `営業上限 ${salesCap}名（現在${curSales}名）　採用コスト −${Math.min(r, 90).toFixed(0)}%　FL採用確率 ＋${(emp*3).toFixed(0)}%`;
  } else if (def.special === 'staffingSales') {
    const findRate = getStaffingFindRate();
    const sLbl = getStaffingSeasonalLabel();
    incomeText = `発掘確率 ${(findRate*100).toFixed(1)}%/週/人　成約時: 年収×35%　月次固定費 ${yen(Math.ceil(def.monthlySalary*(1+def.insuranceRate)*emp))}/月${sLbl ? `<br><span style="color:${sLbl.startsWith('🔥')?'#fb923c':'#93c5fd'}">${sLbl}</span>` : ''}`;
  } else if (def.special === 'marketing') {
    const mktMult = state.deptMults['marketing'] || 1;
    incomeText = `SES採用確率 ＋${(emp*0.6*mktMult).toFixed(1)}%/週　紹介発掘率 ＋${(emp*0.5*mktMult).toFixed(1)}%/週　月次固定費 ${yen(Math.ceil(def.monthlySalary*(1+def.insuranceRate)*emp))}/月`;
  } else if (id === 'sales') {
    const sLbl = getSESSeasonalLabel();
    incomeText = `採用確率 ${(getRecruitChance()*100).toFixed(1)}%/週/人　月次固定費 ${yen(Math.ceil(def.monthlySalary*(1+def.insuranceRate)*emp))}/月${sLbl ? `<br><span style="color:${sLbl.startsWith('🔥')?'#fb923c':'#93c5fd'}">${sLbl}</span>` : ''}`;
  } else {
    const inc = getDeptIncome(id);
    incomeText = `${yen(inc)}/秒　(${yen(def.incomePerSec*(state.deptMults[id]||1))}/秒/人)`;
  }

  const hireLabel = id === 'hr' ? 'MGR採用' : '採用';
  const fireBtn = emp > 0
    ? `<button class="fire-btn" onclick="fire('${id}')" title="1名リストラ">−</button>`
    : '';
  return `<div class="island-row ${emp > 0 ? 'island-row-active' : ''}">
    <div class="dept-emoji">${def.emoji}</div>
    <div class="dept-info">
      <div class="dept-name">${def.name} <span class="emp-count">${emp}人</span></div>
      <div class="dept-desc">${def.desc}</div>
      <div class="dept-income">${incomeText}</div>
    </div>
    <div class="dept-btn-group">
      <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="hire('${id}')">
        ${hireLabel}<br><small>${atCap ? '満員' : yen(hireCost)}</small>
      </button>
      ${fireBtn}
    </div>
  </div>`;
}

function _deptUnlockScore(primaryId) {
  const def = DEPT_DEFS.find(d => d.id === primaryId);
  if (!def) return 0;
  if ((state.employees[primaryId] || 0) > 0) return 1e15;
  if (state.totalEarned >= def.unlockAt) return 1e15 - def.unlockAt;
  return -def.unlockAt;
}

function _execIslandScore() {
  const hired = EXEC_DEFS.some(e => state.executives?.[e.id]);
  if (hired) return 1e15;
  const firstUnlocked = EXEC_DEFS.find(e => !e.comingSoon && state.totalEarned >= e.unlockAt);
  if (firstUnlocked) return 1e15 - firstUnlocked.unlockAt;
  return -EXEC_DEFS[0].unlockAt;
}

function renderDepts() {
  const container = document.getElementById('depts-list');

  let html = _buildOfficeCard();

  // SES事業部は常時先頭
  html += `<div class="dept-island island-sales">
    <div class="island-hdr"><span class="island-icon">💼</span><span>SES事業部</span></div>
    ${_buildDeptRow('sales')}
    ${_buildFLCard()}
    ${MANAGER_DEFS.filter(m => m.island === 'ses').map(m => _buildManagerCard(m)).join('')}
  </div>`;

  // 固定表示順（SES → 紹介 → 派遣 → 財務 → マーケ → グローバル）
  const _curPeriod       = getGameTime().period;
  const staffingUnlocked = _curPeriod >= 2 || (state.employees?.staffing || 0) > 0 || state.staffingOpened === true;
  const dispatchUnlocked = state.dispatchOpened === true || (state.dispatchCount || 0) > 0;

  // 紹介事業部
  html += `<div class="dept-island island-staffing">
    <div class="island-hdr"><span class="island-icon">🤝</span><span>人材紹介事業部</span></div>
    ${staffingUnlocked
      ? _buildDeptRow('staffing') + MANAGER_DEFS.filter(m => m.island === 'staffing').map(m => _buildManagerCard(m)).join('')
      : `<div class="island-row island-row-locked"><div class="dept-emoji" style="font-size:24px;opacity:0.4">🔒</div><div class="dept-info"><div class="dept-name" style="opacity:0.5">人材紹介事業部</div><div class="dept-unlock">2期目に自動解放</div></div></div>`
    }
  </div>`;

  // 派遣事業部
  html += `<div class="dept-island island-dispatch">
    <div class="island-hdr"><span class="island-icon">🏭</span><span>派遣事業部</span></div>
    ${dispatchUnlocked
      ? _buildDispatchCard()
      : `<div class="island-row island-row-locked"><div class="dept-emoji" style="font-size:24px;opacity:0.4">🔒</div><div class="dept-info"><div class="dept-name" style="opacity:0.5">派遣事業部</div><div class="dept-unlock">2期目以降・年度決算で利益率20%以上を達成すると解放</div></div></div>`
    }
  </div>`;

  // 財務部
  html += `<div class="dept-island island-finance">
    <div class="island-hdr"><span class="island-icon">💹</span><span>財務部</span></div>
    ${_buildDeptRow('finance')}
    ${_buildDeptRow('investment')}
  </div>`;

  // マーケティング部
  html += `<div class="dept-island island-marketing">
    <div class="island-hdr"><span class="island-icon">📣</span><span>マーケティング部</span></div>
    ${_buildDeptRow('marketing')}
  </div>`;

  // グローバル部
  html += `<div class="dept-island island-global">
    <div class="island-hdr"><span class="island-icon">🌐</span><span>グローバル部</span></div>
    ${_buildDeptRow('global')}
  </div>`;

  container.innerHTML = html;
}

function _buildManagerCard(m) {
  const count      = state.managers?.[m.id] || 0;
  const salesCount = state.employees?.['sales'] || 0;
  const maxCount   = Math.floor(salesCount / 10);
  const unlocked   = (state.totalEarned || 0) >= m.unlockAt;
  const canAfford  = state.money >= m.hireCost;
  const canHire    = count < maxCount;

  if (!unlocked) {
    return `<div class="island-row exec-card exec-locked">
      <div class="dept-emoji" style="opacity:0.4">🔒</div>
      <div class="dept-info">
        <div class="dept-name" style="opacity:0.5">${m.name} <span class="exec-badge soon">SOON</span></div>
        <div class="dept-desc">累計売上 ${yen(m.unlockAt)} で解放</div>
      </div>
    </div>`;
  }

  const badge = count > 0
    ? `<span class="exec-badge active">在籍 ${count}名</span>`
    : `<span class="exec-badge" style="color:#888;background:#1a1a2e">空席</span>`;

  const salaryLine = count > 0
    ? `<div class="dept-margin"><span class="ml">月給合計 ${yen(Math.ceil(m.monthlySalary * 1.15 * count))}（${count}名・社保込）</span></div>`
    : '';

  let effectLine = '';
  if (count > 0) {
    if (m.island === 'ses') {
      const recruitB = (0.12 * (Math.pow(1.25, count) - 1) * 100).toFixed(1);
      const quitB    = (count * 0.5).toFixed(1);
      effectLine = `<div class="dept-margin"><span class="ml" style="color:#a78bfa">効果: FL採用率+${recruitB}% / 離脱率−${quitB}%</span></div>`;
    } else if (m.island === 'staffing') {
      const findB = (0.20 * (Math.pow(1.25, count) - 1) * 100).toFixed(1);
      effectLine = `<div class="dept-margin"><span class="ml" style="color:#a78bfa">効果: 発掘確率+${findB}%</span></div>`;
    }
  }

  const nextNeedSales = (count + 1) * 10;
  const limitLine = `<div class="dept-margin"><span class="ml" style="color:#555">採用上限: 営業${nextNeedSales}名で${count + 1}人目（現在${salesCount}名）</span></div>`;

  const hireBtn = `<button class="hire-btn${(canHire && canAfford) ? '' : ' disabled'}" onclick="hireManager('${m.id}')">採用<br><small>${yen(m.hireCost)}</small></button>`;
  const fireBtn = count > 0 ? `<button class="fire-btn" onclick="fireManager('${m.id}')">−</button>` : '';

  return `<div class="island-row exec-card${count > 0 ? ' island-row-active' : ''}">
    <div class="dept-emoji">${m.emoji}</div>
    <div class="dept-info">
      <div class="dept-name">${m.name} ${badge}</div>
      <div class="dept-desc">${m.desc}</div>
      ${salaryLine}
      ${effectLine}
      ${limitLine}
    </div>
    <div class="dept-btn-group">
      ${fireBtn}
      ${hireBtn}
    </div>
  </div>`;
}

function _buildExecCard(e) {
  const hired = !!state.executives?.[e.id];
  const canUnlock = state.totalEarned >= e.unlockAt;
  const canAfford = state.money >= e.cost;
  const salary = getExecMonthlySalary();

  if (e.comingSoon) {
    return `<div class="island-row exec-card exec-soon">
      <div class="dept-emoji">${e.emoji}</div>
      <div class="dept-info">
        <div class="dept-name">${e.name} <span class="exec-badge soon">SOON</span></div>
        <div class="dept-desc">${e.desc}</div>
      </div>
    </div>`;
  }

  if (!canUnlock) {
    return `<div class="island-row exec-card exec-locked">
      <div class="dept-emoji" style="opacity:0.35;filter:grayscale(1)">${e.emoji}</div>
      <div class="dept-info">
        <div class="dept-name" style="color:#555">${e.name}</div>
        <div class="dept-desc" style="color:#444">累計売上 ${yen(e.unlockAt)} で解放</div>
      </div>
      <button class="hire-btn disabled" style="font-size:10px;padding:6px 10px">🔒</button>
    </div>`;
  }

  if (hired) {
    const settings = state.execSettings?.[e.id] || {};
    const checkboxes = (e.actions || []).map(a =>
      `<label class="exec-setting-label">
        <input type="checkbox" ${settings[a.key] !== false ? 'checked' : ''}
          onchange="toggleExecSetting('${e.id}','${a.key}',this.checked)">
        <span>${a.label}</span>
      </label>`
    ).join('');
    return `<div class="island-row exec-card exec-active">
      <div class="dept-emoji">${e.emoji}</div>
      <div class="dept-info">
        <div class="dept-name">${e.name} <span class="exec-badge active">稼働中</span></div>
        <div class="dept-desc">${e.role}</div>
        <div class="dept-income">月報酬 ${yen(salary)}（会社規模連動）</div>
        ${checkboxes ? `<div class="exec-settings-wrap">${checkboxes}</div>` : ''}
      </div>
      <button class="fire-btn" onclick="fireExec('${e.id}')" style="font-size:10px;padding:5px 8px;flex-shrink:0">解雇</button>
    </div>`;
  }

  return `<div class="island-row exec-card">
    <div class="dept-emoji">${e.emoji}</div>
    <div class="dept-info">
      <div class="dept-name">${e.name}</div>
      <div class="dept-desc">${e.desc}</div>
      <div class="dept-income">採用費 ${yen(e.cost)} ／ 月報酬 ${yen(salary)}（規模連動）</div>
    </div>
    <button class="hire-btn${canAfford ? '' : ' disabled'}" onclick="hireExec('${e.id}')" style="font-size:10px;padding:6px 10px">
      ${canAfford ? '採用' : '資金不足'}
    </button>
  </div>`;
}

function renderUpgrades() {
  const container = document.getElementById('upgrades-list');
  const currentWeek = Math.floor(state.elapsedSeconds / WEEK_SEC);
  let availableCount = 0;

  const GROUPS = [
    { key: 'sales',      label: '💼 SES営業',       effectLabel: 'FL採用確率UP' },
    { key: 'freelancer', label: '👨‍💻 フリーランス',    effectLabel: 'FL単価UP' },
    { key: 'staffing',   label: '🤝 人材紹介営業',   effectLabel: '発掘・成約率UP' },
    { key: 'marketing',  label: '📣 マーケティング部', effectLabel: '採用率UP効果UP' },
    { key: 'finance',    label: '📊 財務部',         effectLabel: '収益UP' },
    { key: 'global',     label: '🌏 グローバル部',   effectLabel: '収益UP' },
  ];

  let html = '';
  GROUPS.forEach(group => {
    const defs = UPGRADE_DEFS.filter(def => {
      if (def.dept !== group.key) return false;
      return Object.entries(def.req).every(([id, n]) => (state.employees[id] || 0) >= n);
    });
    if (defs.length === 0) return;

    html += `<div class="upgrade-group-hdr">${group.label} <span class="upgrade-group-effect">${group.effectLabel}</span></div>`;

    defs.forEach(def => {
      const ug = state.upgrades[def.id];
      const purchasedWeek = ug ? (typeof ug === 'object' ? ug.week : 0) : null;
      const isActive  = ug && currentWeek < purchasedWeek + 4;
      const isExpired = ug && !isActive;
      const weeksLeft = isActive ? (purchasedWeek + 4 - currentWeek) : 0;

      if (isActive) {
        html += `<div class="upgrade-card upgrade-active">
          <div class="upgrade-emoji">${def.emoji}</div>
          <div class="upgrade-info">
            <div class="upgrade-name">${def.name}</div>
            <div class="upgrade-effect">×${def.mult} 効果中</div>
            <div class="upgrade-timer">残り ${weeksLeft}週</div>
          </div>
          <div class="upgrade-status-badge active">稼働中</div>
        </div>`;
      } else {
        availableCount++;
        const canAfford = state.money >= def.cost;
        const label = isExpired ? '再購入' : '購入';
        html += `<div class="upgrade-card${canAfford ? '' : ' cant-afford'}${isExpired ? ' upgrade-expired' : ''}">
          <div class="upgrade-emoji">${def.emoji}</div>
          <div class="upgrade-info">
            <div class="upgrade-name">${def.name}</div>
            <div class="upgrade-effect">×${def.mult}（4週間）</div>
            <div class="upgrade-cost">${yen(def.cost)}</div>
          </div>
          <button class="buy-btn${canAfford ? '' : ' disabled'}" onclick="buyUpgrade('${def.id}')">${label}</button>
        </div>`;
      }
    });
  });

  if (!html) {
    html = '<div class="empty-msg">部署に社員を雇うと<br>アップグレードが解放されます 🔓</div>';
  }

  const badge = document.getElementById('upgrade-badge');
  badge.textContent = availableCount > 0 ? availableCount : '';
  badge.style.display = availableCount > 0 ? 'flex' : 'none';
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
    <div class="dept-island island-exec" style="margin-bottom:12px">
      <div class="island-hdr"><span class="island-icon">🏛️</span><span>役員室</span></div>
      <div style="padding:10px 12px 4px">
        <div class="labor-section-title" style="margin-bottom:6px">🤵 社長報酬設定</div>
        <div class="labor-ceo-current">現在: <strong>${yen(ceoSalary)}/月</strong>　次回月末経費に反映</div>
        <div class="salary-btn-group">${salaryBtns}</div>
      </div>
      ${EXEC_DEFS.map(e => _buildExecCard(e)).join('')}
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

      ${(() => {
      const hist = state.reportHistory || [];
      if (hist.length === 0) return '';
      const calcPL = entries => entries.reduce((a, r) => ({
        revenue: a.revenue + (r.deptIncome || 0) + (r.flGross || 0),
        flCost:  a.flCost  + (r.flCost    || 0),
        gross:   a.gross   + (r.deptIncome || 0) + (r.flIncome || 0),
        expense: a.expense + (r.monthlyExp ? r.monthlyExp.total : 0),
      }), { revenue: 0, flCost: 0, gross: 0, expense: 0 });
      const plRow = (label, d) => {
        const profit = d.gross - d.expense;
        const pc = profit >= 0 ? '#4ade80' : '#f87171';
        return `<div class="pl-row">
          <div class="pl-row-label">${label}</div>
          <div class="pl-row-vals">
            <span>売上 <b>${yen(d.revenue)}</b></span>
            <span style="color:#f87171">FL報酬 −${yen(d.flCost)}</span>
            <span style="color:#60a5fa">経費 −${yen(d.expense)}</span>
            <span style="color:${pc};font-weight:700">利益 ${profit>=0?'＋':''}${yen(profit)}</span>
          </div>
        </div>`;
      };
      const weekly  = calcPL(hist.slice(-1));
      const monthly = calcPL(hist.slice(-4));
      const yearly  = calcPL(hist.slice(-48));
      return `<div class="labor-section">
        <div class="labor-section-title">📊 損益計算書</div>
        ${plRow('週次', weekly)}
        ${plRow('月次', monthly)}
        ${plRow('年次', yearly)}
      </div>`;
    })()}

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

    <div class="labor-section">
      <div class="labor-section-title">🏦 銀行取引審査</div>
      ${state.bankUnlocked
        ? `<div style="color:#4ade80;font-size:13px;padding:4px 0">✅ 銀行取引口座 開設済み</div>`
        : `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px">直近4週間の利益率が20%以上の場合、銀行取引が解放されます。</div>
           <button class="hire-btn${(state.reportHistory||[]).length >= 4 ? '' : ' disabled'}" onclick="applyBankReview()">審査を申請する</button>`
      }
    </div>

    ${(() => {
      const exp = calcMonthlyExpenses();
      const rows = [
        exp.rent          > 0 ? `<div class="expense-row"><span>🏢 事務所家賃</span><span>−${yen(exp.rent)}</span></div>` : '',
        exp.utilities     > 0 ? `<div class="expense-row"><span>💡 水道光熱費</span><span>−${yen(exp.utilities)}</span></div>` : '',
        exp.supplies      > 0 ? `<div class="expense-row"><span>📦 備品・消耗品</span><span>−${yen(exp.supplies)}</span></div>` : '',
        exp.salesperson   > 0 ? `<div class="expense-row"><span>💼 SES営業（${state.employees['sales']||0}名）人件費＋社保</span><span>−${yen(exp.salesperson)}</span></div>` : '',
        exp.staffingSalary > 0 ? `<div class="expense-row"><span>🤝 紹介営業（${state.employees['staffing']||0}名）人件費＋社保</span><span>−${yen(exp.staffingSalary)}</span></div>` : '',
        exp.marketingSalary > 0 ? `<div class="expense-row"><span>📣 マーケター（${state.employees['marketing']||0}名）人件費＋社保</span><span>−${yen(exp.marketingSalary)}</span></div>` : '',
        exp.ceoSalary     > 0 ? `<div class="expense-row"><span>🤵 社長報酬</span><span>−${yen(exp.ceoSalary)}</span></div>` : '',
        exp.execSalary    > 0 ? `<div class="expense-row"><span>🤵 役員報酬</span><span>−${yen(exp.execSalary)}</span></div>` : '',
        exp.mgrSalary     > 0 ? `<div class="expense-row"><span>👔 部門マネージャー 人件費＋社保</span><span>−${yen(exp.mgrSalary)}</span></div>` : '',
        exp.financeSalary > 0 ? `<div class="expense-row"><span>📊 財務スタッフ（${state.employees['finance']||0}名）人件費＋社保</span><span>−${yen(exp.financeSalary)}</span></div>` : '',
        exp.investmentSalary > 0 ? `<div class="expense-row"><span>📉 資産運用スタッフ（${state.employees['investment']||0}名）人件費＋社保</span><span>−${yen(exp.investmentSalary)}</span></div>` : '',
        exp.dispatchSalary > 0 ? `<div class="expense-row"><span>🏭 派遣スタッフ（${state.dispatchCount||0}名）給与＋社保</span><span>−${yen(exp.dispatchSalary)}</span></div>` : '',
        exp.loanPay       > 0 ? `<div class="expense-row" style="color:#f87171"><span>🏦 ローン返済</span><span>−${yen(exp.loanPay)}</span></div>` : '',
      ].join('');
      return `
    <div class="labor-section">
      <div class="labor-section-title">📋 次回月次費用予測</div>
      <div class="expense-preview">
        ${rows || '<div class="expense-row" style="color:#94a3b8">費用なし</div>'}
        <div class="expense-row" style="font-weight:700;border-top:1px solid #334155;margin-top:4px;padding-top:6px">
          <span>合計</span><span style="color:#f87171">−${yen(exp.total)}</span>
        </div>
      </div>
    </div>`;
    })()}

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

// ---- 女性OLキャラ（Misaki）つぶやきシステム ----
let _olMutterText = '';
let _olMutterNextSwap = 0;

function _getOLMutterText() {
  const fl    = state.freelancers || 0;
  const money = state.money;
  const sales = state.employees['sales'] || 0;
  const m     = state.morale || { ceo:90, employee:90, freelance:90 };
  const mor   = Math.round((m.ceo + m.employee + m.freelance) / 3);
  const stage = getCurrentStageIdx();
  const weekly = getDisplayWeeklyIncome();

  if (!state.gameStarted) {
    const s = ['どんな事務所にしようかな…', '資本金1000万！頑張ります！', '早く始めたいな…✨'];
    return s[Math.floor(ocvTime * 0.1) % s.length];
  }

  const pool = [];
  if (money < 300000)         pool.push('やばい…お金が…💦', 'どうしよう…倒産しちゃう！', '早く収益が欲しい…');
  else if (money > 1e9)       pool.push(`${yen(money)}！すごい！`, '資金が豊富で安心です♪');

  if (mor < 30)               pool.push('みんな…疲れてる😰', '交流会を開かないと！', '空気が重いな…');
  else if (mor < 50)          pool.push('少し元気がないかな', 'モラール上げないと…');
  else if (mor > 88)          pool.push('最高の雰囲気！✨', 'みんないきいきしてる！', 'この調子！');

  if (fl === 0 && sales > 0)  pool.push('FLがまだいない…', 'エンジニアを確保して！', '採用が待ち遠しい');
  else if (fl > 30)           pool.push(`FL${fl}名！頼もしい✨`, 'チームが大きくなった！');
  else if (fl > 10)           pool.push(`FL${fl}名在籍中`, 'エンジニア陣に感謝！');

  if (stage >= 5)             pool.push('上場目前！夢みたい…！', 'ここまで来れるなんて！');
  else if (stage >= 3)        pool.push('大きな会社になったなぁ', '成長スピードがすごい！');

  if (state.executives?.exec_sales_dir) pool.push('役員さんが助かります！', '組織が整ってきた！');

  pool.push(
    `週次収益${yen(weekly)}`, '今日も頑張ります！', '受注を増やそう！',
    '経営って楽しい♪', `営業${sales}人で挑戦中！`, 'チームで頑張れる！',
  );
  return pool[Math.floor(ocvTime * 0.07 + pool.length * 0.3) % pool.length];
}

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
  const m     = state.morale || { ceo:90, employee:90, freelance:90 };
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
  // 女性OL Misaki（右端固定）
  const olX = OCV_W - 26, olFY = OCV_H - 2;
  if (ocvTime - _olMutterNextSwap > 4.5 + Math.random() * 2) {
    _olMutterText = _getOLMutterText();
    _olMutterNextSwap = ocvTime;
  }
  if (!_olMutterText) _olMutterText = _getOLMutterText();
  ocvOLBubble(ctx, olX, olFY, _olMutterText);
  ocvOL(ctx, olX, olFY);
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
    { label: '財務部', col: 0, row: 1, total: state.employees['finance'] || 0 },
    { label: '派遣', col: 1, row: 1, total: state.dispatchCount || 0 },
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

function ocvOL(ctx, cx, fy) {
  const t = ocvTime;
  const SKIN  = '#f0c8a0';
  const HAIR  = '#180808';
  const SUIT  = '#1e2d5c';
  const BLOUSE= '#f4f4ee';
  const LIP   = '#d04860';
  const BLUSH = 'rgba(240,100,100,0.26)';
  const SKHIGH= 'rgba(255,200,160,0.5)';

  const br = Math.sin(t * 1.1) * 0.55; // breathing

  // --- BODY ---
  const bW = 14, bH = 19;
  const bX = cx - bW / 2, bY = fy - bH + br;

  // Shadow under feet
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, fy + 1, 7, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs / skirt bottom
  ctx.fillStyle = '#13204a';
  ctx.fillRect(cx - 3.5, bY + bH - 4, 3, 6 - br * 0.3);
  ctx.fillRect(cx + 0.5, bY + bH - 4, 3, 6 - br * 0.3);
  // Shoes
  ctx.fillStyle = '#1a1010';
  ctx.beginPath();
  ctx.ellipse(cx - 2, fy + 1, 3.5, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 2, fy + 1, 3.5, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Jacket body
  ctx.fillStyle = SUIT;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(bX, bY, bW, bH - 3, [3, 3, 0, 0]);
  } else {
    ctx.rect(bX, bY, bW, bH - 3);
  }
  ctx.fill();

  // Jacket lapels (V shape in blouse)
  ctx.fillStyle = BLOUSE;
  ctx.beginPath();
  ctx.moveTo(cx - 2.5, bY + 0.5);
  ctx.lineTo(cx, bY + 6);
  ctx.lineTo(cx + 2.5, bY + 0.5);
  ctx.closePath();
  ctx.fill();

  // Skirt (slightly different shade)
  ctx.fillStyle = '#182050';
  ctx.fillRect(bX, bY + bH - 5, bW, 6);

  // Jacket seam lines
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx - 3, bY + 1); ctx.lineTo(cx - 6, bY + bH - 5);
  ctx.moveTo(cx + 3, bY + 1); ctx.lineTo(cx + 6, bY + bH - 5);
  ctx.stroke();

  // --- ARMS ---
  const aSwing = Math.sin(t * 2.0 + 0.7) * 1.3;
  ctx.fillStyle = SUIT;
  ctx.fillRect(bX - 3, bY + 2, 3.5, 10 + aSwing);
  ctx.fillRect(bX + bW - 0.5, bY + 2, 3.5, 10 - aSwing);
  // Cuffs (blouse visible)
  ctx.fillStyle = BLOUSE;
  ctx.fillRect(bX - 3, bY + 10 + aSwing, 3.5, 2);
  ctx.fillRect(bX + bW - 0.5, bY + 10 - aSwing, 3.5, 2);
  // Hands
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(bX - 1.5, bY + 13 + aSwing, 2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(bX + bW + 1.5, bY + 13 - aSwing, 2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- HEAD ---
  const hW = 12, hH = 14;
  const hCY = bY - hH * 0.42;

  // Hair back (long, below face)
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.ellipse(cx, hCY + 1, hW / 2 + 2, hH / 2 + 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Side hair strands (long)
  ctx.fillRect(cx - hW / 2 - 2.5, hCY - 1, 3, hH + 4);
  ctx.fillRect(cx + hW / 2 - 0.5, hCY - 1, 3, hH + 4);

  // Face skin
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.ellipse(cx, hCY + 1, hW / 2, hH / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Face highlight (subtle shading)
  ctx.fillStyle = SKHIGH;
  ctx.beginPath();
  ctx.ellipse(cx - 1.5, hCY - 1, hW / 2 * 0.55, hH / 2 * 0.5, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Hair top and bangs
  ctx.fillStyle = HAIR;
  // Top hair dome
  ctx.beginPath();
  ctx.ellipse(cx, hCY - hH * 0.3, hW / 2 + 1, hH / 2 * 0.65, 0, Math.PI, 0, false);
  ctx.fill();
  // Bangs (前髪) — left side
  ctx.beginPath();
  ctx.moveTo(cx - hW / 2 - 0.5, hCY - hH * 0.38);
  ctx.bezierCurveTo(cx - hW / 2 + 1, hCY - hH * 0.1, cx - 3, hCY + 0.5, cx - 1, hCY - hH * 0.25);
  ctx.bezierCurveTo(cx - hW / 2, hCY - hH * 0.38, cx - hW / 2 - 0.5, hCY - hH * 0.38, cx - hW / 2 - 0.5, hCY - hH * 0.38);
  ctx.fill();
  // Bangs right side
  ctx.beginPath();
  ctx.moveTo(cx + hW / 2 + 0.5, hCY - hH * 0.38);
  ctx.bezierCurveTo(cx + hW / 2 - 1, hCY - hH * 0.1, cx + 3, hCY + 0.5, cx + 1, hCY - hH * 0.25);
  ctx.bezierCurveTo(cx + hW / 2, hCY - hH * 0.38, cx + hW / 2 + 0.5, hCY - hH * 0.38, cx + hW / 2 + 0.5, hCY - hH * 0.38);
  ctx.fill();
  // Center part highlight
  ctx.fillStyle = 'rgba(80,20,20,0.5)';
  ctx.beginPath();
  ctx.ellipse(cx, hCY - hH * 0.42, 2, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- EYES ---
  const blink = Math.sin(t * 0.28 + 2.3) > 0.92;
  const eyeY  = hCY - 0.5;
  const eLX   = cx - hW * 0.22;
  const eRX   = cx + hW * 0.22;
  const mor   = Math.round(((state.morale?.ceo || 90) + (state.morale?.employee || 90) + (state.morale?.freelance || 90)) / 3);

  if (!blink) {
    // Eye whites
    ctx.fillStyle = '#fafaff';
    ctx.beginPath(); ctx.ellipse(eLX, eyeY, 2.4, 2.0, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(eRX, eyeY, 2.4, 2.0, 0, 0, Math.PI * 2); ctx.fill();
    // Pupils
    ctx.fillStyle = '#14060c';
    ctx.beginPath(); ctx.ellipse(eLX, eyeY + 0.3, 1.6, 1.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(eRX, eyeY + 0.3, 1.6, 1.85, 0, 0, Math.PI * 2); ctx.fill();
    // Iris color (warm brown)
    ctx.fillStyle = 'rgba(110,55,15,0.65)';
    ctx.beginPath(); ctx.ellipse(eLX, eyeY + 0.35, 1.05, 1.15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(eRX, eyeY + 0.35, 1.05, 1.15, 0, 0, Math.PI * 2); ctx.fill();
    // Shine (large + small)
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(eLX - 0.5, eyeY - 1.0, 1.2, 1.2);
    ctx.fillRect(eRX - 0.5, eyeY - 1.0, 1.2, 1.2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(eLX + 0.7, eyeY + 0.3, 0.7, 0.7);
    ctx.fillRect(eRX + 0.7, eyeY + 0.3, 0.7, 0.7);
    // Upper eyelash curve
    ctx.strokeStyle = '#14060c'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(eLX, eyeY, 2.4, Math.PI * 1.05, Math.PI * 1.95, false); ctx.stroke();
    ctx.beginPath(); ctx.arc(eRX, eyeY, 2.4, Math.PI * 1.05, Math.PI * 1.95, false); ctx.stroke();
    // Lower lash (subtle)
    ctx.strokeStyle = 'rgba(40,10,20,0.4)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.arc(eLX, eyeY, 2.0, 0, Math.PI, false); ctx.stroke();
    ctx.beginPath(); ctx.arc(eRX, eyeY, 2.0, 0, Math.PI, false); ctx.stroke();
  } else {
    // Closed eyes (happy-close arc)
    ctx.strokeStyle = '#14060c'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(eLX, eyeY + 0.8, 2.2, Math.PI * 1.05, Math.PI * 1.95, false); ctx.stroke();
    ctx.beginPath(); ctx.arc(eRX, eyeY + 0.8, 2.2, Math.PI * 1.05, Math.PI * 1.95, false); ctx.stroke();
    // Small lash tips
    ctx.strokeStyle = '#14060c'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(eLX - 2.5, eyeY - 0.5); ctx.lineTo(eLX - 3.5, eyeY - 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eRX + 2.5, eyeY - 0.5); ctx.lineTo(eRX + 3.5, eyeY - 1.5); ctx.stroke();
  }

  // Eyebrows (soft natural arch)
  ctx.strokeStyle = '#2a0c10'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(eLX - 3.0, eyeY - 3.8);
  ctx.quadraticCurveTo(eLX - 0.3, eyeY - 5.0, eLX + 3.0, eyeY - 3.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(eRX - 3.0, eyeY - 3.5);
  ctx.quadraticCurveTo(eRX + 0.3, eyeY - 5.0, eRX + 3.0, eyeY - 3.8);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Nose (tiny, two nostril hints)
  ctx.fillStyle = 'rgba(185,95,75,0.32)';
  ctx.beginPath(); ctx.ellipse(cx - 1.1, eyeY + 4.8, 0.8, 0.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx + 1.1, eyeY + 4.8, 0.8, 0.5, 0, 0, Math.PI * 2); ctx.fill();

  // Mouth
  const mY3 = eyeY + 8.0;
  ctx.strokeStyle = LIP; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  ctx.beginPath();
  if (mor > 70) {
    ctx.arc(cx, mY3 - 0.8, 2.4, 0.1, Math.PI - 0.1, false);
  } else if (mor < 40) {
    ctx.arc(cx, mY3 + 1.2, 2.2, Math.PI + 0.2, -0.2, false);
  } else {
    ctx.arc(cx, mY3 - 0.2, 1.9, 0.15, Math.PI - 0.15, false);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  // Lower lip fill
  ctx.fillStyle = LIP;
  ctx.beginPath();
  ctx.ellipse(cx, mY3 + (mor > 70 ? 0.6 : 0.9), 1.7, 0.65, 0, 0, Math.PI * 2);
  ctx.fill();

  // Blush (soft circles on cheeks)
  ctx.fillStyle = BLUSH;
  ctx.beginPath(); ctx.ellipse(eLX - 0.8, eyeY + 3.8, 3.4, 1.6, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(eRX + 0.8, eyeY + 3.8, 3.4, 1.6, -0.1, 0, Math.PI * 2); ctx.fill();
}

function ocvOLBubble(ctx, cx, fy, text) {
  if (!text) return;
  ctx.save();
  ctx.font = 'bold 6.5px sans-serif';
  const tw = ctx.measureText(text).width;
  const pad = 4, bh = 12;
  const bw = tw + pad * 2;
  const bx = Math.max(2, cx - bw - 6);
  const by = fy - 54;

  // Bubble shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx + 1, by + 1, bw, bh, 4); ctx.fill(); }

  // Bubble body
  ctx.fillStyle = 'rgba(255,252,255,0.95)';
  ctx.strokeStyle = 'rgba(200,80,120,0.55)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(bx, by, bw, bh, 4); } else { ctx.rect(bx, by, bw, bh); }
  ctx.fill(); ctx.stroke();

  // Tail (pointing to character mouth area)
  ctx.fillStyle = 'rgba(255,252,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(bx + bw - 5, by + bh);
  ctx.lineTo(bx + bw + 2, by + bh + 5);
  ctx.lineTo(bx + bw - 10, by + bh);
  ctx.closePath();
  ctx.fill();
  // Tail border (left edge only)
  ctx.strokeStyle = 'rgba(200,80,120,0.3)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(bx + bw - 10, by + bh);
  ctx.lineTo(bx + bw + 2, by + bh + 5);
  ctx.stroke();

  // Text
  ctx.fillStyle = '#200818';
  ctx.textAlign = 'left';
  ctx.fillText(text, bx + pad, by + bh - 3);
  ctx.restore();
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
  const m = state.morale || { ceo:90, employee:90, freelance:90 };
  const mor = Math.round((m.ceo + m.employee + m.freelance) / 3);

  const statsEl = document.getElementById('hero-stats');
  if (statsEl) {
    const fl            = state.freelancers || 0;
    const activeFL      = getFlActiveCount();
    const salesCount    = state.employees['sales'] || 0;
    const staffingCount = state.employees['staffing'] || 0;
    const dispatchCount = state.dispatchCount || 0;
    const contractCount = (state.contractDev || []).length;
    const _p               = getGameTime().period;
    const staffingUnlocked = _p >= 2 || staffingCount > 0 || state.staffingOpened === true;
    const dispatchUnlocked = state.dispatchOpened === true || dispatchCount > 0;
    const morClass = mor >= 80 ? 'green' : mor >= 55 ? 'amber' : 'red';

    let rows = `<div class="hs-row">
      <span class="hs-dept">💼 SES</span>
      <span class="hs-kpi">FL <b>${fl}</b>名${activeFL !== fl ? `<span style="font-size:9px;color:#60a5fa">稼働${activeFL}</span>` : ''}</span>
      <span class="hs-kpi">営業 <b>${salesCount}</b>名</span>
      <span class="hs-kpi ${morClass}">士気 <b>${mor}</b></span>
    </div>`;
    if (staffingUnlocked) {
      rows += `<div class="hs-row">
        <span class="hs-dept">🤝 紹介</span>
        <span class="hs-kpi">スタッフ <b>${staffingCount}</b>名</span>
        <span class="hs-kpi">今期 <b>${state.periodStaffingPlacements || 0}</b>件</span>
      </div>`;
    }
    if (dispatchUnlocked) {
      rows += `<div class="hs-row">
        <span class="hs-dept">🏭 派遣</span>
        <span class="hs-kpi">スタッフ <b>${dispatchCount}</b>名</span>
        ${contractCount > 0 ? `<span class="hs-kpi">案件 <b>${contractCount}</b>件</span>` : ''}
      </div>`;
    }
    statsEl.innerHTML = rows;
  }

  const descEl = document.getElementById('office-desc');
  if (!descEl) return;
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
  if (state.isPaused) {
    state.isPaused = false;
    const pb = document.getElementById('pause-btn');
    if (pb) { pb.textContent = '⏸'; pb.classList.remove('paused'); }
  }
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.speed) === s);
  });
}

function togglePause() {
  state.isPaused = !state.isPaused;
  const btn = document.getElementById('pause-btn');
  if (btn) {
    btn.textContent = state.isPaused ? '▶' : '⏸';
    btn.classList.toggle('paused', state.isPaused);
  }
}

function isGamePaused() {
  if (state.isPaused) return true;
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
        // 法人税: FL粗利を収益、FL報酬を費用として個別計上
        state.periodEarned     = (state.periodEarned || 0) + flWeeklyGross;
        state.periodDeductible = (state.periodDeductible || 0) + flWeeklyCost;
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
          // 損金積算（家賃・全給与・社長報酬）
          state.periodDeductible = (state.periodDeductible || 0)
            + (monthlyExp.rent || 0) + (monthlyExp.utilities || 0) + (monthlyExp.supplies || 0)
            + (monthlyExp.salesperson || 0) + (monthlyExp.staffingSalary || 0) + (monthlyExp.marketingSalary || 0)
            + (monthlyExp.ceoSalary || 0) + (monthlyExp.execSalary || 0)
            + (monthlyExp.financeSalary || 0) + (monthlyExp.investmentSalary || 0);
        }
      }

      // 週次イベント（毎週100%発生・週次モーダル内で即時適用）
      pendingWeeklyEvent = pickWeeklyEvent();

      // 強化期限チェック
      recalcMults();

      const weeklyLog = [];

      // モラル低下（毎週2減・社長低下は社員・FLを追加加速）
      const ceoMorBefore = state.morale.ceo || 90;
      const empMorBefore = state.morale.employee || 90;
      const flMorBefore  = state.morale.freelance || 90;
      const baseDecay    = 1;
      const extraDecay   = Math.max(0, Math.floor((90 - ceoMorBefore) / 15));
      state.morale.ceo      = Math.max(10, ceoMorBefore - baseDecay);
      state.morale.employee = Math.max(10, empMorBefore - baseDecay - extraDecay);
      state.morale.freelance= Math.max(10, flMorBefore  - baseDecay - extraDecay);
      {
        const dc = state.morale.ceo - ceoMorBefore;
        const de = state.morale.employee - empMorBefore;
        const df = state.morale.freelance - flMorBefore;
        const warn = extraDecay > 0 ? '⚠️' : '📊';
        weeklyLog.push({ emoji: warn, text: `モラール　社長 ${state.morale.ceo}（${dc}）　社員 ${state.morale.employee}（${de}）　FL ${state.morale.freelance}（${df}）`, bad: extraDecay > 0 });
      }

      // FL採用
      const salesCount    = state.employees['sales'] || 0;
      const recruitChance = getRecruitChance();
      const flCap         = salesCount * 15;
      const hiredWeek = currentWeekNum;
      let newFL = 0;
      for (let i = 0; i < salesCount; i++) {
        if (state.flData.length >= flCap) break;
        if (Math.random() < recruitChance) {
          state.flData.push({ gross: 600000 + Math.floor(Math.random() * 400001), profitRate: 0.10 + Math.random() * 0.10, hiredWeek });
          state.freelancers = state.flData.length;
          newFL++;
        }
      }
      const sesSsnLabel = getSESSeasonalLabel();
      if (newFL > 0) {
        weeklyLog.push({ emoji: '👨‍💻', text: `FL ${newFL}名を採用（在籍 ${state.freelancers}名）${sesSsnLabel ? ' ' + sesSsnLabel : ''}` });
      } else if (salesCount > 0 && state.flData.length >= flCap) {
        weeklyLog.push({ emoji: '📋', text: `FL上限に達しているため採用なし（上限 ${flCap}名）` });
      } else if (salesCount > 0) {
        weeklyLog.push({ emoji: '📋', text: `FL採用なし（採用確率 ${(recruitChance * 100).toFixed(0)}%）${sesSsnLabel ? ' ' + sesSsnLabel : ''}` });
      }

      // FL 自動離脱チェック（各FLに個別確率判定）
      let lostFL = 0;
      if (state.flData.length > 0) {
        const flFavor    = state.morale.freelance || 90;
        const empMor     = state.morale.employee  || 90;
        const empPenalty = Math.max(0, (90 - empMor) * 0.001);
        const mgrQuitR   = (state.managers?.mgr_ses || 0) * 0.005;
        const quitRate   = Math.min(0.55, Math.max(0, 0.03 + (100 - flFavor) * 0.002 + empPenalty - mgrQuitR));
        for (let i = state.flData.length - 1; i >= 0; i--) {
          if (Math.random() < quitRate) {
            state.flData.splice(i, 1);
            lostFL++;
          }
        }
        state.freelancers = state.flData.length;
        if (lostFL > 0) {
          weeklyLog.push({ emoji: '😞', text: `FL ${lostFL}名が離脱（在籍 ${state.freelancers}名・離脱率 ${(quitRate * 100).toFixed(1)}%）`, bad: true });
        }
      }

      // 営業部役員 自動処理
      if (state.executives?.exec_sales_dir) {
        const eSettings = state.execSettings?.exec_sales_dir || {};
        // モラール自動最適化（交流アクションを週最大2回自動購入）
        if (eSettings.autoMorale !== false) {
          const budget = state.money * 0.3;
          const candidates = EXCHANGE_ACTIONS
            .filter(a => {
              const c = a.cost();
              return c <= budget && c <= state.money && a.targets.some(t => (state.morale[t] || 90) < 100);
            })
            .map(a => {
              const deficit = a.targets.reduce((s, t) => s + Math.max(0, 100 - (state.morale[t] || 90)), 0);
              return { action: a, score: deficit * a.gain / a.cost() };
            })
            .sort((x, y) => y.score - x.score);
          let bought = 0;
          for (const { action } of candidates) {
            if (bought >= 2) break;
            const c = action.cost();
            if (state.money >= c) {
              state.money -= c;
              action.targets.forEach(t => { state.morale[t] = Math.min(100, (state.morale[t] || 90) + action.gain); });
              weeklyLog.push({ emoji: '🤵', text: `営業部役員が「${action.name}」を自動購入（${yen(c)}）` });
              bought++;
            }
          }
        }
        // 営業人数自動最適化（定員の40%を目標）
        if (eSettings.autoSales !== false) {
          const cap = getCurrentCapacity();
          const targetSales = Math.max(1, Math.floor(cap * 0.40));
          const curSales = state.employees['sales'] || 0;
          if (curSales < targetSales && getEmployeeCount() < cap) {
            const hireCost = getHireCost('sales');
            if (state.money >= hireCost * 3) {
              state.money -= hireCost;
              state.employees['sales'] = curSales + 1;
              state.deptCost['sales'] = (state.deptCost['sales'] || 0) + hireCost;
              weeklyLog.push({ emoji: '👔', text: `営業部役員が営業1名を自動採用（計${state.employees['sales']}名）` });
            }
          }
        }
        // 強化自動購入（安い順に週1件・所持金の50%以上残す）
        if (eSettings.autoUpgrade !== false) {
          const available = UPGRADE_DEFS.filter(def => {
            if (state.upgrades?.[def.id]) return false;
            return Object.entries(def.req || {}).every(([k, v]) => (state.employees?.[k] || 0) >= v);
          }).sort((a, b) => a.cost - b.cost);
          if (available.length > 0) {
            const upg = available[0];
            if (state.money >= upg.cost * 2) {
              state.money -= upg.cost;
              const currentWeek2 = Math.floor(state.elapsedSeconds / WEEK_SEC);
              state.upgrades[upg.id] = { week: currentWeek2 };
              state.deptCost[upg.dept] = (state.deptCost[upg.dept] || 0) + upg.cost;
              recalcMults();
              weeklyLog.push({ emoji: '⬆️', text: `営業部役員が「${upg.name}」を自動購入（${yen(upg.cost)}）` });
            }
          }
        }
      }

      // 紹介事業部 週次成約処理
      const staffingSalesCount = state.employees['staffing'] || 0;
      let weeklyStaffingCount = 0;
      let weeklyStaffingFees  = 0;
      if (staffingSalesCount > 0) {
        const findRate = getStaffingFindRate();
        for (let i = 0; i < staffingSalesCount; i++) {
          if (Math.random() < findRate) {
            const salaryRand   = Math.pow(Math.random(), 1.5);
            const annualSalary = 3000000 + Math.floor(salaryRand * 7000001);
            const diffRatio      = (annualSalary - 3000000) / 7000000;
            const placementRate  = 0.85 - diffRatio * 0.65;
            if (Math.random() < placementRate) {
              const feeRate = Math.min(0.50, 0.35 + getMarketingStaffingFeeBonus());
              const fee = Math.floor(annualSalary * feeRate);
              state.money       += fee;
              state.totalEarned += fee;
              state.periodEarned     = (state.periodEarned || 0) + fee;
              state.weeklyIncomeAccum = (state.weeklyIncomeAccum || 0) + fee;
              state.deptRevenue['staffing'] = (state.deptRevenue['staffing'] || 0) + fee;
              weeklyStaffingCount++;
              weeklyStaffingFees += fee;
              state.periodStaffingPlacements = (state.periodStaffingPlacements || 0) + 1;
            }
          }
        }
        const stfSsnLabel = getStaffingSeasonalLabel();
        if (weeklyStaffingCount > 0) {
          weeklyLog.push({ emoji: '🤝', text: `人材紹介 ${weeklyStaffingCount}件成約　＋${yen(weeklyStaffingFees)}${stfSsnLabel ? ' ' + stfSsnLabel : ''}` });
        } else {
          weeklyLog.push({ emoji: '🤝', text: `人材紹介 成約なし（発掘率 ${(findRate * 100).toFixed(0)}%）${stfSsnLabel ? ' ' + stfSsnLabel : ''}` });
        }
      }

      // 派遣事業部 週次処理
      let weeklyDispatchGross = 0;

      // 受託開発 完了チェック（配列を後ろから削除）
      {
        const completedIdx = [];
        (state.contractDev || []).forEach((c, i) => {
          const weeksElapsed = currentWeekNum - c.startWeek;
          if (weeksElapsed >= c.durationWeeks) {
            const months = c.durationWeeks / 4;
            const lump   = Math.round(DISPATCH_MONTHLY_SALARY * CONTRACT_WORKERS * c.mult * months);
            state.money       += lump;
            state.totalEarned += lump;
            state.periodEarned = (state.periodEarned || 0) + lump;
            state.deptRevenue['dispatch'] = (state.deptRevenue['dispatch'] || 0) + lump;
            weeklyDispatchGross += lump;
            const label = c.type === 'large' ? '大型' : '小型';
            weeklyLog.push({ emoji: '🎉', text: `${label}受託完了！${c.durationWeeks}週 売上 ${yen(lump)} 一括計上` });
            completedIdx.push(i);
          }
        });
        if (completedIdx.length > 0) {
          state.contractDev = state.contractDev.filter((_, i) => !completedIdx.includes(i));
          renderDepts();
        }
      }

      // 派遣スタッフ通常収益 & 離脱チェック
      const dispatchCountNow = state.dispatchCount || 0;
      if (dispatchCountNow > 0) {
        const contractLocked = Math.min((state.contractDev?.length || 0) * CONTRACT_WORKERS, dispatchCountNow);
        const freeWorkers    = dispatchCountNow - contractLocked;
        // 離脱はフリースタッフのみ
        if (freeWorkers > 0) {
          let dispatchQuit = 0;
          for (let i = 0; i < freeWorkers; i++) {
            if (Math.random() < DISPATCH_QUIT_RATE) dispatchQuit++;
          }
          if (dispatchQuit > 0) {
            state.dispatchCount = Math.max(contractLocked, dispatchCountNow - dispatchQuit);
            weeklyLog.push({ emoji: '😞', text: `派遣スタッフ${dispatchQuit}名が離脱（残${state.dispatchCount}名）`, bad: true });
          }
        }
        // 通常収益（フリースタッフのみ）
        const normalWorkers = Math.max(0, (state.dispatchCount || 0) - contractLocked);
        if (normalWorkers > 0) {
          const normalGross = normalWorkers * DISPATCH_WEEKLY_GROSS;
          state.money       += normalGross;
          state.totalEarned += normalGross;
          state.periodEarned = (state.periodEarned || 0) + normalGross;
          state.deptRevenue['dispatch'] = (state.deptRevenue['dispatch'] || 0) + normalGross;
          weeklyDispatchGross += normalGross;
          weeklyLog.push({ emoji: '🏭', text: `派遣${normalWorkers}名　請求${yen(normalGross)}（給与は月次精算）` });
        }
      }

      // 株価更新（毎週）
      if (state.stocks) {
        STOCK_DEFS.forEach(def => {
          const s = state.stocks[def.id];
          if (!s) return;
          const change = (Math.random() * 2 - 1) * def.volatility + def.trendBias;
          s.price = Math.max(100, Math.round(s.price * (1 + change)));
          if (!s.history) s.history = [];
          s.history.push(s.price);
          if (s.history.length > 24) s.history.shift();
        });
      }

      // 週次サマリーモーダル表示
      showWeeklyModal(currentWeekNum, state.weeklyIncomeAccum || 0, flWeeklyIncome, flWeeklyGross, flWeeklyCost, monthlyExp, beforeMoney, weeklyStaffingCount, weeklyStaffingFees, weeklyDispatchGross, weeklyLog);
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
    if (bgmCtx) bgmSetStage(Math.min(getCurrentStageIdx(), BGM_DEF.length - 1));
  }

  requestAnimationFrame(gameLoop);
}

setInterval(save, 5000);

// ==================== BGM ====================
// フェーズ別のスケール・メロディ・パッドを定義
const BGM_DEF = [
  // 0: 個人事業 - のんびりポップ (C major pentatonic, 88bpm)
  { bpm:88,  root:261.63, scale:[0,2,4,7,9,12],     mel:[0,2,4,2,3,4,2,0,2,4,3,2,4,2,0,2],   pad:[-12,0,4,7],    baseSt:-24, melVol:0.10, padVol:0.05, bassVol:0.08, melW:'triangle', padW:'sine'     },
  // 1: 零細SES - はじまりのポップ (G major, 100bpm)
  { bpm:100, root:392.00, scale:[0,2,4,5,7,9,11],   mel:[0,2,4,5,4,2,4,7,5,4,2,5,4,2,3,4],   pad:[-12,0,4,7],    baseSt:-24, melVol:0.10, padVol:0.06, bassVol:0.09, melW:'triangle', padW:'sine'     },
  // 2: 中小SES - 軽快アップテンポ (F major, 112bpm)
  { bpm:112, root:349.23, scale:[0,2,4,5,7,9,11],   mel:[0,4,5,4,2,4,7,5,4,5,4,2,3,4,5,4],   pad:[-12,0,4,7],    baseSt:-24, melVol:0.11, padVol:0.06, bassVol:0.10, melW:'triangle', padW:'sine'     },
  // 3: 成長SES - ハッピードライブ (D major, 120bpm)
  { bpm:120, root:293.66, scale:[0,2,4,5,7,9,11,12], mel:[0,4,7,5,4,2,4,5,7,9,7,5,4,5,4,2],  pad:[-12,0,4,7,11], baseSt:-24, melVol:0.12, padVol:0.06, bassVol:0.11, melW:'triangle', padW:'triangle' },
  // 4: 大手SES - ポップファンク (A major, 126bpm)
  { bpm:126, root:440.00, scale:[0,2,4,5,7,9,11,12], mel:[0,4,5,7,5,4,2,4,7,9,7,5,4,5,7,4],  pad:[-12,0,4,7,11], baseSt:-24, melVol:0.12, padVol:0.07, bassVol:0.11, melW:'triangle', padW:'triangle' },
  // 5: 上場準備中 - わくわくポップ (E major, 118bpm)
  { bpm:118, root:329.63, scale:[0,2,4,5,7,9,11,12], mel:[0,4,7,5,7,9,7,5,4,5,7,4,2,4,5,7],  pad:[-12,0,4,7,11], baseSt:-24, melVol:0.13, padVol:0.07, bassVol:0.12, melW:'triangle', padW:'sine'     },
  // 6: 上場直前 - お祭りポップ (C major, 138bpm)
  { bpm:138, root:261.63, scale:[0,2,4,5,7,9,11,12,14],mel:[0,4,7,9,7,5,4,7,9,12,9,7,5,7,9,7],pad:[-12,0,4,7,12],baseSt:-24,melVol:0.13,padVol:0.08,bassVol:0.12,melW:'triangle',padW:'triangle'},
];

let bgmCtx      = null;
let bgmGain     = null;
let bgmMuted    = false;
let bgmCurStage = -1;
let bgmBeat     = 0;
let bgmNextTime = 0;
let bgmTimer    = null;
let bgmPadNodes = [];

function _bgmFreq(root, semitones) {
  return root * Math.pow(2, semitones / 12);
}

function _bgmNote(freq, vol, wave, t0, dur) {
  if (!bgmCtx) return;
  const osc = bgmCtx.createOscillator();
  const g   = bgmCtx.createGain();
  osc.type  = wave;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.025, dur * 0.15));
  g.gain.setValueAtTime(vol * 0.7, t0 + dur * 0.65);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g);
  g.connect(bgmGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function _bgmStopPad() {
  if (!bgmCtx) return;
  const t = bgmCtx.currentTime;
  bgmPadNodes.forEach(({ osc, g }) => {
    try { g.gain.linearRampToValueAtTime(0, t + 1.5); osc.stop(t + 1.6); } catch(e) {}
  });
  bgmPadNodes = [];
}

function _bgmStartPad(def) {
  if (!bgmCtx) return;
  const t       = bgmCtx.currentTime + 0.4;
  const padRoot = def.root / 2;
  def.pad.forEach((st, i) => {
    const freq = _bgmFreq(padRoot, st);
    const osc  = bgmCtx.createOscillator();
    const filt = bgmCtx.createBiquadFilter();
    const g    = bgmCtx.createGain();
    osc.type   = def.padW;
    osc.frequency.setValueAtTime(freq, t);
    filt.type  = 'lowpass';
    filt.frequency.value = 700;
    filt.Q.value = 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(def.padVol * Math.pow(0.7, i), t + 2.2);
    osc.connect(filt); filt.connect(g); g.connect(bgmGain);
    osc.start(t);
    bgmPadNodes.push({ osc, g });
  });
}

function _bgmSchedule() {
  if (!bgmCtx || state.bankrupt) return;
  const def  = BGM_DEF[Math.max(0, Math.min(bgmCurStage, BGM_DEF.length - 1))];
  const spb  = 60 / def.bpm;
  while (bgmNextTime < bgmCtx.currentTime + 0.12) {
    const si    = def.mel[bgmBeat % def.mel.length] % def.scale.length;
    const mFreq = _bgmFreq(def.root, def.scale[si]);
    _bgmNote(mFreq, def.melVol, def.melW, bgmNextTime, spb * 0.78);
    if (bgmBeat % 4 === 0 || bgmBeat % 4 === 2) {
      _bgmNote(_bgmFreq(def.root, def.baseSt), def.bassVol, 'sine', bgmNextTime, spb * 1.4);
    }
    bgmNextTime += spb;
    bgmBeat++;
  }
  bgmTimer = setTimeout(_bgmSchedule, 50);
}

function bgmSetStage(idx) {
  if (!bgmCtx) return;
  idx = Math.max(0, Math.min(idx, BGM_DEF.length - 1));
  if (idx === bgmCurStage) return;
  bgmCurStage = idx;
  _bgmStopPad();
  clearTimeout(bgmTimer);
  bgmBeat = 0;
  bgmNextTime = bgmCtx.currentTime + 0.6;
  _bgmStartPad(BGM_DEF[idx]);
  _bgmSchedule();
}

function bgmStart() {
  if (bgmCtx) { bgmCtx.resume(); return; }
  bgmCtx  = new (window.AudioContext || window.webkitAudioContext)();
  const comp = bgmCtx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 6;
  comp.connect(bgmCtx.destination);
  bgmGain = bgmCtx.createGain();
  bgmGain.gain.setValueAtTime(bgmMuted ? 0 : 1.0, bgmCtx.currentTime);
  bgmGain.connect(comp);
  bgmNextTime = bgmCtx.currentTime + 0.5;
  bgmSetStage(Math.min(getCurrentStageIdx(), BGM_DEF.length - 1));
}

function bgmToggle() {
  bgmMuted = !bgmMuted;
  state.bgmMuted = bgmMuted;
  if (bgmGain && bgmCtx) {
    bgmGain.gain.linearRampToValueAtTime(bgmMuted ? 0 : 1.0, bgmCtx.currentTime + 0.3);
  }
  const btn = document.getElementById('bgm-btn');
  if (btn) btn.textContent = bgmMuted ? '🔇' : '🔊';
}

window.addEventListener('DOMContentLoaded', () => {
  load();
  setGameSpeed(state.gameSpeed || 1);
  if (state.isPaused) {
    const pb = document.getElementById('pause-btn');
    if (pb) { pb.textContent = '▶'; pb.classList.add('paused'); }
  }
  renderAll();
  initOCV();
  syncNavTop();
  requestAnimationFrame(gameLoop);
  // 最初のユーザー操作でBGM開始（ブラウザのAutoPlay制限対応）
  const startBgm = () => bgmStart();
  document.addEventListener('click',      startBgm, { once: true });
  document.addEventListener('touchstart', startBgm, { once: true });
});
window.addEventListener('resize', syncNavTop);
