const REGISTRY_KEY = 'driver-agent.pwa.registry.v7';
const MESSAGES_KEY = 'driver-agent.pwa.messages.v2';
const FLOW_KEY = 'driver-agent.pwa.flow.v2';
const SESSION_HISTORY_KEY = 'driver-agent.pwa.session-history.v1';
const INDICATOR_REGISTRY_KEY = 'driver-agent.pwa.indicators.v1';
const LLM_MODEL = 'openrouter/free';
const LLM_API_URL = 'https://driver-agent-api.plombastik.workers.dev';
const AUTH_TOKEN_KEY = 'driver-agent.auth.token.v1';
const AUTH_EXPIRES_KEY = 'driver-agent.auth.expires.v1';
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';

function authHeaders(extra={}){
  return {...extra, ...(authToken ? {Authorization:`Bearer ${authToken}`} : {})};
}
function clearAuth(){
  authToken='';
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_EXPIRES_KEY);
}
function authStillValid(){
  const exp=Number(localStorage.getItem(AUTH_EXPIRES_KEY)||0);
  return Boolean(authToken && exp && Date.now()<exp);
}
function showAuthGate(message=''){
  document.body.classList.add('auth-pending');
  const gate=document.getElementById('authGate'); if(gate) gate.hidden=false;
  const err=document.getElementById('authError'); if(err){err.textContent=message;err.hidden=!message;}
  setTimeout(()=>document.getElementById('appPassword')?.focus(),80);
}
function hideAuthGate(){
  document.getElementById('authGate')?.setAttribute('hidden','');
  document.body.classList.remove('auth-pending');
}
function requireLogin(message='Сессия истекла. Введите пароль снова.') { clearAuth(); showAuthGate(message); }
async function loginWithPassword(password){
  const response=await fetch(`${LLM_API_URL}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok || !payload.token) throw new Error(payload?.error || 'Не удалось войти');
  authToken=payload.token;
  localStorage.setItem(AUTH_TOKEN_KEY,payload.token);
  localStorage.setItem(AUTH_EXPIRES_KEY,String(payload.expiresAt||0));
}


const INDICATOR_META = {
  'Количество выдач': 'шт.',
  'Объём выдач': '₽',
  'Количество клиентов': 'шт.',
  'Объём сборов': '₽',
  'Количество продаж': 'шт.',
  'Количество бонусов': 'шт.',
  'Доля рынка': '%',
  'Уровень проникновения': '%'
};
let indicatorRegistry = load(INDICATOR_REGISTRY_KEY, Object.entries(INDICATOR_META).map(([name,unit])=>({name,unit,status:'Активен'})));
// Удаляем тестовые записи из старых локальных данных и восстанавливаем базовые активные показатели.
indicatorRegistry = indicatorRegistry.filter(x => normalizeText(x.name) !== normalizeText('Сокращение пробега'));
for (const [name,unit] of Object.entries(INDICATOR_META)) if(!indicatorRegistry.some(x=>normalizeText(x.name)===normalizeText(name))) indicatorRegistry.push({name,unit,status:'Активен'});
function indicatorNames(){ return indicatorRegistry.map(x=>x.name); }
function indicatorRecord(name){ const c=canonicalFromList(name, indicatorNames()); return c ? indicatorRegistry.find(x=>x.name===c) : null; }
const PRODUCTS = ['Ипотечное кредитование','Потребительский кредит','Автокредит','Образовательный кредит','Дебетовые карты','Кредитные карты','Платежи','Переводы','ОСАГО','КАСКО','Накопительные счета','Срочные счета'];
const PL_ARTICLES = ['Чистый процентный доход','Расходы на резервы','Чистый комиссионный доход','Операционные доходы','Прочие доходы','Прочие расходы'];

const seedDrivers = [
  {
    id:'demo-credit-volume-mortgage', name:'Объём выдач Ипотечное кредитование', indicator:'Объём выдач', product:'Ипотечное кредитование',
    unit:'₽', effectType:'Доходы', base:'1000000', channel:'', segment:'', incrementMode:'annual_spread', calcMethod:'model', modelId:'credit_income_v2',
    modelParams:{margin:'12',risk:'2.4',repayment:'2',creditTermYears:'15',horizon:36,sources:{margin:'Прогнозная модель',risk:'Прогнозная модель',repayment:'Прогнозная модель',creditTermYears:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'},
    costMode:'monthly', costProfile:[], plAllocations:[], costLogicText:'', businessRationale:'', status:'Готов'
  },
  {
    id:'demo-credit-count-consumer', name:'Количество выдач Потребительский кредит Онлайн Массовый', indicator:'Количество выдач', product:'Потребительский кредит',
    unit:'шт.', effectType:'Доходы', base:'1', channel:'Онлайн', segment:'Массовый', incrementMode:'annual_spread', calcMethod:'model', modelId:'credit_income_v2',
    modelParams:{avgCheck:'650000',margin:'14',risk:'4',repayment:'4',creditTermYears:'2',horizon:24,sources:{avgCheck:'Прогнозная модель',margin:'Прогнозная модель',risk:'Прогнозная модель',repayment:'Прогнозная модель',creditTermYears:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'},
    costMode:'monthly', costProfile:[], plAllocations:[], costLogicText:'', businessRationale:'', status:'Готов'
  },
  {
    id:'demo-credit-volume-auto', name:'Объём выдач Автокредит Партнёрский', indicator:'Объём выдач', product:'Автокредит',
    unit:'₽', effectType:'Доходы', base:'1000000', channel:'Партнёрский', segment:'', incrementMode:'annual_spread', calcMethod:'model', modelId:'credit_income_v2',
    modelParams:{margin:'11',risk:'3',repayment:'3',creditTermYears:'5',horizon:36,sources:{margin:'Прогнозная модель',risk:'Прогнозная модель',repayment:'Прогнозная модель',creditTermYears:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'},
    costMode:'monthly', costProfile:[], plAllocations:[], costLogicText:'', businessRationale:'', status:'Готов'
  },
  {
    id:'demo-insurance-osago', name:'Объём сборов ОСАГО', indicator:'Объём сборов', product:'ОСАГО',
    unit:'₽', effectType:'Доходы', base:'1000000', channel:'', segment:'', incrementMode:'annual_spread', calcMethod:'model', modelId:'insurance_income_v1',
    modelParams:{conversion:'18',horizon:1,sources:{conversion:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'},
    costMode:'monthly', costProfile:[], plAllocations:[], costLogicText:'', businessRationale:'', status:'Готов'
  },
  {
    id:'demo-insurance-kasko', name:'Объём сборов КАСКО Онлайн', indicator:'Объём сборов', product:'КАСКО',
    unit:'₽', effectType:'Доходы', base:'1000000', channel:'Онлайн', segment:'', incrementMode:'annual_spread', calcMethod:'model', modelId:'insurance_income_v1',
    modelParams:{conversion:'24',horizon:1,sources:{conversion:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'},
    costMode:'monthly', costProfile:[], plAllocations:[], costLogicText:'', businessRationale:'', status:'Готов'
  },
  {
    id:'demo-rule-debit', name:'Количество клиентов Дебетовые карты Мобильное приложение Массовый', indicator:'Количество клиентов', product:'Дебетовые карты',
    unit:'шт.', effectType:'Доходы', base:'1000', channel:'Мобильное приложение', segment:'Массовый', incrementMode:'annual_spread', calcMethod:'rule', modelId:'', modelParams:null,
    costMode:'monthly', costProfile:['120000','114000','108300','102885','97740.75','92853.71'], plAllocations:[{article:'Прочие доходы',profile:['120000','114000','108300','102885','97740.75','92853.71']}],
    costLogicText:'В первый месяц эффект составляет 120 000 ₽ на 1 000 новых клиентов, затем ежемесячно снижается на 5% в течение 6 месяцев.', businessRationale:'Эффект снижается по мере затухания активности новых клиентов после привлечения.', status:'Готов'
  },
  {
    id:'demo-manual-payments', name:'Количество продаж Платежи', indicator:'Количество продаж', product:'Платежи',
    unit:'шт.', effectType:'Доходы', base:'1000', channel:'', segment:'', incrementMode:'annual_spread', calcMethod:'manual', modelId:'', modelParams:null,
    costMode:'monthly', costProfile:['45000','45000','40000'], plAllocations:[{article:'Прочие доходы',profile:['45000','45000','40000']}],
    costLogicText:'Стоимость задана бизнесом вручную по месяцам.', businessRationale:'Ручная оценка эффекта используется до появления типовой расчётной модели.', status:'Готов'
  },
  {
    id:'demo-step-share', name:'Доля рынка Накопительные счета', indicator:'Доля рынка', product:'Накопительные счета',
    unit:'%', effectType:'Доходы', base:'1', channel:'', segment:'', incrementMode:'step', calcMethod:'manual', modelId:'', modelParams:null,
    costMode:'single', cost:'3500000', costProfile:['3500000'], plAllocations:[{article:'Прочие доходы',profile:['3500000']}],
    costLogicText:'Стоимость изменения доли рынка на 1 п.п. задана бизнесом вручную.', businessRationale:'Рост доли рынка отражает расширение присутствия продукта и формирует дополнительный финансовый эффект.', status:'Готов'
  }
];
const seedMessages = [{
  id: 'hello', role: 'agent',
  text: 'Привет! Я помогу создать драйвер. Напиши запрос обычным языком — например: «Создай драйвер количества выдач по ипотеке». Я проверю реестр, уточню недостающие параметры и покажу карточку перед созданием.'
}];

let drivers = load(REGISTRY_KEY, seedDrivers);
let messages = load(MESSAGES_KEY, seedMessages);
let flow = load(FLOW_KEY, null);
let expandedDriverId = null;
let expandedModelId = null;
let focusedModelId = null;

// Миграция данных из предыдущих версий
drivers = drivers.map(d => ({
  ...d,
  name: buildDriverName(d) || d.name,
  effectType: ['Доход','Доходы'].includes(d.effectType) ? 'Доходы' : 'Расходы',
  base: normalizeStoredBase(d.base),
  channel: d.channel || '',
  segment: d.segment || '',
  unit: unitFor(d.indicator) || d.unit || '',
  costMode: d.costMode || (Array.isArray(d.costProfile) && d.costProfile.length>1 ? 'monthly' : 'single'),
  costProfile: Array.isArray(d.costProfile) ? d.costProfile : (String(d.cost||'').trim() ? [String(d.cost)] : []),
  costLogicText: d.costLogicText || '',
  costFormula: d.costFormula || null,
  businessRationale: d.businessRationale || '',
  calcMethod: d.calcMethod || (d.costMode==='single' ? 'single' : (d.costFormula ? 'rule' : 'manual')),
  modelId: d.modelId || '',
  modelParams: d.modelParams || null,
  incrementMode: d.incrementMode || inferIncrementMode({indicator:d.indicator,unit:d.unit}),
  plAllocations: Array.isArray(d.plAllocations) ? d.plAllocations : ((d.costProfile||[]).length ? [{article: d.effectType==='Расходы'?'Прочие расходы':'Прочие доходы', profile: d.costProfile}] : []),
  status: d.status === 'Готов' && !String(d.cost || '').trim() && !(Array.isArray(d.costProfile)&&d.costProfile.length) ? 'Черновик' : d.status
}));
function normalizeStoredBase(base){
  const s=String(base||'').toLowerCase().replace(/\s/g,'');
  if(!s) return '';
  if(s.includes('млрд')) return '1000000000';
  if(s.includes('млн')) return '1000000';
  const n=s.match(/\d+/)?.[0];
  if(n==='1'||n==='1000'||n==='1000000'||n==='1000000000') return n;
  return '1';
}
function baseLabel(base){
  return ({'1':'1','1000':'1 000','1000000':'1 млн','1000000000':'1 млрд'})[String(base)] || 'не задана';
}

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : clone(fallback); }
  catch { return clone(fallback); }
}
function save() {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(drivers));
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
  localStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  localStorage.setItem(INDICATOR_REGISTRY_KEY, JSON.stringify(indicatorRegistry));
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}
function addMessage(role, text, kind='text') {
  messages.push({ id: `${Date.now()}-${Math.random()}`, role, text, kind });
  save(); renderMessages();
}
function toast(text) {
  const el = document.getElementById('toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

function detect(text) {
  const t = text.toLowerCase().replace(/ё/g,'е');
  let product = null;
  if (t.includes('ипотек')) product = 'Ипотечное кредитование';
  else if (t.includes('автокредит') || (t.includes('авто') && t.includes('кредит'))) product = 'Автокредит';
  else if (t.includes('образоват') && t.includes('кредит')) product = 'Образовательный кредит';
  else if (t.includes('потреб') && t.includes('кредит')) product = 'Потребительский кредит';
  else if (t.includes('дебетов') && t.includes('карт')) product = 'Дебетовые карты';
  else if (t.includes('кредитн') && t.includes('карт')) product = 'Кредитные карты';
  else if (t.includes('осаг')) product = 'ОСАГО';
  else if (t.includes('каско')) product = 'КАСКО';
  else if (t.includes('накоп') && (t.includes('счет') || t.includes('счёт'))) product = 'Накопительные счета';
  else if ((t.includes('сроч') || t.includes('вклад') || t.includes('депозит')) && (t.includes('счет') || t.includes('счёт') || t.includes('вклад') || t.includes('депозит'))) product = 'Срочные счета';
  else if (t.includes('платеж')) product = 'Платежи';
  else if (t.includes('перевод')) product = 'Переводы';
  else if (t.includes('кредит')) product = null;

  let indicator = null;
  if ((t.includes('объем') || t.includes('объём')) && t.includes('выдач')) indicator = 'Объём выдач';
  else if (t.includes('выдач')) indicator = 'Количество выдач';
  else if (t.includes('клиент')) indicator = 'Количество клиентов';
  else if (t.includes('сбор')) indicator = 'Объём сборов';
  else if (t.includes('продаж')) indicator = 'Количество продаж';
  else if (t.includes('доля рынка')) indicator = 'Доля рынка';
  else if (t.includes('уров') && t.includes('проникнов')) indicator = 'Уровень проникновения';
  else if (t.includes('бонус')) indicator = 'Количество бонусов';

  let effectType = null;
  if (t.includes('расход') || t.includes('сокращ') || t.includes('не найм') || t.includes('ненайм')) effectType = 'Расходы';
  else if (t.includes('доход')) effectType = 'Доходы';

  const productGroup = !product && t.includes('кредит') ? 'credit' : (!product && (t.includes('страхов') || t.includes('страхован')) ? 'insurance' : null);
  return { indicator, product, effectType, productGroup };
}
function normalizeText(value){ return String(value||'').trim().toLowerCase().replace(/ё/g,'е').replace(/[–—-]/g,' ').replace(/\s+/g,' '); }
function canonicalFromList(value, list) {
  const raw=normalizeText(value);
  if(!raw) return null;
  return list.find(x=>normalizeText(x)===raw) || null;
}

function unitFor(indicator) {
  const rec=indicatorRecord(indicator);
  return rec ? rec.unit : null;
}
function analyticsKey(v){ return normalizeText(v||''); }
function buildDriverName(d){ return [d?.indicator,d?.product,d?.channel,d?.segment].map(x=>String(x||'').trim()).filter(Boolean).join(' '); }
function exactDuplicate(c, excludeId='') {
  return drivers.find(d => d.id!==excludeId && analyticsKey(d.indicator)===analyticsKey(c.indicator) && analyticsKey(d.product)===analyticsKey(c.product) && analyticsKey(d.channel)===analyticsKey(c.channel) && analyticsKey(d.segment)===analyticsKey(c.segment));
}
function inferIncrementMode(c){
  const name=normalizeText(c?.indicator);
  if(c?.unit==='%' || name.includes('средн') || name.includes('коэффициент') || name.includes('уровень') || name.includes('доля')) return 'step';
  return 'annual_spread';
}
function incrementModeLabel(v){ return v==='step'?'Ступенькой с месяца начала эффекта':'Годовой инкремент распределяется по месяцам'; }
function incrementModeDescription(v){
  return v==='step'
    ? 'Пользователь задаёт инкремент отдельно на каждый год. В первом году он действует с месяца начала эффекта до декабря; в следующих годах — с января по декабрь. Инкременты между годами не накапливаются.'
    : 'Пользователь задаёт годовой инкремент отдельно на каждый год; при расчёте эффекта система распределяет его по месяцам соответствующего года. Месяц начала эффекта ограничивает только первый год.';
}
function isPlArticle(value){ return PL_ARTICLES.some(x=>analyticsKey(x)===analyticsKey(value)); }
function similarDrivers(c) {
  if (!c.indicator && !c.product) return [];
  return drivers.filter(d => (c.indicator && d.indicator === c.indicator) || (c.product && d.product === c.product)).slice(0,3);
}
function moneyNumber(v){ const n=Number(String(v??'').replace(/\s/g,'').replace(',','.')); return Number.isFinite(n)?n:0; }
function formatMoney(v){ return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(moneyNumber(v)); }
function profileTotal(profile){ return (profile||[]).reduce((sum,v)=>sum+moneyNumber(v),0); }

const CREDIT_PRODUCTS = ['Ипотечное кредитование','Потребительский кредит','Автокредит','Образовательный кредит'];
const INSURANCE_PRODUCTS = ['ОСАГО','КАСКО'];
const DRIVER_MODELS = {
  credit_income_v2: {
    id:'credit_income_v2',
    title:'Кредиты',
    calculation:'Финансовый эффект кредитной выдачи',
    businessLogic:'Выдача формирует процентный доход на остаток кредита и расходы на резервы. В первом месяце используется 50% новой выдачи как средний остаток. Далее остаток уменьшается по мере погашения. Маржа и уровень риска используются в годовом выражении и календаризуются по фактическому числу дней месяца. Горизонт стоимости определяется сроком кредита: срок в годах переводится в месяцы, максимум 36 месяцев.',
    products:CREDIT_PRODUCTS,
    effectType:'Доходы',
    firstMonthBalanceFactor:0.5,
    plArticles:['Чистый процентный доход','Расходы на резервы'],
    links:[
      {indicator:'Объём выдач', params:['Маржа, % годовых','Уровень риска, % годовых','Уровень погашения, % в месяц','Срок кредита, лет']},
      {indicator:'Количество выдач', params:['Маржа, % годовых','Уровень риска, % годовых','Уровень погашения, % в месяц','Средний чек','Срок кредита, лет']}
    ]
  },
  insurance_income_v1: {
    id:'insurance_income_v1',
    title:'Страхование',
    calculation:'Перевод сборов в чистый комиссионный доход',
    businessLogic:'Финансовый эффект рассчитывается за один месяц: объём страховых сборов умножается на коэффициент перевода сборов в ОД. Полученный эффект относится на чистый комиссионный доход.',
    products:INSURANCE_PRODUCTS,
    effectType:'Доходы',
    plArticles:['Чистый комиссионный доход'],
    links:[{indicator:'Объём сборов', params:['Коэффициент перевода сборов в ОД, %']}]
  }
};
function availableModel(c){
  return Object.values(DRIVER_MODELS).find(model=>model.products.includes(c?.product) && model.links.some(x=>x.indicator===c?.indicator)) || null;
}
function defaultModelBase(c, model=availableModel(c)){
  if(!model) return '';
  if(c?.indicator==='Количество выдач') return '1';
  if(c?.unit==='₽' || ['Объём выдач','Объём сборов'].includes(c?.indicator)) return '1000000';
  return '1';
}
function shortArticleName(article){
  return ({'Чистый процентный доход':'ЧПД','Расходы на резервы':'Резервы','Чистый комиссионный доход':'ЧКД'})[article] || article;
}
function compactRub(v){
  const n=moneyNumber(v), a=Math.abs(n);
  if(a>=1000000) return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n/1000000)} млн`;
  if(a>=1000) return `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n/1000)} тыс.`;
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
}
function daysInMonth(year,monthIndex){ return new Date(year,monthIndex+1,0).getDate(); }
function daysInYear(year){ return ((year%4===0 && year%100!==0)||year%400===0)?366:365; }
function sumAllocationProfiles(allocations, months){
  return Array.from({length:months},(_,i)=>String(Math.round((allocations||[]).reduce((sum,a)=>sum+moneyNumber(a.profile?.[i]),0)*100)/100));
}
function creditHorizonMonths(p){
  const years=moneyNumber(p?.creditTermYears);
  if(!years) return Math.max(1,Math.min(36,Number(p?.horizon)||0));
  return Math.max(1,Math.min(36,Math.round(years*12)));
}
function calculateCreditModel(c){
  const p=c.modelParams||{};
  const months=creditHorizonMonths(p); if(!months) return {profile:[],allocations:[]};
  let balance=c.indicator==='Количество выдач' ? moneyNumber(c.base)*moneyNumber(p.avgCheck) : moneyNumber(c.base);
  const margin=moneyNumber(p.margin)/100, risk=moneyNumber(p.risk)/100, repayment=moneyNumber(p.repayment)/100;
  const nii=[], reserves=[]; const refYear=2027;
  for(let i=0;i<months;i++){
    const year=refYear+Math.floor(i/12), month=i%12;
    const dayFactor=daysInMonth(year,month)/daysInYear(year);
    const effectBalance=i===0 ? balance*0.5 : balance;
    nii.push(String(Math.round(effectBalance*margin*dayFactor*100)/100));
    reserves.push(String(Math.round(-effectBalance*risk*dayFactor*100)/100));
    balance=Math.max(0,balance*(1-repayment));
  }
  const allocations=[{article:'Чистый процентный доход',profile:nii},{article:'Расходы на резервы',profile:reserves}];
  return {profile:sumAllocationProfiles(allocations,months),allocations};
}
function calculateInsuranceModel(c){
  const p=c.modelParams||{};
  const coeff=moneyNumber(p.conversion)/100; if(!coeff) return {profile:[],allocations:[]};
  const effect=moneyNumber(c.base)*coeff;
  const profile=[String(Math.round(effect*100)/100)];
  return {profile,allocations:[{article:'Чистый комиссионный доход',profile:[...profile]}]};
}
function calculateModel(c){ const m=availableModel(c); if(!m) return {profile:[],allocations:[]}; return m.id==='insurance_income_v1'?calculateInsuranceModel(c):calculateCreditModel(c); }
function modelLogic(c){
  const m=availableModel(c); const p=c.modelParams||{}; if(!m) return '';
  if(m.id==='insurance_income_v1') return `Объём сборов × коэффициент перевода ${p.conversion}% = чистый комиссионный доход. Эффект рассчитывается за 1 месяц без деления на 12 и календаризации.`;
  const baseText=c.indicator==='Количество выдач' ? `${baseLabel(c.base)} выдач × средний чек ${formatMoney(p.avgCheck)} ₽` : `${baseLabel(c.base)} объёма выдач`;
  return `Расчёт на остаток кредитной выдачи: ${baseText}; В 1-м месяце используется 50% выдачи. Чистый процентный доход = остаток × маржа ${p.margin}% годовых × дни месяца / дни года. Расходы на резервы = −остаток × риск ${p.risk}% годовых × дни месяца / дни года. Остаток ежемесячно уменьшается на ${p.repayment}%; горизонт ${creditHorizonMonths(p)} мес.`;
}
function modelBusinessRationale(c){ const m=availableModel(c); return m?.businessLogic||''; }
// Демо-набор v4: для модельных драйверов профиль и статьи рассчитываются той же моделью, что и для новых драйверов.
for (const d of drivers) {
  if (d.calcMethod==='model' && d.modelId) {
    const result=calculateModel(d);
    if(result.profile.length){
      d.costProfile=result.profile; d.plAllocations=result.allocations; d.cost=String(profileTotal(result.profile)); d.costMode=result.profile.length>1?'monthly':'single';
      d.costLogicText=modelLogic(d); d.businessRationale=modelBusinessRationale(d); d.status='Готов';
    }
  }
  d.name=buildDriverName(d)||d.name;
}
localStorage.setItem(REGISTRY_KEY, JSON.stringify(drivers));
function compactProfileLines(profile, limit=6){
  const p=profile||[];
  const lines=p.slice(0,limit).map((v,i)=>`Месяц ${i+1}: ${formatMoney(v)} ₽`);
  if(p.length>limit) lines.push(`… ещё ${p.length-limit} мес.`);
  return lines.join('\n');
}
function monthlyFormulaLabel(f){
  if(!f) return '';
  if(f.type==='decay_percent') return `1-й месяц = ${formatMoney(f.start)} ₽; далее каждый месяц −${f.percent}% от предыдущего, ${f.months} мес.`;
  if(f.type==='growth_percent') return `1-й месяц = ${formatMoney(f.start)} ₽; далее каждый месяц +${f.percent}% к предыдущему, ${f.months} мес.`;
  if(f.type==='decrease_fixed') return `1-й месяц = ${formatMoney(f.start)} ₽; далее каждый месяц −${formatMoney(f.amount)} ₽, ${f.months} мес.`;
  if(f.type==='increase_fixed') return `1-й месяц = ${formatMoney(f.start)} ₽; далее каждый месяц +${formatMoney(f.amount)} ₽, ${f.months} мес.`;
  if(f.type==='constant') return `${formatMoney(f.amount)} ₽ ежемесячно, ${f.months} мес.`;
  if(f.type==='two_stage') return `${formatMoney(f.firstAmount)} ₽ × ${f.firstMonths} мес.; затем ${formatMoney(f.secondAmount)} ₽ × ${f.secondMonths} мес.`;
  return '';
}
function calculateProfile(f){
  if(!f) return []; const out=[];
  if(f.type==='decay_percent'||f.type==='growth_percent'){
    let v=moneyNumber(f.start), k=f.type==='decay_percent'?(1-moneyNumber(f.percent)/100):(1+moneyNumber(f.percent)/100);
    for(let i=0;i<Math.min(36,Number(f.months)||0);i++){ out.push(String(Math.round(v*100)/100)); v*=k; }
  } else if(f.type==='decrease_fixed'||f.type==='increase_fixed'){
    let v=moneyNumber(f.start), delta=moneyNumber(f.amount)*(f.type==='decrease_fixed'?-1:1);
    for(let i=0;i<Math.min(36,Number(f.months)||0);i++){ out.push(String(Math.max(0,Math.round(v*100)/100))); v+=delta; }
  } else if(f.type==='constant'){ for(let i=0;i<Math.min(36,Number(f.months)||0);i++) out.push(String(moneyNumber(f.amount)));
  } else if(f.type==='two_stage'){
    for(let i=0;i<Math.min(36,Number(f.firstMonths)||0);i++) out.push(String(moneyNumber(f.firstAmount)));
    for(let i=0;i<Math.min(36-out.length,Number(f.secondMonths)||0);i++) out.push(String(moneyNumber(f.secondAmount)));
  }
  return out;
}


function setLlmBusy(busy){
  const composer=document.getElementById('composer');
  const button=composer?.querySelector('button[type="submit"]');
  if(button){ button.disabled=busy; button.textContent=busy?'Думаю…':'Отправить'; }
  composer?.classList.toggle('is-loading',busy);
}
function renderLlmSettings(){
  const status=document.getElementById('llmStatus');
  if(status){ status.textContent='Доступно'; status.className='llm-status online'; }
  const meta=document.getElementById('llmMeta');
  if(meta) meta.textContent='Используй проверку, если агент перестал отвечать как обычно.';
}
function cleanJsonText(text){
  const cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start=cleaned.indexOf('{'), end=cleaned.lastIndexOf('}');
  return start>=0 && end>start ? cleaned.slice(start,end+1) : cleaned;
}
function parseLooseLlmJson(content){
  const cleaned=cleanJsonText(content);
  try { return JSON.parse(cleaned); } catch {}
  const out={};
  const keys=['indicator','product','effectType','base','cost','channel','segment'];
  for(const key of keys){
    const re=new RegExp(`[\"']?${key}[\"']?\s*:\s*(null|[\"'][^\"']*[\"']|-?\d+(?:\.\d+)?)`,'i');
    const m=cleaned.match(re);
    if(!m) continue;
    let v=m[1];
    if(/^null$/i.test(v)) out[key]=null;
    else if((v.startsWith('\"')&&v.endsWith('\"'))||(v.startsWith("'")&&v.endsWith("'"))) out[key]=v.slice(1,-1);
    else out[key]=v;
  }
  return Object.keys(out).length ? out : null;
}

function normalizeLlmData(data){
  const out={};
  if(typeof data?.indicator==='string' && data.indicator.trim()) out.indicator=data.indicator.trim();
  if(typeof data?.product==='string' && data.product.trim()) out.product=data.product.trim();
  if(['Доходы','Расходы'].includes(data?.effectType)) out.effectType=data.effectType;
  // Единица измерения — атрибут показателя из справочника, LLM её не назначает.
  if(['1','1000','1000000','1000000000'].includes(String(data?.base||''))) out.base=String(data.base);
  if(data?.cost!==null && data?.cost!==undefined && String(data.cost).trim()){
    const parsed=parseCost(String(data.cost)); if(parsed) out.cost=parsed.cost;
  }
  if(typeof data?.channel==='string' && data.channel.trim()) out.channel=data.channel.trim();
  if(typeof data?.segment==='string' && data.segment.trim()) out.segment=data.segment.trim();
  return out;
}
async function callOpenRouter(userText, candidate={}, expectedStep=''){
  const system=`Ты — модуль понимания запроса для прототипа управления финансовыми драйверами. Извлекай параметры из сообщения пользователя и не выдумывай то, чего нет в тексте.

Показатели из справочника: ${indicatorNames().join(', ')}. Если смысл точно соответствует одному из них, используй точное название из справочника. Если пользователь явно называет другой показатель, верни его как услышал — приложение отдельно проверит справочник и завершит процесс. Не подменяй неизвестный показатель похожим. В частности: «доля рынка» = «Доля рынка», «уровень проникновения» = «Уровень проникновения», «объём выдач» = «Объём выдач».
Продукт должен быть только из справочника: ${PRODUCTS.join(', ')}. Если в сообщении указан другой продукт, верни его как услышал — приложение отдельно проверит справочник и завершит процесс. Не подменяй неизвестный продукт похожим. Если пользователь говорит только «кредиты», «кредит», «по кредитам» без конкретного вида кредита — product=null. Если говорит только «страховка», «страхование», «по страховкам» без ОСАГО/КАСКО — product=null.
Тип эффекта: Доходы или Расходы. База расчёта: 1, 1000, 1000000 или 1000000000. Единицу измерения НЕ определяй: она является атрибутом показателя и берётся приложением только из справочника показателей.

Верни ТОЛЬКО один JSON-объект без markdown и пояснений с ключами: indicator, product, effectType, base, cost, channel, segment. Для неизвестных параметров ставь null. Если пользователь отвечает коротко на уточняющий вопрос, учитывай поле, которое сейчас ожидается. Стоимость верни числом/строкой в рублях без знака валюты.`;
  const current=JSON.stringify(candidate||{});
  const response=await fetch(LLM_API_URL,{
    method:'POST',
    headers:authHeaders({'Content-Type':'application/json'}),
    body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:`Текущая карточка: ${current}\nОжидаемое поле: ${expectedStep||'не задано'}\n\nСообщение пользователя: ${userText}`} ]})
  });
  const payload=await response.json().catch(()=>({}));
  if(response.status===401){ requireLogin(); throw new Error('Требуется вход'); }
  if(!response.ok) throw new Error(payload?.error?.message || payload?.error || `LLM API: ${response.status}`);
  const content=payload?.choices?.[0]?.message?.content;
  if(!content) throw new Error('LLM вернула пустой ответ');
  const parsed=parseLooseLlmJson(content);
  if(!parsed) throw new Error('Не удалось разобрать ответ LLM');
  return normalizeLlmData(parsed);
}
function mergeLlmCandidate(data){
  if(!flow) return;
  const c=flow.candidate;
  const oldIdentity=`${c.indicator||''}|${c.product||''}`;
  const previousUnit=c.unit;
  Object.assign(c,data);
  if(c.indicator){
    const registryUnit=unitFor(c.indicator);
    // Для существующего показателя единица всегда приходит из справочника.
    // Для нового показателя сохраняем уже введённую пользователем единицу
    // и не позволяем очередному ответу LLM затереть её null-значением.
    c.unit=registryUnit || previousUnit || c.unit || null;
  }
  const newIdentity=`${c.indicator||''}|${c.product||''}`;
  if(oldIdentity!==newIdentity){ delete flow.duplicateChecked; delete flow.duplicateId; }
}
async function processUserText(text){
  if(!flow){ const quick=detect(text); if(quick.productGroup){ startFlow(text); return; } }
  setLlmBusy(true);
  try{
    const expectedStep=flow?.step||'';
    const data=await callOpenRouter(text,flow?.candidate||{},expectedStep);
    if(!flow){
      flow={step:'',candidate:{indicator:null,product:null,effectType:null,unit:null,base:'',cost:'',costMode:'',calcMethod:'',costProfile:[],costLogicText:'',costFormula:null,businessRationale:'',modelId:'',modelParams:null,plAllocations:[],incrementMode:'',channel:'',segment:'',status:'Черновик'},original:text};
    }
    mergeLlmCandidate(data);
    if(expectedStep && !data[expectedStep]){
      handleFlowAnswer(text);
      return;
    }
    flow.step=''; flow.options=[]; save();
    continueFlow();
  }catch(err){
    console.warn('LLM fallback:',err);
    // Для пользователя техническая ошибка LLM скрыта: продолжаем по детерминированным правилам.
    flow ? handleFlowAnswer(text) : startFlow(text);
  }finally{ setLlmBusy(false); }
}
async function testLlmConnection(){
  const btn=document.getElementById('testLlm');
  const meta=document.getElementById('llmMeta');
  const status=document.getElementById('llmStatus');
  if(btn){btn.disabled=true;btn.textContent='Проверяю…';}
  try{
    await callOpenRouter('Создай драйвер количества клиентов по ипотеке',{},'');
    toast('Соединение работает');
    if(meta) meta.textContent='Соединение проверено — всё работает.';
    if(status) status.textContent='Доступно';
  }catch(err){
    console.warn('Connection check failed:',err);
    toast('Не удалось подключиться. Попробуйте ещё раз');
    if(meta) meta.textContent='Не удалось проверить соединение. Попробуйте ещё раз.';
    if(status) status.textContent='Недоступно';
  }
  finally{if(btn){btn.disabled=false;btn.textContent='Проверить';}}
}


async function interpretCostLogic(text){
  const system=`Ты переводишь описание бизнес-логики стоимости финансового драйвера в простую воспроизводимую формулу. Верни ТОЛЬКО JSON без markdown. Разрешённые типы:
- decay_percent: {type,start,percent,months}
- growth_percent: {type,start,percent,months}
- decrease_fixed: {type,start,amount,months}
- increase_fixed: {type,start,amount,months}
- constant: {type,amount,months}
- two_stage: {type,firstAmount,firstMonths,secondAmount,secondMonths}
Если срок не указан, months=null. Для two_stage сроки каждого этапа обязательны, иначе null. Добавь поля businessLogic — коротко по-русски, что означает формула, и businessRationale — короткий бизнес-смысл эффекта. Ничего не выдумывай.`;
  const response=await fetch(LLM_API_URL,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:text}]})});
  const payload=await response.json().catch(()=>({}));
  if(response.status===401){ requireLogin(); throw new Error('formula'); }
  if(!response.ok) throw new Error('formula');
  const content=payload?.choices?.[0]?.message?.content; if(!content) throw new Error('formula');
  const data=JSON.parse(cleanJsonText(content));
  if(!['decay_percent','growth_percent','decrease_fixed','increase_fixed','constant','two_stage'].includes(data.type)) throw new Error('formula');
  return data;
}
function localInterpretCostLogic(text){
  const t=normalizeText(text); const nums=[...String(text).matchAll(/(\d[\d\s]*(?:[.,]\d+)?)/g)].map(m=>moneyNumber(m[1]));
  const pct=String(text).match(/(\d+(?:[.,]\d+)?)\s*%/); const months=String(text).match(/(\d+)\s*(?:месяц|месяц[а-я]*|мес\.?)/i);
  if(nums.length && pct){ const isGrow=/рост|увелич|прибав|раст/i.test(text); return {type:isGrow?'growth_percent':'decay_percent',start:nums[0],percent:moneyNumber(pct[1]),months:months?Number(months[1]):null,businessLogic:String(text).trim()}; }
  return null;
}

function startFlow(text) {
  const detected = detect(text);
  flow = { step:'', candidate:{ ...detected, unit: detected.indicator ? unitFor(detected.indicator) : null, base:'', cost:'', costMode:'', calcMethod:'', costProfile:[], costLogicText:'', costFormula:null, businessRationale:'', modelId:'', modelParams:null, plAllocations:[], incrementMode:'', channel:'', segment:'', status:'Черновик' }, original:text };
  save();
  continueFlow();
}
function checkIndicator(indicator) {
  const value=String(indicator||'').trim();
  if(!value) return 'missing';
  const rec=indicatorRecord(value);
  if(rec){ flow.candidate.indicator=rec.name; flow.candidate.unit=rec.unit; flow.candidate.newIndicator=false; return 'found'; }
  flow.candidate.indicator=value; flow.candidate.newIndicator=true; return 'new';
}
function rejectUnknownProduct(product) {
  const value=String(product||'').trim();
  if(!value) return false;
  const canonical=canonicalFromList(value, PRODUCTS);
  if(canonical){ flow.candidate.product=canonical; return false; }
  addMessage('agent', `Продукт «${value}» не найден в справочнике. Создание драйвера завершено.`);
  flow=null; save(); renderContextActions(); renderProgress();
  return true;
}
function defaultModelParams(c, model){
  if(model?.id==='credit_income_v2') return {
    avgCheck: c.indicator==='Количество выдач'?'1000000':'', margin:'2', risk:'1', repayment:'3', creditTermYears:'3', horizon:36,
    sources:{avgCheck:'Прогнозная модель',margin:'Прогнозная модель',risk:'Прогнозная модель',repayment:'Прогнозная модель',creditTermYears:'Прогнозная модель'},
    sourcePeriod:'Среднее за последние 3 месяца прогнозного года'
  };
  if(model?.id==='insurance_income_v1') return {conversion:'50',horizon:1,sources:{conversion:'Прогнозная модель'},sourcePeriod:'Среднее за последние 3 месяца прогнозного года'};
  return {};
}
function continueFlow() {
  if (!flow) return;
  const c = flow.candidate;
  if (!c.indicator) return ask('indicator', 'Какой показатель должен лежать в основе драйвера?', indicatorNames());
  if(isPlArticle(c.indicator)){
    addMessage('agent', `«${c.indicator}» — статья P&L, а статья P&L не может быть драйвером. Укажи бизнес-показатель, изменение которого формирует эту статью — например, объём или количество выдач.`);
    c.indicator=null; c.unit=null; save(); return ask('indicator','Какой бизнес-показатель должен лежать в основе драйвера?',indicatorNames());
  }
  const indicatorState=checkIndicator(c.indicator);
  if(indicatorState==='new' && !flow.newIndicatorConfirmed){
    flow.step='newIndicator'; save();
    addMessage('agent', `Показатель «${c.indicator}» не найден в справочнике. Я могу подготовить новый показатель по правилам справочника и создать драйвер на его основе. Драйвер будет направлен методологу на согласование. Продолжить?`);
    renderContextActions(); renderProgress(); return;
  }
  if(c.newIndicator && !c.unit) return ask('unit','Укажи единицу измерения нового показателя.',['шт.','₽','%','Другое']);
  if(!c.newIndicator) c.unit = unitFor(c.indicator);
  if (!c.product) return ask('product', 'К какому продукту относится драйвер?', PRODUCTS);
  if (rejectUnknownProduct(c.product)) return;

  if (!flow.duplicateChecked) {
    flow.duplicateChecked = true;
    const duplicate = exactDuplicate(c);
    if (duplicate) {
      flow.duplicateId = duplicate.id;
      flow.step = 'duplicate'; save();
      addMessage('agent', `Такой драйвер уже существует с той же аналитикой: «${duplicate.name}»${duplicate.channel?` · канал: ${duplicate.channel}`:''}${duplicate.segment?` · сегмент: ${duplicate.segment}`:''}. Повторно создать такую же комбинацию нельзя. Можно открыть его, изменить стоимость или создать отдельный драйвер с другой аналитикой.`);
      renderContextActions(); renderProgress(); return;
    }
    const similar = similarDrivers(c);
    if (similar.length) {
      flow.similarIds=similar.map(x=>x.id); flow.step='similar'; save();
      addMessage('agent', `Нашёл ${similar.length} похожих ${similar.length===1?'драйвер':'драйвера'}. Посмотри их перед созданием нового — возможно, нужный уже есть.`);
      renderContextActions(); renderProgress(); return;
    }
  }
  if(!c.incrementMode) c.incrementMode=inferIncrementMode(c);
  const model=availableModel(c);
  if(model?.effectType && !c.effectType){
    c.effectType=model.effectType;
    save();
  }
  if (!c.effectType) return ask('effectType', 'Какой тип эффекта у драйвера?', ['Доходы','Расходы']);

  if(!c.calcMethod && model){
    flow.step='modelChoice'; flow.modelId=model.id; save();
    const extra=c.indicator==='Количество выдач'?' + средний чек':'';
    addMessage('agent', `Есть модель «${model.title}». Параметры: ${model.id==='credit_income_v2'?`маржа, риск, погашение${extra}`:'коэффициент перевода сборов'}. Использовать её?`);
    renderContextActions(); renderProgress(); return;
  }
  if(c.calcMethod==='model' && !c.base){ c.base=defaultModelBase(c,model); save(); }
  if (!c.base) return ask('base', 'Выбери базу, для которой рассчитываем эффект.', ['1','1 000','1 млн','1 млрд']);

  if(c.calcMethod==='model'){
    c.costMode='monthly'; c.modelId=c.modelId||flow.modelId||model?.id||'credit_income_v2'; c.modelParams=c.modelParams||defaultModelParams(c,model);
    const p=c.modelParams;
    if(model?.id==='insurance_income_v1') {
      if(p.conversion===undefined || p.conversion==='') Object.assign(p,defaultModelParams(c,model));
      p.horizon=1;
    } else {
      if(p.margin===undefined || p.margin==='' || p.risk===undefined || p.risk==='' || p.repayment===undefined || p.repayment==='') Object.assign(p,defaultModelParams(c,model));
      if(c.indicator==='Количество выдач' && !p.avgCheck) return ask('modelAvgCheck','Укажи средний чек одной выдачи в рублях. Например: «1 200 000».');
      if(p.margin===undefined || p.margin==='') return ask('modelMargin','Укажи маржу в процентах годовых.');
      if(p.risk===undefined || p.risk==='') return ask('modelRisk','Укажи уровень риска в процентах годовых.');
      if(p.repayment===undefined || p.repayment==='') return ask('modelRepayment','Укажи уровень погашения в процентах за месяц.');
    }
    if(!p.creditTermYears) return ask('modelCreditTerm','Укажи срок кредита в годах. Стоимость рассчитаю на срок кредита, но максимум на 36 месяцев.');
    p.horizon=creditHorizonMonths(p);
    if(!(c.costProfile||[]).length){
      const result=calculateModel(c); const profile=result.profile;
      c.costProfile=profile; c.plAllocations=result.allocations; c.cost=String(profileTotal(profile)); c.costLogicText=modelLogic(c); c.businessRationale=modelBusinessRationale(c);
      flow.step='modelConfirm'; save();
      addMessage('agent', `Готово по модели «${model.title}»: ${profile.length} мес., итог ${formatMoney(profileTotal(profile))} ₽.
Исходные значения — из прогнозной модели, среднее за последние 3 месяца прогнозного года.
${(c.plAllocations||[]).map(a=>`${shortArticleName(a.article)}: ${formatMoney(profileTotal(a.profile||[]))} ₽`).join(' · ')}

Подтвердить расчёт?`);
      renderContextActions(); renderProgress(); return;
    }
    return showPreview();
  }

  if(!c.calcMethod) return ask('calcMethod','Готовой модели для этого драйвера пока нет. Как удобнее определить стоимость?',['Описать правило','Ручной ввод']);
  c.costMode='monthly';
  if(c.calcMethod==='rule' && !(c.costProfile||[]).length) return ask('costRule', `Опиши бизнес-логику обычным языком. Например: «10 000 ₽ в первый месяц, затем эффект уменьшается на 7% ежемесячно в течение 12 месяцев». Я сначала покажу, как понял правило, а затем рассчитаю профиль.`);
  if(c.calcMethod==='manual' && !(c.costProfile||[]).length) return ask('costProfile', `Укажи стоимость вручную. Можно ввести одно значение или вставить помесячный профиль из Excel. В карточке каждое значение можно будет поправить отдельно.`);
  if(!(c.plAllocations||[]).length) return ask('plArticle','На какую статью P&L относится рассчитанный эффект?',PL_ARTICLES);
  showPreview();
}
function ask(step, text, options=[]) {
  if (flow.step !== step) addMessage('agent', text);
  flow.step = step; flow.options = options; save(); renderContextActions(); renderProgress();
}
function handleFlowAnswer(text) {
  const c = flow.candidate;
  if (flow.step === 'indicator') c.indicator = text.trim();
  else if (flow.step === 'unit') { if(text.trim()==='Другое') return ask('unitCustom','Напиши единицу измерения нового показателя.'); c.unit=text.trim(); }
  else if (flow.step === 'unitCustom') c.unit=text.trim();
  else if (flow.step === 'product') { c.product = text.trim(); c.productGroup=''; }
  else if (flow.step === 'effectType') c.effectType = normalizeEffect(text);
  else if (flow.step === 'channel') c.channel = text.trim();
  else if (flow.step === 'segment') c.segment = text.trim();
  else if (flow.step === 'base') c.base = normalizeBaseAnswer(text);
  else if (flow.step === 'modelChoice') { c.calcMethod = normalizeText(text).includes('модел') || normalizeText(text).includes('использ') ? 'model' : ''; if(!c.calcMethod) c.calcMethod='rule'; c.modelId=flow.modelId||''; }
  else if (flow.step === 'calcMethod') {
    const t=normalizeText(text); c.calcMethod=t.includes('модел')?'model':t.includes('правил')?'rule':'manual'; c.costMode='monthly';
  }
  else if(flow.step==='modelAvgCheck'){ const x=parseCost(text); if(!x){addMessage('agent','Не смог разобрать средний чек. Укажи сумму в рублях.');return;} c.modelParams={...(c.modelParams||{}),avgCheck:x.cost}; }
  else if(flow.step==='modelConversion'){ const n=String(text).replace(',','.').match(/\d+(?:\.\d+)?/); if(!n){addMessage('agent','Укажи коэффициент в процентах.');return;} c.modelParams={...(c.modelParams||{}),conversion:n[0]}; }
  else if(flow.step==='modelMargin' || flow.step==='modelRisk' || flow.step==='modelRepayment'){
    const n=String(text).replace(',','.').match(/\d+(?:\.\d+)?/); if(!n){addMessage('agent','Укажи значение в процентах, например 2 или 0,7.');return;}
    const key=flow.step==='modelMargin'?'margin':flow.step==='modelRisk'?'risk':'repayment'; c.modelParams={...(c.modelParams||{}),[key]:n[0]};
  }
  else if(flow.step==='modelHorizon'){
    const n=Number(String(text).match(/\d+/)?.[0]||0); if(!n||n>36){addMessage('agent','Укажи срок от 1 до 36 месяцев.');return;} c.modelParams={...(c.modelParams||{}),horizon:n};
  }
  else if (flow.step === 'costRule') {
    flow.pendingCostLogic=text; flow.step='formulaParsing'; save(); addMessage('agent','Понял. Сначала формализую правило, потом покажу расчёт…');
    (async()=>{
      let f=null; try{ f=await interpretCostLogic(text); }catch{ f=localInterpretCostLogic(text); }
      if(!flow) return;
      if(!f){ flow.step='costRule'; save(); addMessage('agent','Не смог однозначно понять правило. Укажи начальное значение, как оно меняется и срок расчёта.'); renderContextActions(); return; }
      c.costFormula=f; c.costLogicText=f.businessLogic||text; c.businessRationale=f.businessRationale||c.businessRationale||'Эффект рассчитывается по бизнес-правилу, заданному пользователем.';
      if(f.type!=='two_stage' && !f.months){ return ask('formulaMonths','На сколько месяцев применить это правило? Например: 12, 24 или 36.'); }
      const calculated=calculateProfile(f);
      if(!calculated.length){ flow.step='costRule'; addMessage('agent','Не получилось рассчитать профиль. Уточни правило и срок.'); renderContextActions(); return; }
      c.costProfile=calculated; c.cost=String(profileTotal(calculated)); flow.step='formulaConfirm'; save();
      addMessage('agent', `Я понял правило так:
${monthlyFormulaLabel(f)}

Бизнес-смысл: ${c.businessRationale}

${compactProfileLines(calculated)}

Итого за ${calculated.length} мес.: ${formatMoney(profileTotal(calculated))} ₽

Подтвердить расчёт?`);
      renderContextActions(); renderProgress();
    })(); return;
  }
  else if (flow.step === 'costProfile') {
    const profile=parseCostProfile(text);
    if(!profile.length){addMessage('agent','Не смог разобрать значения. Вставь числа из Excel или перечисли их через точку с запятой.');return;}
    if(profile.length>36){addMessage('agent','Можно указать максимум 36 месяцев.');return;}
    c.costProfile=profile; c.cost=String(profileTotal(profile)); c.costLogicText=profile.length===1?'Стоимость задана пользователем вручную одним значением.':'Профиль стоимости задан пользователем вручную по месяцам.'; c.businessRationale=c.businessRationale||'Стоимость драйвера определена бизнесом вручную.'; c.costFormula=null;
  }
  else if(flow.step==='plArticle'){ const article=String(text).trim(); c.plAllocations=[{article,profile:[...(c.costProfile||[])]}]; }
  else if (flow.step === 'formulaMonths') {
    const n=Number(String(text).match(/\d+/)?.[0]||0); if(!n||n>36){ addMessage('agent','Укажи срок от 1 до 36 месяцев.'); return; }
    c.costFormula={...(c.costFormula||{}),months:n}; const calculated=calculateProfile(c.costFormula); c.costProfile=calculated; c.cost=String(profileTotal(calculated)); flow.step='formulaConfirm'; save();
    addMessage('agent', `Рассчитал профиль по правилу:
${compactProfileLines(calculated)}

Итого за ${calculated.length} мес.: ${formatMoney(profileTotal(calculated))} ₽

Подтвердить расчёт?`); renderContextActions(); renderProgress(); return;
  }
  else if (flow.step === 'cost') {
    const parsed = parseCost(text);
    if (!parsed) { addMessage('agent','Не смог разобрать стоимость. Укажи сумму в рублях, например «2500».'); return; }
    c.cost = parsed.cost;
  }
  flow.step = ''; flow.options = []; save(); continueFlow();
}
function normalizeEffect(text) {
  const t=text.toLowerCase();
  return t.includes('расход') || t.includes('сокращ') || t.includes('не найм') || t.includes('ненайм') ? 'Расходы' : 'Доходы';
}
function normalizeBaseAnswer(text){
  const t=text.toLowerCase().replace(/\s/g,'');
  if(t.includes('млрд')) return '1000000000';
  if(t.includes('млн')) return '1000000';
  if(t.includes('1000')) return '1000';
  return '1';
}
function parseCost(text) {
  const n=text.replace(/\s/g,'').replace(',','.').match(/\d+(?:\.\d+)?/);
  return n ? {cost:n[0]} : null;
}
function parseCostProfile(text){
  let raw=String(text||'').trim(); if(!raw) return [];
  let parts = /[;\n\t]/.test(raw) ? raw.split(/[;\n\t]+/) : raw.split(/,\s*(?=\d)/);
  return parts.map(x=>parseCost(x)?.cost).filter(Boolean).slice(0,37);
}
function costSummary(d){
  const p=Array.isArray(d.costProfile)?d.costProfile:[];
  if(d.costMode==='monthly' || p.length>1) return `${formatMoney(profileTotal(p))} ₽ · профиль ${p.length||1} мес.`;
  return d.cost!==undefined && d.cost!==null && d.cost!=='' ? `${formatMoney(d.cost)} ₽` : '— ₽';
}

function showPreview() {
  const c=flow.candidate; c.name = buildDriverName(c);
  flow.step='preview'; save();
  if(c.calcMethod==='model'){
    const model=DRIVER_MODELS[c.modelId]||availableModel(c);
    addMessage('agent', `Проверь перед созданием:\n\n${c.name}\nМодель: «${model?.title||'расчёта'}»\nРасчёт на: ${baseLabel(c.base)} ${c.unit}\nПрофиль: ${(c.costProfile||[]).length} мес.\nСтатьи: ${(c.plAllocations||[]).map(x=>x.article).join(', ')}\nИтого: ${formatMoney(profileTotal(c.costProfile||[]))} ₽`,'preview');
  } else {
    const methodLabel=c.calcMethod==='rule'?'По заданному правилу':'Ручной ввод';
    addMessage('agent', `Проверь перед созданием:\n\n${c.name}\nСпособ расчёта: ${methodLabel}\nРасчёт на: ${baseLabel(c.base)} ${c.unit}\nСтатьи: ${(c.plAllocations||[]).map(x=>x.article).join(', ')||'не указаны'}\nИтого: ${formatMoney(profileTotal(c.costProfile||[]))} ₽`,'preview');
  }
  renderContextActions(); renderProgress();
}
function finalizeDriver() {
  const c=flow.candidate;
  const duplicate=exactDuplicate(c); if(duplicate){ addMessage('agent','Такой драйвер с этой же аналитикой уже существует. Чтобы создать новый, измени продукт, канал или сегмент.'); flow.duplicateChecked=false; flow.step=''; save(); continueFlow(); return; }
  let indicator=indicatorRecord(c.indicator);
  if(!indicator){ indicator={name:c.indicator,unit:c.unit,status:'Подготовлен'}; indicatorRegistry.push(indicator); }
  const needsApproval = indicator.status==='Подготовлен';
  const driver={ id:String(Date.now()), name:buildDriverName(c), indicator:c.indicator, product:c.product, unit:c.unit, effectType:c.effectType, base:c.base, cost:c.cost, costMode:c.costMode||'single', calcMethod:c.calcMethod||'single', costProfile:c.costMode==='monthly'?(c.costProfile||[]):[c.cost], costLogicText:c.costLogicText||'', costFormula:c.costFormula||null, businessRationale:c.businessRationale||'', modelId:c.modelId||'', modelParams:c.modelParams||null, plAllocations:c.plAllocations||[], incrementMode:c.incrementMode||inferIncrementMode(c), channel:c.channel||'', segment:c.segment||'', status:needsApproval?'На согласовании':'Готов' };
  drivers.unshift(driver); flow=null; save(); renderRegistry(); renderDictionaries(); updateSummary(); renderProgress(); renderContextActions();
  addMessage('agent', needsApproval ? `Готово. «${driver.name}» создан и направлен методологу на согласование. Новый показатель «${indicator.name}» подготовлен и уже виден в реестре показателей.` : `Готово. «${driver.name}» создан со статусом «Готов».`);
  toast('Драйвер создан');
}
function cancelFlow() {
  flow=null; save(); addMessage('agent','Создание отменено. Можешь написать новый запрос.'); renderContextActions(); renderProgress();
}

function renderMessages() {
  const el=document.getElementById('messages');
  el.innerHTML=messages.map(m=>`<div class="message ${m.role} ${m.kind==='preview'?'preview-message':''}"><span class="label">${m.role==='user'?'Вы':'Агент'}</span>${escapeHtml(m.text)}</div>`).join('');
  requestAnimationFrame(()=>{ el.scrollTop=el.scrollHeight; });
}
function renderContextActions() {
  const el=document.getElementById('contextActions');
  if (!flow) { el.innerHTML=''; return; }
  if(flow.step==='newIndicator'){
    el.innerHTML=`<button data-flow-action="confirmNewIndicator">Продолжить</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='duplicate') {
    el.innerHTML=`<button data-flow-action="useExisting">Открыть драйвер</button><button data-flow-action="updateExisting" class="secondary">Изменить стоимость</button><button data-flow-action="differentAnalytics" class="secondary">Создать с другой аналитикой</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if(flow.step==='duplicateAnalytics'){
    el.innerHTML=`<button data-flow-action="changeProduct">Другой продукт</button><button data-flow-action="addChannel" class="secondary">Добавить / изменить канал</button><button data-flow-action="addSegment" class="secondary">Добавить / изменить сегмент</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='similar') {
    const sims=(flow.similarIds||[]).map(id=>drivers.find(d=>d.id===id)).filter(Boolean);
    el.innerHTML=sims.map(d=>`<div class="similar-card"><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(costSummary(d))} за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</span><button data-flow-action="useSimilar" data-driver-id="${d.id}">Использовать</button></div>`).join('')+`<button data-flow-action="continueNew" class="secondary">Ни один не подходит — создать новый</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='modelChoice') {
    el.innerHTML=`<button data-flow-value="Использовать модель">Использовать модель</button><button data-flow-value="Задать свою логику" class="secondary">Задать свою логику</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='modelConfirm') {
    el.innerHTML=`<button data-flow-action="confirmModel">✓ Подтвердить модель</button><button data-flow-action="redoModel" class="secondary">Изменить параметры</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='formulaConfirm') {
    el.innerHTML=`<button data-flow-action="confirmFormula">✓ Подтвердить расчёт</button><button data-flow-action="redoFormula" class="secondary">Изменить логику</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='preview') {
    el.innerHTML=`<button data-flow-action="confirm">✓ Создать</button><button data-flow-action="restart" class="secondary">Изменить</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else {
    el.innerHTML=(flow.options||[]).map(o=>`<button data-flow-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('') + `<button data-flow-action="cancel" class="quiet">Отмена</button>`;
  }
}
function renderProgress() {
  const el=document.getElementById('progress');
  if (!flow) { el.hidden=true; return; }
  const c=flow.candidate;
  const hasCost=c.costMode==='monthly'?(c.costProfile||[]).length>0:!!c.cost;
  const complete=[c.indicator,c.product,c.effectType,c.base&&hasCost].filter(Boolean).length;
  el.hidden=false;
  el.innerHTML=`<div><strong>Создание драйвера</strong><span>${complete}/4 параметров</span></div><div class="progress-track"><i style="width:${complete*25}%"></i></div><small>${escapeHtml(c.indicator||'Показатель не определён')} · ${escapeHtml(c.product||'Продукт не определён')}</small>`;
}
function renderRegistry() {
  const q=(document.getElementById('registrySearch')?.value||'').trim().toLowerCase();
  const list=drivers.filter(d=>!q || [d.name,d.indicator,d.product,d.effectType,d.status].join(' ').toLowerCase().includes(q));
  const el=document.getElementById('driverList');
  if (!list.length) { el.innerHTML='<div class="empty">Ничего не найдено</div>'; return; }
  el.innerHTML=`<div class="registry-table"><div class="registry-head"><span>Драйвер</span><span>Стоимость</span><span>Статус</span></div>${list.map(d=>{
    const expanded=expandedDriverId===d.id;
    return `<div class="registry-item ${expanded?'expanded':''}" data-driver-id="${d.id}">
      <button class="registry-row" type="button" aria-expanded="${expanded}">
        <span class="registry-main"><strong>${escapeHtml(d.name)}</strong><small class="registry-cost-mobile">${escapeHtml(costSummary(d))} за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</small></span>
        <span class="registry-cost"><strong>${escapeHtml(costSummary(d))}</strong><small>за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</small></span>
        <span class="badge ${d.status==='Готов'?'ready':['Требует согласования','На согласовании'].includes(d.status)?'approval':''}">${escapeHtml(d.status)}</span>
        <i class="row-chevron">⌄</i>
      </button>
      <div class="registry-expanded" ${expanded?'':'hidden'}>
        <div class="meta-grid">${meta('Способ расчёта',d.calcMethod==='model'?`Модель «${DRIVER_MODELS[d.modelId]?.title||availableModel(d)?.title||'расчёта'}»`:d.calcMethod==='rule'?'По заданному правилу':'Ручной ввод')}${d.calcMethod!=='model'&&d.costLogicText?meta('Логика расчёта',d.costLogicText):''}${d.calcMethod!=='model'&&d.businessRationale?meta('Бизнес-смысл',d.businessRationale):''}${(d.plAllocations||[]).length?meta('Статьи P&L',(d.plAllocations||[]).map(x=>x.article).join(', ')):''}${meta('Тип эффекта',d.effectType)}${meta('Показатель',d.indicator)}${meta('Продукт',d.product)}${meta('Единица измерения',d.unit)}${d.channel?meta('Канал',d.channel):''}${d.segment?meta('Сегмент',d.segment):''}</div>
        <div class="registry-actions"><button class="edit-driver-button" type="button" data-edit-driver="${d.id}">Открыть карточку</button>${d.calcMethod==='model'?`<button class="secondary-button" type="button" data-open-model="${d.modelId}">О модели</button>`:''}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}
function meta(label,value){ return `<div class="meta"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`; }
function updateSummary(){
  document.getElementById('driverCount').textContent=drivers.length;
  document.getElementById('draftCount').textContent=drivers.filter(d=>d.status==='Черновик').length;
  document.getElementById('readyCount').textContent=drivers.filter(d=>d.status==='Готов').length;
}
function renderModels(){
  const listEl=document.getElementById('modelList'); if(!listEl) return;
  const models=Object.values(DRIVER_MODELS).filter(m=>!focusedModelId || m.id===focusedModelId);
  const count=document.getElementById('modelCount'); if(count) count.textContent=focusedModelId?'1 модель':`${models.length} модели`;
  const showAll=document.getElementById('modelShowAll'); if(showAll) showAll.hidden=!focusedModelId;
  listEl.innerHTML=`<div class="model-registry">${models.map(model=>{
    const expanded=expandedModelId===model.id || focusedModelId===model.id;
    return `<div class="model-item ${expanded?'expanded':''}" data-model-id="${model.id}">
      <button class="model-row" type="button" aria-expanded="${expanded}">
        <span><strong>${escapeHtml(model.title)}</strong><small>${escapeHtml(model.calculation)}</small></span>
        <span class="model-products-short">${escapeHtml(model.products.slice(0,2).join(', '))}${model.products.length>2?` +${model.products.length-2}`:''}</span>
        <i class="row-chevron">⌄</i>
      </button>
      <div class="model-expanded" ${expanded?'':'hidden'}>
        <div class="model-logic-card"><span>Бизнес-логика</span><p>${escapeHtml(model.businessLogic)}</p></div>
        <div class="model-detail-grid">
          <div><span>Продукты</span><strong>${escapeHtml(model.products.join(', '))}</strong></div>
          <div><span>Статьи P&L</span><strong>${escapeHtml(model.plArticles.join(', '))}</strong></div>
        </div>
        <div class="model-links-list">${model.links.map(link=>`<div class="model-link-card"><strong>${escapeHtml(link.indicator)}</strong><span>Для расчёта: ${escapeHtml(link.params.join(', '))}</span></div>`).join('')}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}
function renderDictionaries(){
  document.getElementById('indicatorDict').innerHTML=indicatorRegistry.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.unit||'—')}</td><td><span class="table-status ${x.status==='Подготовлен'?'approval':''}">${escapeHtml(x.status)}</span></td></tr>`).join('');
  document.getElementById('productDict').innerHTML=PRODUCTS.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активен</span></td></tr>`).join('');
  const pl=document.getElementById('plArticleDict'); if(pl) pl.innerHTML=PL_ARTICLES.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активна</span></td></tr>`).join('');
  document.getElementById('indicatorCount').textContent=`${indicatorRegistry.length} записей`;
  document.getElementById('productCount').textContent=`${PRODUCTS.length} записей`;
  const pc=document.getElementById('plArticleCount'); if(pc) pc.textContent=`${PL_ARTICLES.length} записей`;
}
function switchTab(name){
  closeDriver();
  if(name==='models') renderModels();
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===name));
}
function getProfileFromEditor(){
  return [...document.querySelectorAll('#editProfileGrid input[data-profile-month]')].map(x=>x.value.trim()).filter(v=>v!=='' && Number.isFinite(moneyNumber(v))).slice(0,36);
}
function renderProfileEditor(profile=[]){
  const grid=document.getElementById('editProfileGrid'); if(!grid) return;
  const values=(profile||[]).length ? profile : [''];
  grid.innerHTML=values.map((v,i)=>`<label class="profile-row"><span>Месяц ${i+1}</span><input data-profile-month="${i}" inputmode="decimal" value="${escapeHtml(v)}" ${document.getElementById('editCalcMethod')?.value==='model'?'readonly':''} /></label>`).join('');
  grid.classList.add('collapsed');
  document.getElementById('toggleProfileRows').textContent=values.length>12?'Показать все':'Все месяцы показаны';
  document.getElementById('toggleProfileRows').hidden=values.length<=12;
  updateProfileTotal();
}
function renderPlAllocationEditor(allocations=[]){
  const el=document.getElementById('editPlAllocations'); if(!el) return;
  const list=(allocations||[]); if(!list.length){ el.innerHTML='<div class="empty">Статьи пока не заданы</div>'; return; }
  const months=Math.max(...list.map(a=>(a.profile||[]).length),1);
  const visible=Math.min(months,3);
  const method=document.getElementById('editCalcMethod')?.value;
  const isModel=method==='model';
  const isComputed=isModel||method==='rule';
  const rows=Array.from({length:months},(_,i)=>`<tr class="pl-month-row ${i>=visible?'extra-month':''}" ${i>=visible?'hidden':''}><td>${i+1}</td>${list.map((a,idx)=>`<td>${isComputed?`<span class="pl-static">${compactRub(a.profile?.[i]??0)}</span>`:`<input data-pl-row-index="${idx}" data-pl-month="${i}" inputmode="decimal" value="${escapeHtml(a.profile?.[i]??'0')}">`}</td>`).join('')}<td><strong>${compactRub(list.reduce((sum,a)=>sum+moneyNumber(a.profile?.[i]),0))}</strong></td></tr>`).join('');
  el.innerHTML=`<div class="pl-combined-wrap"><table class="pl-combined ${isComputed?'model-table':''}"><thead><tr><th>Мес.</th>${list.map(a=>`<th title="${escapeHtml(a.article)}">${escapeHtml(shortArticleName(a.article))}</th>`).join('')}<th>Итого</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Итого</th>${list.map(a=>`<th>${compactRub(profileTotal(a.profile||[]))}</th>`).join('')}<th>${compactRub(profileTotal(profileFromPlAllocations(list)))}</th></tr></tfoot></table></div>${months>visible?'<button type="button" class="secondary-button inline-button" id="togglePlMonths">Показать все месяцы</button>':''}`;
  document.getElementById('togglePlMonths')?.addEventListener('click',e=>{ const hidden=[...el.querySelectorAll('.extra-month')].some(r=>r.hidden); el.querySelectorAll('.extra-month').forEach(r=>r.hidden=!hidden); e.currentTarget.textContent=hidden?'Скрыть лишние месяцы':'Показать все месяцы'; });
}
function getPlAllocationsFromEditor(){
  const id=document.getElementById('editId')?.value; const original=drivers.find(x=>x.id===id)?.plAllocations||[];
  const headers=original.map(a=>a.article);
  if(!headers.length) return [];
  return headers.map((article,idx)=>({article,profile:[...document.querySelectorAll(`#editPlAllocations input[data-pl-row-index="${idx}"]`)].map(x=>x.value.trim()||'0')}));
}
function profileFromPlAllocations(allocations=[]){
  const months=Math.max(0,...allocations.map(a=>(a.profile||[]).length));
  return sumAllocationProfiles(allocations,months);
}
function updatePlSummary(){}
function openDriver(id){
  const d=drivers.find(x=>x.id===id); if(!d)return;
  document.getElementById('editId').value=d.id;
  document.getElementById('editName').value=d.name;
  document.getElementById('editIndicator').value=d.indicator;
  document.getElementById('editProduct').value=d.product;
  document.getElementById('editEffectType').value=d.effectType;
  const commonUnits=['шт.','₽','%'];
  const unitSelect=document.getElementById('editUnit');
  const unitOther=document.getElementById('editUnitOther');
  unitSelect.value=commonUnits.includes(d.unit) ? d.unit : 'other';
  unitOther.hidden=unitSelect.value!=='other';
  unitOther.value=unitSelect.value==='other' ? (d.unit||'') : '';
  document.getElementById('editChannel').value=d.channel||'';
  document.getElementById('editSegment').value=d.segment||'';
  document.getElementById('editIncrementMode').value=d.incrementMode||inferIncrementMode(d);
  document.getElementById('editBase').value=d.base||'';
  const calcSelect=document.getElementById('editCalcMethod');
  const modelTitle=DRIVER_MODELS[d.modelId]?.title||availableModel(d)?.title;
  const modelOpt=calcSelect.querySelector('option[value="model"]'); if(modelOpt) modelOpt.textContent=modelTitle?`Модель «${modelTitle}»`:'По готовой модели';
  calcSelect.value=d.calcMethod || (d.costMode==='single'?'manual':d.costFormula?'rule':'manual');
  document.getElementById('editChannelWrap').hidden=!d.channel;
  document.getElementById('editSegmentWrap').hidden=!d.segment;
  document.getElementById('editCost').value=d.costMode==='single'?(d.cost||''):'';
  document.getElementById('editCostLogic').value=d.costLogicText||'';
  document.getElementById('editBusinessRationale').value=d.businessRationale||'';
  const mp=d.modelParams||{};
  document.getElementById('editAvgCheck').value=mp.avgCheck||'';
  document.getElementById('editMargin').value=mp.margin||'';
  document.getElementById('editRisk').value=mp.risk||'';
  document.getElementById('editRepayment').value=mp.repayment||'';
  document.getElementById('editCreditTermYears').value=mp.creditTermYears||'';
  document.getElementById('editConversion').value=mp.conversion||'';
  document.getElementById('editHorizon').value=(d.modelId==='credit_income_v2'?creditHorizonMonths(mp):(mp.horizon||((d.costProfile||[]).length||'')));
  renderProfileEditor(d.costMode==='monthly'?(d.costProfile||[]):[]);
  renderPlAllocationEditor(d.plAllocations||[]);
  syncCostEditor();
  document.getElementById('editStatus').value=d.status;
  document.getElementById('detailHeading').textContent=d.name;
  document.getElementById('approveDriver').hidden=d.status!=='На согласовании';
  const badge=document.getElementById('detailBadge'); badge.textContent=d.status; badge.className='badge '+(d.status==='Готов'?'ready':['Требует согласования','На согласовании'].includes(d.status)?'approval':'');
  document.getElementById('registryListView').hidden=true;
  document.getElementById('driverDetailView').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
function closeDriver(){
  document.getElementById('driverDetailView').hidden=true;
  document.getElementById('registryListView').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
for(const tab of document.querySelectorAll('.tab')) tab.addEventListener('click',()=>{ if(tab.dataset.tab==='models'){ focusedModelId=null; expandedModelId=null; } switchTab(tab.dataset.tab); });
document.getElementById('composer').addEventListener('submit',e=>{
  e.preventDefault(); const input=document.getElementById('prompt'); const text=input.value.trim(); if(!text)return;
  addMessage('user',text); input.value='';
  setTimeout(()=>processUserText(text),80);
});
document.getElementById('contextActions').addEventListener('click',e=>{
  const value=e.target.dataset.flowValue; const action=e.target.dataset.flowAction;
  if(value){ addMessage('user',value); handleFlowAnswer(value); return; }
  if(!action) return;
  const actionLabels={
    cancel:'Отмена', confirmNewIndicator:'Продолжить', confirm:'Создать драйвер', differentAnalytics:'Создать с другой аналитикой', changeProduct:'Другой продукт', addChannel:'Добавить канал', addSegment:'Добавить сегмент', updateExisting:'Изменить стоимость',
    continueNew:'Создать новый драйвер', confirmFormula:'Подтвердить расчёт', confirmModel:'Подтвердить модель',
    redoModel:'Изменить параметры', redoFormula:'Изменить логику', useExisting:'Открыть существующий драйвер', restart:'Изменить'
  };
  if(action==='useSimilar'){
    const d=drivers.find(x=>x.id===e.target.dataset.driverId); addMessage('user',d?`Использовать «${d.name}»`:'Использовать найденный драйвер');
  } else if(actionLabels[action]) addMessage('user',actionLabels[action]);

  if(action==='cancel') cancelFlow();
  else if(action==='confirmNewIndicator'){ flow.newIndicatorConfirmed=true; flow.step=''; save(); continueFlow(); }
  else if(action==='confirm') finalizeDriver();
  else if(action==='differentAnalytics'){ flow.step='duplicateAnalytics'; save(); renderContextActions(); }
  else if(action==='changeProduct'){ flow.duplicateId=null; flow.duplicateChecked=false; flow.candidate.product=''; ask('product','Выбери другой продукт для нового драйвера.',PRODUCTS); }
  else if(action==='addChannel'){ flow.duplicateId=null; flow.duplicateChecked=false; ask('channel','Укажи канал, который отличает новый драйвер.'); }
  else if(action==='addSegment'){ flow.duplicateId=null; flow.duplicateChecked=false; ask('segment','Укажи сегмент, который отличает новый драйвер.'); }
  else if(action==='continueNew'){ flow.similarIds=[]; flow.step=''; save(); continueFlow(); }
  else if(action==='useSimilar'){ const id=e.target.dataset.driverId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='confirmFormula'){ flow.step=''; save(); continueFlow(); }
  else if(action==='confirmModel'){ flow.step=''; save(); continueFlow(); }
  else if(action==='redoModel'){ flow.candidate.costProfile=[]; flow.candidate.cost=''; flow.candidate.modelParams={}; flow.step=''; save(); continueFlow(); }
  else if(action==='redoFormula'){ flow.candidate.costProfile=[]; flow.candidate.costFormula=null; flow.candidate.costLogicText=''; flow.step=''; save(); continueFlow(); }
  else if(action==='updateExisting'){ const id=flow.duplicateId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='useExisting'){ const id=flow.duplicateId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='restart'){ const original=flow.original; flow=null; save(); addMessage('agent','Хорошо. Напиши уточнённый запрос заново — текущую карточку я не создал.'); document.getElementById('prompt').value=original; document.getElementById('prompt').focus(); renderContextActions(); renderProgress(); }
});
document.getElementById('modelList')?.addEventListener('click',e=>{ const row=e.target.closest('.model-row'); if(!row)return; const item=row.closest('[data-model-id]'); expandedModelId=expandedModelId===item.dataset.modelId && !focusedModelId ? null : item.dataset.modelId; renderModels(); });
document.getElementById('modelShowAll')?.addEventListener('click',()=>{ focusedModelId=null; expandedModelId=null; renderModels(); });
document.getElementById('registrySearch').addEventListener('input',renderRegistry);
document.getElementById('driverList').addEventListener('click',e=>{
  const modelLink=e.target.closest('[data-open-model]');
  if(modelLink){ e.stopPropagation(); closeDriver(); focusedModelId=modelLink.dataset.openModel; expandedModelId=focusedModelId; switchTab('models'); return; }
  const edit=e.target.closest('[data-edit-driver]');
  if(edit){ e.stopPropagation(); openDriver(edit.dataset.editDriver); return; }
  const row=e.target.closest('.registry-row');
  if(!row)return;
  const item=row.closest('[data-driver-id]');
  expandedDriverId=expandedDriverId===item.dataset.driverId ? null : item.dataset.driverId;
  renderRegistry();
});
document.getElementById('backToRegistry').addEventListener('click',closeDriver);
document.getElementById('approveDriver').addEventListener('click',()=>{
  const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  if(!String(d.cost||'').trim()){ toast('Сначала укажи стоимость'); return; }
  d.status='Готов'; const ind=indicatorRecord(d.indicator); if(ind && ind.status==='Подготовлен') ind.status='Активен';
  save(); renderAll(); openDriver(id); toast('Драйвер согласован');
});
document.getElementById('driverForm').addEventListener('submit',e=>{
  e.preventDefault(); const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  const calcMethod=document.getElementById('editCalcMethod').value;
  const monthly=true;
  let costProfile=getProfileFromEditor();
  let editedAllocations=getPlAllocationsFromEditor();
  if((calcMethod==='model'||calcMethod==='rule') && !editedAllocations.length) editedAllocations=d.plAllocations||[];
  if(editedAllocations.length) costProfile=profileFromPlAllocations(editedAllocations);
  const cost=costProfile.length?String(profileTotal(costProfile)):document.getElementById('editCost').value.trim();
  const status=document.getElementById('editStatus').value;
  if(status==='Готов' && !cost){ toast('Сначала укажи стоимость'); return; }
  const selectedUnit=document.getElementById('editUnit').value;
  const unit=selectedUnit==='other' ? document.getElementById('editUnitOther').value.trim() : selectedUnit;
  if(!unit){ toast('Укажи единицу измерения'); return; }
  const modelParams=calcMethod==='model'?{...(d.modelParams||{}),avgCheck:document.getElementById('editAvgCheck').value.trim(),margin:document.getElementById('editMargin').value.trim(),risk:document.getElementById('editRisk').value.trim(),repayment:document.getElementById('editRepayment').value.trim(),creditTermYears:document.getElementById('editCreditTermYears').value.trim(),conversion:document.getElementById('editConversion').value.trim(),horizon:Number(document.getElementById('editHorizon').value||costProfile.length||0)}:null;
  const updatedIndicator=document.getElementById('editIndicator').value.trim(), updatedProduct=document.getElementById('editProduct').value.trim(), updatedChannel=document.getElementById('editChannel').value.trim(), updatedSegment=document.getElementById('editSegment').value.trim();
  Object.assign(d,{name:buildDriverName({indicator:updatedIndicator,product:updatedProduct,channel:updatedChannel,segment:updatedSegment}),indicator:updatedIndicator,product:updatedProduct,effectType:document.getElementById('editEffectType').value,unit,channel:updatedChannel,segment:updatedSegment,base:document.getElementById('editBase').value,cost,costMode:monthly?'monthly':'single',calcMethod,costProfile:monthly?costProfile:[cost],costLogicText:document.getElementById('editCostLogic').value.trim(),businessRationale:document.getElementById('editBusinessRationale').value.trim(),modelId:calcMethod==='model'?(availableModel({indicator:updatedIndicator,product:updatedProduct})?.id||d.modelId||''):'' ,modelParams,plAllocations:editedAllocations,incrementMode:document.getElementById('editIncrementMode').value,status});
  if(calcMethod==='model'){
    const result=calculateModel(d); if(result.profile.length){ d.costProfile=result.profile; d.plAllocations=result.allocations; d.cost=String(profileTotal(result.profile)); d.costMode=result.profile.length>1?'monthly':'single'; }
  }
  save();renderRegistry();updateSummary();closeDriver();toast('Изменения сохранены');
});
function updateProfileTotal(){ const p=getProfileFromEditor(); const el=document.getElementById('editProfileTotal'); if(el) el.textContent=p.length?`Итого за ${p.length} мес.: ${formatMoney(profileTotal(p))} ₽`:''; }
function syncCostEditor(){
  const method=document.getElementById('editCalcMethod').value;
  const isModel=method==='model';
  document.getElementById('singleCostWrap').hidden=true;
  document.getElementById('profileCostWrap').hidden=method!=='manual';
  document.getElementById('logicWrap').hidden=isModel;
  document.getElementById('modelParamsWrap').hidden=!isModel;
  document.getElementById('addPlArticle').hidden=method!=='manual';
  const currentId=document.getElementById('editId')?.value;
  const currentDriver=drivers.find(x=>x.id===currentId);
  const model=DRIVER_MODELS[currentDriver?.modelId] || availableModel({indicator:document.getElementById('editIndicator').value.trim(),product:document.getElementById('editProduct').value.trim()});
  document.getElementById('avgCheckWrap').hidden=!(model?.id==='credit_income_v2' && document.getElementById('editIndicator').value.trim()==='Количество выдач');
  document.getElementById('creditParamsWrap').hidden=model?.id!=='credit_income_v2';
  document.getElementById('conversionWrap').hidden=model?.id!=='insurance_income_v1';
  const sourceNote=document.getElementById('modelSourceNote'); if(sourceNote && isModel) sourceNote.textContent='Источник: прогнозная модель · среднее за последние 3 месяца прогнозного года.';
  if(document.getElementById('editHorizon')) document.getElementById('editHorizon').readOnly=true;
  const sourceLocked = isModel && !!(document.getElementById('editId')?.value && drivers.find(x=>x.id===document.getElementById('editId').value)?.modelParams?.sources);
  ['editAvgCheck','editMargin','editRisk','editRepayment','editCreditTermYears','editConversion'].forEach(id=>{ const x=document.getElementById(id); if(x) x.readOnly=sourceLocked; });
  const business=document.getElementById('businessLogicSection'); if(business) business.hidden=isModel;
  const modelLink=document.getElementById('detailModelLink'); if(modelLink){ modelLink.hidden=!isModel; modelLink.dataset.openModel=model?.id||''; modelLink.textContent=model?`Открыть модель «${model.title}»`:'Открыть модель'; }
  // В модельном драйвере методика и аналитика фиксированы: пользователь корректирует только исходные значения модели.
  ['editName','editIndicator','editProduct','editChannel','editSegment'].forEach(id=>{ const x=document.getElementById(id); if(x) x.readOnly=isModel; });
  ['editEffectType','editUnit','editBase','editCalcMethod','editIncrementMode'].forEach(id=>{ const x=document.getElementById(id); if(x) x.disabled=isModel; });
  updateProfileTotal();
}
document.getElementById('editCalcMethod').addEventListener('change',syncCostEditor);
document.getElementById('editCreditTermYears')?.addEventListener('input',()=>{
  const term=moneyNumber(document.getElementById('editCreditTermYears').value);
  document.getElementById('editHorizon').value=term?Math.min(36,Math.round(term*12)):'';
});
document.getElementById('addPlArticle').addEventListener('click',()=>{ const current=getPlAllocationsFromEditor(); const months=Math.max(1,getProfileFromEditor().length); current.push({article:'',profile:Array(months).fill('0')}); renderPlAllocationEditor(current); });
document.getElementById('editPlAllocations').addEventListener('input',updatePlSummary);

document.getElementById('editProfileGrid').addEventListener('input',updateProfileTotal);
document.getElementById('addProfileMonth').addEventListener('click',()=>{
  const p=getProfileFromEditor(); if(p.length>=36){toast('Максимум 36 месяцев');return;} p.push(''); renderProfileEditor(p);
});
document.getElementById('toggleProfileRows').addEventListener('click',()=>{
  const grid=document.getElementById('editProfileGrid'); grid.classList.toggle('collapsed'); document.getElementById('toggleProfileRows').textContent=grid.classList.contains('collapsed')?'Показать все':'Свернуть';
});
document.getElementById('recalcModel').addEventListener('click',()=>{
  const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  const temp={indicator:document.getElementById('editIndicator').value.trim(),product:document.getElementById('editProduct').value.trim(),base:document.getElementById('editBase').value,modelParams:{avgCheck:document.getElementById('editAvgCheck').value.trim(),margin:document.getElementById('editMargin').value.trim(),risk:document.getElementById('editRisk').value.trim(),repayment:document.getElementById('editRepayment').value.trim(),creditTermYears:document.getElementById('editCreditTermYears').value.trim(),conversion:document.getElementById('editConversion').value.trim(),horizon:Number(document.getElementById('editHorizon').value||0)}};
  if(temp.modelParams.creditTermYears) temp.modelParams.horizon=creditHorizonMonths(temp.modelParams);
  const result=calculateModel(temp); const p=result.profile; if(!p.length){toast('Заполни параметры модели');return;}
  renderProfileEditor(p); renderPlAllocationEditor(result.allocations); document.getElementById('editCostLogic').value=modelLogic(temp); document.getElementById('editBusinessRationale').value=modelBusinessRationale(temp); toast('Профиль пересчитан');
});
document.getElementById('editUnit').addEventListener('change',e=>{
  const other=document.getElementById('editUnitOther');
  other.hidden=e.target.value!=='other';
  if(!other.hidden) setTimeout(()=>other.focus(),50);
});
document.getElementById('detailModelLink')?.addEventListener('click',e=>{ const id=e.currentTarget.dataset.openModel; closeDriver(); focusedModelId=id; expandedModelId=id; switchTab('models'); });
document.getElementById('deleteDriver').addEventListener('click',()=>{
  const id=document.getElementById('editId').value; if(!confirm('Удалить этот драйвер из локального реестра?'))return;
  drivers=drivers.filter(x=>x.id!==id);save();renderRegistry();updateSummary();closeDriver();toast('Драйвер удалён');
});

document.getElementById('testLlm')?.addEventListener('click',testLlmConnection);
function endCurrentSession(){
  const meaningful=messages.filter(m=>m.id!=='hello');
  if(meaningful.length){
    const history=load(SESSION_HISTORY_KEY,[]);
    history.unshift({id:String(Date.now()),endedAt:new Date().toISOString(),messages:clone(messages)});
    localStorage.setItem(SESSION_HISTORY_KEY,JSON.stringify(history.slice(0,20)));
  }
  flow=null; messages=clone(seedMessages); save(); renderMessages(); renderContextActions(); renderProgress();
  document.getElementById('prompt').value='';
  toast('Сессия завершена');
  window.scrollTo({top:0,behavior:'smooth'});
}
document.getElementById('endSession').addEventListener('click',()=>{
  if(messages.length<=1 && !flow){ toast('Сессия уже пустая'); return; }
  if(confirm('Завершить текущую сессию? Переписка сохранится локально, а чат очистится.')) endCurrentSession();
});

document.getElementById('resetButton').addEventListener('click',()=>{
  if(!confirm('Сбросить реестр, диалог и незавершённое создание?'))return;
  drivers=clone(seedDrivers);messages=clone(seedMessages);flow=null;indicatorRegistry=Object.entries(INDICATOR_META).map(([name,unit])=>({name,unit,status:'Активен'}));save();renderAll();toast('Демо-данные восстановлены');
});

// iPhone/PWA: при открытой клавиатуре фиксируем оболочку в visual viewport,
// а прокручиваем только переписку — основной экран больше не прыгает вниз.
function syncVisualViewport(){
  const vv=window.visualViewport;
  const h=vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--visual-height', `${h}px`);
  const prompt=document.getElementById('prompt');
  const isKeyboard=prompt===document.activeElement && window.innerHeight-h>120;
  document.body.classList.toggle('keyboard-open', isKeyboard);
  if(isKeyboard){
    requestAnimationFrame(()=>{
      const messagesEl=document.getElementById('messages');
      messagesEl.scrollTop=messagesEl.scrollHeight;
    });
  }
}
window.visualViewport?.addEventListener('resize',syncVisualViewport);
document.getElementById('prompt').addEventListener('focus',()=>setTimeout(syncVisualViewport,120));
document.getElementById('prompt').addEventListener('blur',()=>{document.body.classList.remove('keyboard-open');setTimeout(syncVisualViewport,80)});
syncVisualViewport();


const loginForm=document.getElementById('loginForm');
loginForm?.addEventListener('submit',async e=>{
  e.preventDefault();
  const input=document.getElementById('appPassword'); const btn=document.getElementById('loginButton'); const err=document.getElementById('authError');
  const password=input?.value||''; if(!password)return;
  if(btn){btn.disabled=true;btn.textContent='Вхожу…';} if(err) err.hidden=true;
  try{
    await loginWithPassword(password);
    if(input) input.value='';
    hideAuthGate();
    renderAll();
  }catch(ex){
    if(err){err.textContent=ex.message==='Неверный пароль'?'Неверный пароль. Попробуйте ещё раз.':'Не удалось войти. Проверьте соединение и попробуйте снова.';err.hidden=false;}
  }finally{ if(btn){btn.disabled=false;btn.textContent='Войти';} }
});
document.getElementById('togglePassword')?.addEventListener('click',e=>{
  const input=document.getElementById('appPassword'); if(!input)return; const show=input.type==='password'; input.type=show?'text':'password'; e.currentTarget.textContent=show?'Скрыть':'Показать';
});
document.getElementById('logoutButton')?.addEventListener('click',()=>{
  clearAuth(); showAuthGate('Вы вышли на этом устройстве.');
});

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
function renderAll(){renderMessages();renderContextActions();renderProgress();renderRegistry();renderModels();renderDictionaries();renderLlmSettings();updateSummary();}
if(authStillValid()){ hideAuthGate(); renderAll(); } else { clearAuth(); showAuthGate(''); }

function openSettingsModal(){ const m=document.getElementById('settingsModal'); if(m){m.hidden=false;document.body.classList.add('modal-open');} }
function closeSettingsModal(){ const m=document.getElementById('settingsModal'); if(m){m.hidden=true;document.body.classList.remove('modal-open');} }
document.getElementById('settingsGear')?.addEventListener('click',openSettingsModal);
document.getElementById('closeSettings')?.addEventListener('click',closeSettingsModal);
document.querySelector('[data-close-settings]')?.addEventListener('click',closeSettingsModal);
