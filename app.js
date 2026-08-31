const APP_VERSION = globalThis.DRIVER_AGENT_VERSION || '7.1';
const REGISTRY_KEY = 'driver-agent.pwa.registry.v7';
const MODEL_COST_REPAIR_KEY = 'driver-agent.pwa.model-cost-repair.v5.9';
const MESSAGES_KEY = 'driver-agent.pwa.messages.v2';
const FLOW_KEY = 'driver-agent.pwa.flow.v2';
const COMBINATION_REGISTRY_KEY = 'driver-agent.pwa.combinations.v1';
const SESSION_HISTORY_KEY = 'driver-agent.pwa.session-history.v1';
const INDICATOR_REGISTRY_KEY = 'driver-agent.pwa.indicators.v1';
const LLM_MODEL = 'openrouter/free';
const LLM_API_URL = 'https://driver-agent-api.plombastik.workers.dev';
const AUTH_TOKEN_KEY = 'driver-agent.auth.token.v1';
const AUTH_EXPIRES_KEY = 'driver-agent.auth.expires.v1';
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || '';
let lastCreatedDriverId = null;
let llmRequestSeq = 0;
let activeLlmController = null;
const LLM_REQUEST_TIMEOUT_MS = 30000;
const LLM_MAX_ATTEMPTS = 2;
let lastLlmDiagnostic = JSON.parse(localStorage.getItem('driver-agent.llm-diagnostic.v1') || 'null');


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
for (const item of indicatorRegistry){
  if(/^(?:оборот|обороты|объем оборота|объём оборота|объем оборотов|объём оборотов)$/.test(normalizeText(item.name))){ item.name='Объём оборотов'; item.unit='₽'; }
}
indicatorRegistry=indicatorRegistry.filter((x,i,a)=>a.findIndex(y=>normalizeText(y.name)===normalizeText(x.name))===i);
function indicatorNames(){ return indicatorRegistry.map(x=>x.name); }
function indicatorRecord(name){ const c=canonicalFromList(name, indicatorNames()); return c ? indicatorRegistry.find(x=>x.name===c) : null; }


// v5.4: отдельный масштабный retrieval-каталог показателей. Он не показывается
// бизнес-пользователю и имитирует промышленный справочник с близкими названиями.
const INDICATOR_ALIASES = {
  'Количество выдач':['выдачи','число выдач','количество кредитных выдач'],
  'Объём выдач':['объем выдач','сумма выдач','выданный объем'],
  'Количество клиентов':['клиенты','число клиентов','клиентская база'],
  'Объём сборов':['объем сборов','сборы','страховые сборы'],
  'Количество продаж':['продажи','число продаж'],
  'Количество бонусов':['бонусы','число бонусов'],
  'Доля рынка':['рыночная доля','market share'],
  'Уровень проникновения':['проникновение','penetration','уровень пенетрации']
};
const INDICATOR_SUBJECTS=['активных клиентов','новых клиентов','уникальных клиентов','клиентов с продуктом','транзакций','операций','платежей','переводов','заявок','одобрений','активаций','договоров','счетов','карт','покупок','заказов','обращений','лидов','продаж','кросс-продаж','пролонгаций','отказов','просрочек','возвратов','погашений','выдач','сборов','комиссий','остатков','оборота'];
const INDICATOR_PREFIXES=[['Количество','шт.'],['Объём','₽'],['Среднее количество','шт.'],['Средний объём','₽'],['Доля','%']];
function buildScaleIndicators(){
  const out=Object.entries(INDICATOR_META).map(([name,unit],i)=>({id:`core-i-${i+1}`,name,unit,aliases:INDICATOR_ALIASES[name]||[],synthetic:false,status:'Активен'}));
  let n=1;
  for(const [prefix,unit] of INDICATOR_PREFIXES){
    for(const subject of INDICATOR_SUBJECTS){
      if(out.length>=180) break;
      const name=`${prefix} ${subject}`;
      if(!out.some(x=>normalizeText(x.name)===normalizeText(name))) out.push({id:`scale-i-${String(n++).padStart(3,'0')}`,name,unit,aliases:[],synthetic:true,status:'Активен'});
    }
  }
  const extras=[['Активная клиентская база','шт.'],['Средний чек','₽'],['Средний остаток','₽'],['Конверсия','%'],['Уровень одобрения','%'],['Уровень отказов','%'],['Коэффициент удержания','%'],['Коэффициент оттока','%'],['Доход на клиента','₽'],['Комиссионный доход','₽']];
  for(const [name,unit] of extras){ if(out.length<200&&!out.some(x=>normalizeText(x.name)===normalizeText(name))) out.push({id:`scale-i-${String(n++).padStart(3,'0')}`,name,unit,aliases:[],synthetic:true,status:'Активен'}); }
  while(out.length<200){ const i=out.length+1; out.push({id:`scale-i-${String(n++).padStart(3,'0')}`,name:`Тестовый показатель ${String(i).padStart(3,'0')}`,unit:'шт.',aliases:[],synthetic:true,status:'Активен'}); }
  return out.slice(0,200);
}
const SCALE_INDICATORS=buildScaleIndicators();
function resolveIndicatorCandidates(query,limit=5){ return resolveCandidates(query,SCALE_INDICATORS,limit,0.44); }
function exactIndicatorAlias(query){
  const q=normalizeText(query);
  for(const name of indicatorNames()){
    if(normalizeText(name)===q) return name;
    for(const a of (INDICATOR_ALIASES[name]||[])) if(normalizeText(a)===q) return name;
  }
  return '';
}
function indicatorDecision(query){
  const exact=exactIndicatorAlias(query);
  if(exact) return {status:'auto',value:exact,confidence:1,candidates:[]};
  const c=resolveIndicatorCandidates(query,5);
  if(!c.length) return {status:'none',candidates:[]};
  const top=c[0], second=c[1];
  if(top.score>=0.90 && (!second || top.score-second.score>=0.10)) return {status:'auto',value:top.entity.name,confidence:top.score,candidates:c};
  if(top.score>=0.68) return {status:'clarify',confidence:top.score,candidates:c.filter(x=>x.score>=Math.max(0.62,top.score-0.12)).slice(0,5)};
  return {status:'none',confidence:top.score,candidates:c};
}
const PRODUCTS = ['Ипотечное кредитование','Потребительский кредит','Автокредит','Образовательный кредит','Дебетовые карты','Кредитные карты','Платежи','Переводы','ОСАГО','КАСКО','Накопительные счета','Срочные счета'];


// Масштабируемый слой разрешения НСИ: в промышленном варианте эти каталоги
// должны приходить из backend/MDM. В прототипе держим 1500 продуктов,
// 100 каналов и 50 сегментов в памяти, чтобы проверять поведение на масштабе.
const PRODUCT_ALIASES = {
  'Ипотечное кредитование':['ипотека','ипотечный кредит','ипотечное кредитование'],
  'Потребительский кредит':['потреб','потребкредит','потребительский кредит','кредит наличными'],
  'Автокредит':['автокредит','авто кредит','кредит на авто'],
  'Образовательный кредит':['образовательный кредит','кредит на образование'],
  'Дебетовые карты':['дебетовая карта','дебетовые карты','дебетовка'],
  'Кредитные карты':['кредитная карта','кредитные карты','кредитка','кредитки'],
  'Платежи':['платеж','платежи','оплата'],
  'Переводы':['перевод','переводы'],
  'ОСАГО':['осаго','автогражданка'],
  'КАСКО':['каско'],
  'Накопительные счета':['накопительный счет','накопительные счета','накопительный счёт'],
  'Срочные счета':['срочный счет','срочные счета','вклад','депозит']
};
const PRODUCT_FAMILIES=['Кредитование','Карты','Платежи','Переводы','Сбережения','Инвестиции','Страхование','Эквайринг','Лизинг','Факторинг','Зарплатные решения','Торговое финансирование','Сервисы для бизнеса','Премиальное обслуживание','Доверительное управление'];
const PRODUCT_MODIFIERS=['Базовый','Премиум','Цифровой','Партнёрский','Корпоративный','Массовый','Онлайн','Классический','Индивидуальный','Специальный','Семейный','Молодёжный','Зарплатный','Международный','Региональный','Технологический'];
function buildScaleProducts(){
  const out=PRODUCTS.map((name,i)=>({id:`core-${i+1}`,name,aliases:PRODUCT_ALIASES[name]||[],group: ['ОСАГО','КАСКО'].includes(name)?'Страхование':(['Ипотечное кредитование','Потребительский кредит','Автокредит','Образовательный кредит'].includes(name)?'Кредитование':'Базовые продукты'),synthetic:false}));
  let n=1;
  for(const family of PRODUCT_FAMILIES){
    for(const mod of PRODUCT_MODIFIERS){
      for(let v=1; v<=7 && out.length<1500; v++){
        const name=`${family} ${mod} ${String(v).padStart(2,'0')}`;
        if(!out.some(x=>x.name===name)) out.push({id:`scale-p-${String(n++).padStart(4,'0')}`,name,aliases:[],group:family,synthetic:true});
      }
      if(out.length>=1500) break;
    }
    if(out.length>=1500) break;
  }
  while(out.length<1500){ const i=out.length+1; out.push({id:`scale-p-${String(n++).padStart(4,'0')}`,name:`Банковский продукт ${String(i).padStart(4,'0')}`,aliases:[],group:'Прочие',synthetic:true}); }
  return out.slice(0,1500);
}
const SCALE_PRODUCTS=buildScaleProducts();
const CORE_CHANNELS=['Онлайн','Мобильное приложение','Партнёрский','Отделение','Колл-центр','Интернет-банк','API','Маркетплейс','Банкомат','Терминал'];
const SCALE_CHANNELS=[...CORE_CHANNELS,...Array.from({length:90},(_,i)=>`Канал ${String(i+11).padStart(3,'0')}`)].slice(0,100);
const CORE_SEGMENTS=['Массовый','Премиальный','Малый бизнес','Средний бизнес','Крупный бизнес','Молодёжь','Семьи','Зарплатные клиенты'];
const SCALE_SEGMENTS=[...CORE_SEGMENTS,...Array.from({length:42},(_,i)=>`Сегмент ${String(i+9).padStart(2,'0')}`)].slice(0,50);

function nsTokenize(value){
  return normalizeText(value).replace(/[^a-zа-я0-9 ]/gi,' ').split(/\s+/).filter(Boolean).map(t=>t
    .replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ам|ям|ах|ях|ов|ев|ей|ом|ем|у|ю|а|я|ы|и|е|о)$/i,''));
}
function editSimilarity(a,b){
  a=String(a||''); b=String(b||''); if(a===b) return 1; if(!a||!b) return 0;
  if(a.length===b.length){ for(let i=0;i<a.length-1;i++){ if(a[i]!==b[i] && a[i]===b[i+1] && a[i+1]===b[i] && a.slice(0,i)===b.slice(0,i) && a.slice(i+2)===b.slice(i+2)) return 0.92; } }
  const prev=Array.from({length:b.length+1},(_,i)=>i), cur=new Array(b.length+1);
  for(let i=1;i<=a.length;i++){ cur[0]=i; for(let j=1;j<=b.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); for(let j=0;j<=b.length;j++) prev[j]=cur[j]; }
  return 1-prev[b.length]/Math.max(a.length,b.length);
}
function candidateScore(query, entity){
  const qn=normalizeText(query), names=[entity.name,...(entity.aliases||[])];
  let best=0;
  for(const raw of names){
    const n=normalizeText(raw); if(!n) continue;
    if(qn===n) best=Math.max(best,1);
    if(qn.includes(n) && n.length>=4) best=Math.max(best,0.98);
    const qt=new Set(nsTokenize(query)), et=new Set(nsTokenize(raw));
    if(!et.size) continue;
    let matched=0, fuzzySum=0; for(const t of et){ const bestToken=[...qt].reduce((m,q)=>Math.max(m, q===t?1:((Math.min(q.length,t.length)>=4 && (q.startsWith(t)||t.startsWith(q)))?0.94:editSimilarity(q,t))),0); if(bestToken>=0.78) matched++; fuzzySum+=bestToken; }
    const coverage=matched/et.size;
    const fuzzyCoverage=fuzzySum/et.size;
    const union=new Set([...qt,...et]).size || 1;
    const jaccard=matched/union;
    best=Math.max(best, Math.min(0.96, coverage*0.67 + fuzzyCoverage*0.18 + jaccard*0.15));
  }
  return best;
}
function resolveCandidates(query, catalog, limit=5, minScore=0.44){
  return catalog.map(entity=>({entity,score:candidateScore(query,entity)})).filter(x=>x.score>=minScore).sort((a,b)=>b.score-a.score || a.entity.name.localeCompare(b.entity.name,'ru')).slice(0,limit);
}
function resolveProductCandidates(query,limit=5){ return resolveCandidates(query,SCALE_PRODUCTS,limit,0.44); }
function resolveChannelCandidates(query,limit=5){ return resolveCandidates(query,SCALE_CHANNELS.map((name,i)=>({id:`ch-${i+1}`,name,aliases:[]})),limit,0.58); }
function resolveSegmentCandidates(query,limit=5){ return resolveCandidates(query,SCALE_SEGMENTS.map((name,i)=>({id:`seg-${i+1}`,name,aliases:[]})),limit,0.58); }
function productDecision(query){
  const c=resolveProductCandidates(query,5);
  if(!c.length) return {status:'none',candidates:[]};
  const top=c[0], second=c[1];
  if(top.score>=0.84 && (!second || top.score-second.score>=0.12)) return {status:'auto',value:top.entity.name,confidence:top.score,candidates:c};
  if(top.score>=0.70) return {status:'clarify',confidence:top.score,candidates:c.filter(x=>x.score>=Math.max(0.65,top.score-0.12)).slice(0,5)};
  return {status:'none',confidence:top.score,candidates:c};
}
function candidatePromptList(query){
  const products=resolveProductCandidates(query,7).map(x=>`${x.entity.name} (${Math.round(x.score*100)}%)`);
  const channels=resolveChannelCandidates(query,5).map(x=>x.entity.name);
  const segments=resolveSegmentCandidates(query,5).map(x=>x.entity.name);
  const indicators=resolveIndicatorCandidates(query,7).map(x=>`${x.entity.name} (${Math.round(x.score*100)}%)`);
  return {indicators,products,channels,segments};
}
function buildScaleDrivers(){
  const inds=indicatorNames(); const out=[];
  for(let i=0;i<1500;i++){
    const p=SCALE_PRODUCTS[(i*37)%SCALE_PRODUCTS.length];
    const indicator=inds[(i*5)%inds.length];
    const channel=i%3===0?SCALE_CHANNELS[(i*11)%SCALE_CHANNELS.length]:'';
    const segment=i%4===0?SCALE_SEGMENTS[(i*7)%SCALE_SEGMENTS.length]:'';
    out.push({id:`scale-d-${i+1}`,indicator,product:p.name,channel,segment,name:[indicator,p.name,channel,segment].filter(Boolean).join(' ')});
  }
  return out;
}
const SCALE_DRIVERS=buildScaleDrivers();
function scaleDriverMatchScore(a,b){
  let score=0;
  if(analyticsKey(a.indicator)===analyticsKey(b.indicator)) score+=50;
  if(analyticsKey(a.product)===analyticsKey(b.product)) score+=30;
  if(analyticsKey(a.channel)===analyticsKey(b.channel)) score+=12;
  if(analyticsKey(a.segment)===analyticsKey(b.segment)) score+=8;
  return score;
}
function searchScaleDrivers(candidate,limit=5){ return SCALE_DRIVERS.map(d=>({d,score:scaleDriverMatchScore(candidate,d)})).filter(x=>x.score>=50).sort((a,b)=>b.score-a.score).slice(0,limit); }

function runScaleBenchmark(){
  const baseCases=[
    ['ипотека','Ипотечное кредитование'],['ипотечный кредит','Ипотечное кредитование'],['потреб','Потребительский кредит'],['кредит наличными','Потребительский кредит'],
    ['автокредит','Автокредит'],['кредит на образование','Образовательный кредит'],['дебетовка','Дебетовые карты'],['кредитка','Кредитные карты'],
    ['кредитные карты','Кредитные карты'],['осаго','ОСАГО'],['автогражданка','ОСАГО'],['каско','КАСКО'],['накопительный счет','Накопительные счета'],['вклад','Срочные счета'],
    ['платежи','Платежи'],['переводы','Переводы'],['создай драйвер объема выдач по ипотеке','Ипотечное кредитование'],['количество выдач потребкредит','Потребительский кредит'],
    ['доля рынка по кредитным картам','Кредитные карты'],['клиенты дебетовой карты','Дебетовые карты'],['сборы осаго','ОСАГО'],['сборы каско','КАСКО'],
    ['ипатека','Ипотечное кредитование'],['ипотка','Ипотечное кредитование'],['потребкредт','Потребительский кредит'],['потрб','Потребительский кредит'],
    ['кридитка','Кредитные карты'],['кредитк','Кредитные карты'],['дебтовка','Дебетовые карты'],['осгао','ОСАГО'],['накопит счет','Накопительные счета'],['накопительный счт','Накопительные счета'],
    ['платжи','Платежи'],['перевды','Переводы'],['создай количество выдач ипотка онлайн','Ипотечное кредитование'],['доля рынка по кридитке','Кредитные карты'],
    ['клиенты дебтовки','Дебетовые карты'],['объем сборов осгао','ОСАГО']
  ];
  const syntheticCases=SCALE_PRODUCTS.filter(x=>x.synthetic).slice(120,140).map(x=>[`создай драйвер по продукту ${x.name}`,x.name]);
  const sentenceCases=[
    ['нужен драйвер клиентов по ипотеке','Ипотечное кредитование'],['драйвер продаж по кредитке','Кредитные карты'],['эффект по дебетовке','Дебетовые карты'],
    ['расчет по кредиту наличными','Потребительский кредит'],['новый драйвер автогражданки','ОСАГО'],['показатель по накопительному счету','Накопительные счета'],
    ['сделай драйвер по депозиту','Срочные счета'],['метрика по платежам','Платежи'],['метрика по переводам','Переводы'],['выдачи по автокредиту','Автокредит'],
    ['выдачи образовательного кредита','Образовательный кредит'],['сборы по каско','КАСКО']
  ];
  const productCases=[...baseCases,...syntheticCases,...sentenceCases].slice(0,70);
  let correct=0, dangerous=0; const details=[];
  for(const [q,expected] of productCases){ const d=productDecision(q); const got=d.status==='auto'?d.value:(d.candidates?.[0]?.entity?.name||''); const ok=got===expected; if(ok) correct++; if(d.status==='auto'&&!ok) dangerous++; details.push({q,expected,got,status:d.status,score:Math.round((d.confidence||0)*100),ok}); }

  const safetyQueries=['космический банкинг','зелёная луна','программа север','супер продукт икс','финансовый телепорт','новая сущность без справочника','альфа омега сервис','продукт мечты','неизвестный пакет услуг','квантовый счёт'];
  let safetyPass=0; for(const q of safetyQueries){ const d=productDecision(q); if(d.status!=='auto') safetyPass++; }

  const ambiguityQueries=[
    ['страховки в кредитных картах','ambiguous'],['страхование по кредитке','ambiguous'],['кредит со страховкой','credit'],['карта со страховой защитой','insurance'],
    ['выдачи кредитов','credit'],['драйвер по кредитам','credit'],['сборы по страховкам','insurance'],['страховой продукт','insurance'],
    ['уровень проникновения страховок в кредитных картах','ambiguous'],['страхование держателей кредитных карт','ambiguous']
  ];
  let ambiguityPass=0; for(const [q,expectedGroup] of ambiguityQueries){ const d=detect(q); if(d.productGroup===expectedGroup) ambiguityPass++; }

  const channelQueries=[['мобильное приложение','Мобильное приложение'],['онлайн','Онлайн'],['партнерский','Партнёрский'],['отделение','Отделение'],['колл центр','Колл-центр']];
  let channelPass=0; for(const [q,e] of channelQueries){ const x=resolveChannelCandidates(q,1)[0]; if(x?.entity?.name===e) channelPass++; }
  const segmentQueries=[['массовый','Массовый'],['премиальный','Премиальный'],['малый бизнес','Малый бизнес'],['средний бизнес','Средний бизнес'],['крупный бизнес','Крупный бизнес']];
  let segmentPass=0; for(const [q,e] of segmentQueries){ const x=resolveSegmentCandidates(q,1)[0]; if(x?.entity?.name===e) segmentPass++; }

  const indicatorCases=[
    ['количество выдач','Количество выдач'],['выдачи','Количество выдач'],['объем выдач','Объём выдач'],['сумма выдач','Объём выдач'],['клиенты','Количество клиентов'],['сборы','Объём сборов'],['продажи','Количество продаж'],['бонусы','Количество бонусов'],['доля рынка','Доля рынка'],['проникновение','Уровень проникновения'],
    ['количество активных клиентов','Количество активных клиентов'],['количество новых клиентов','Количество новых клиентов'],['количество уникальных клиентов','Количество уникальных клиентов'],['объем транзакций','Объём транзакций'],['количество транзакций','Количество транзакций'],['средний объем платежей','Средний объём платежей'],['доля отказов','Доля отказов'],['конверсия','Конверсия']
  ];
  let indicatorCorrect=0, indicatorDangerous=0; const indicatorDetails=[];
  for(const [q,expected] of indicatorCases){ const d=indicatorDecision(q); const got=d.status==='auto'?d.value:(d.candidates?.[0]?.entity?.name||''); const ok=got===expected; if(ok) indicatorCorrect++; if(d.status==='auto'&&!ok) indicatorDangerous++; indicatorDetails.push({q,expected,got,status:d.status,score:Math.round((d.confidence||0)*100),ok}); }
  const indicatorSafety=['квантовая лояльность','цвет настроения клиента','скорость карандаша','индекс телепортации'];
  let indicatorSafetyPass=0; for(const q of indicatorSafety){ if(indicatorDecision(q).status!=='auto') indicatorSafetyPass++; }
  const indicatorAmbiguous=['клиенты','объем','доля','количество операций'];
  let indicatorClarify=0; for(const q of indicatorAmbiguous){ if(indicatorDecision(q).status!=='auto') indicatorClarify++; }
  const indPerfStart=performance.now(); for(let i=0;i<300;i++) resolveIndicatorCandidates(indicatorCases[i%indicatorCases.length][0],5); const indicatorLookupMs=(performance.now()-indPerfStart)/300;

  const perfStart=performance.now(); for(let i=0;i<300;i++) resolveProductCandidates(productCases[i%productCases.length][0],5); const lookupMs=(performance.now()-perfStart)/300;
  const drvStart=performance.now(); for(let i=0;i<300;i++) searchScaleDrivers({indicator:'Количество выдач',product:'Потребительский кредит',channel:'Онлайн',segment:'Массовый'},5); const driverMs=(performance.now()-drvStart)/300;
  const totalPass=correct+safetyPass+ambiguityPass+channelPass+segmentPass;
  return {
    products:SCALE_PRODUCTS.length,indicators:SCALE_INDICATORS.length,channels:SCALE_CHANNELS.length,segments:SCALE_SEGMENTS.length,drivers:SCALE_DRIVERS.length,
    totalChecks:100,totalPass,overallRate:totalPass/100,productCases:productCases.length,productAccuracy:correct/productCases.length,dangerousAuto:dangerous,
    safetyRate:safetyPass/safetyQueries.length,ambiguityRate:ambiguityPass/ambiguityQueries.length,channelRate:channelPass/channelQueries.length,segmentRate:segmentPass/segmentQueries.length,
    avgProductLookupMs:lookupMs,avgIndicatorLookupMs:indicatorLookupMs,avgDriverSearchMs:driverMs,indicatorAccuracy:indicatorCorrect/indicatorCases.length,indicatorDangerousAuto:indicatorDangerous,indicatorSafetyRate:indicatorSafetyPass/indicatorSafety.length,indicatorClarificationSafety:indicatorClarify/indicatorAmbiguous.length,indicatorDetails,details
  };
}
const PL_ARTICLES = ['Чистый процентный доход','Расходы на резервы','Чистый комиссионный доход','Операционные доходы','Прочие доходы','Прочие расходы'];
const INCOME_PL_ARTICLES = ['Чистый процентный доход','Чистый комиссионный доход','Операционные доходы','Прочие доходы'];
const EXPENSE_PL_ARTICLES = ['Расходы на резервы','Прочие расходы'];
function allowedPlArticles(effectType){ return effectType==='Расходы' ? EXPENSE_PL_ARTICLES : INCOME_PL_ARTICLES; }
function plArticleMatchesEffect(article,effectType){ return allowedPlArticles(effectType).includes(article); }

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
  text: 'Что нужно сделать? Опиши задачу обычным языком.'
}];

let drivers = load(REGISTRY_KEY, seedDrivers);
let combinationRegistry = load(COMBINATION_REGISTRY_KEY, buildSeedCombinations(seedDrivers));
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
})).map(d=>{ if(/^(?:оборот|обороты|объем оборота|объём оборота|объем оборотов|объём оборотов)$/.test(normalizeText(d.indicator))) { d.indicator='Объём оборотов'; d.unit='₽'; d.name=buildDriverName(d); } return d; }).map(syncDriverCombination);
// Миграция статусов комбинаций: новые комбинации для драйверов на согласовании считаем подготовленными,
// но не понижаем статусы базовых комбинаций из демо-НСИ.
const seedCombinationKeys=new Set(buildSeedCombinations(seedDrivers).map(x=>x.key));
for(const combo of combinationRegistry){
  if(seedCombinationKeys.has(combo.key)) continue;
  const linked=drivers.filter(d=>d.combinationId===combo.id || combinationKeyOf(d)===combo.key);
  if(linked.length && linked.every(d=>d.status==='На согласовании')) combo.status='Подготовлена';
}
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
  localStorage.setItem(COMBINATION_REGISTRY_KEY, JSON.stringify(combinationRegistry));
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

function extractUnresolvedProductMention(text){
  const raw=String(text||'').trim();
  // Явная конструкция «драйвер для X» — X является кандидатом продукта.
  // Используем только для ранней проверки, если retrieval не нашёл справочную сущность.
  const m=raw.match(/(?:драйвер(?:а|у|ом)?\s+)?для\s+([^,.;!?]+)$/i);
  if(!m) return null;
  let value=m[1].trim().replace(/^(?:продукта?|по)\s+/i,'').trim();
  if(!value || value.split(/\s+/).length>5) return null;
  return value.charAt(0).toUpperCase()+value.slice(1);
}
function detect(text) {
  const t = text.toLowerCase().replace(/ё/g,'е');
  const genericInsurance = t.includes('страхов') || t.includes('страхован');
  const genericCredit = t.includes('кредит');
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

  // Если детерминированные правила не сработали — ищем не по полному
  // справочнику в prompt, а по retrieval-слою и решаем по confidence.
  let retrievalChoices=null;
  if(!product && !(genericCredit && !/кредитк|кредитн.*карт/.test(t)) && !genericInsurance){
    const decision=productDecision(text);
    if(decision.status==='auto') product=decision.value;
    else if(decision.status==='clarify') retrievalChoices=decision.candidates.map(x=>x.entity.name);
  }

  let indicator = null;
  if ((t.includes('объем') || t.includes('объём')) && t.includes('выдач')) indicator = 'Объём выдач';
  else if ((t.includes('колич') || t.includes('числ')) && t.includes('выдач')) indicator = 'Количество выдач';
  else if (t.includes('клиент')) indicator = 'Количество клиентов';
  else if (t.includes('сбор')) indicator = 'Объём сборов';
  else if (t.includes('продаж')) indicator = 'Количество продаж';
  else if (t.includes('доля рынка')) indicator = 'Доля рынка';
  else if (t.includes('уров') && t.includes('проникнов')) indicator = 'Уровень проникновения';
  else if (t.includes('бонус')) indicator = 'Количество бонусов';
  else if (t.includes('оборот')) indicator = 'Объём оборота';

  let effectType = null;
  if (t.includes('расход') || t.includes('сокращ') || t.includes('не найм') || t.includes('ненайм')) effectType = 'Расходы';
  else if (t.includes('доход')) effectType = 'Доходы';

  let productChoices = retrievalChoices;
  // Смешанные домены — всегда уточняем, даже если один из продуктов распознан точно.
  if (genericInsurance && product && !['ОСАГО','КАСКО'].includes(product)) {
    productChoices = ['ОСАГО','КАСКО',product];
    product = null;
  }
  if (genericInsurance && !product && (/кредитк/.test(t) || (t.includes('кредитн') && t.includes('карт')))) {
    productChoices = ['ОСАГО','КАСКО','Кредитные карты'];
  }
  // Общее слово «карты» не является продуктом. В справочнике есть как минимум
  // дебетовые и кредитные карты, поэтому не завершаем сценарий ошибкой, а уточняем.
  if (!product && !productChoices && /(?:^|\s)карт(?:а|ы|ам|ах|ой|ами)?(?:\s|$)/.test(t)) {
    productChoices = ['Дебетовые карты','Кредитные карты'];
  }
  const productGroup = productChoices ? 'ambiguous' : (!product && genericCredit ? 'credit' : (!product && genericInsurance ? 'insurance' : null));
  const productMention = !product && !productChoices && !productGroup ? extractUnresolvedProductMention(text) : null;
  const indicatorChoices = !indicator && /выдач/.test(t) ? ['Количество выдач','Объём выдач'] : null;
  return { indicator, indicatorChoices, product, effectType, productGroup, productChoices, productMention };
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
function combinationKeyFromParts(product='', channel='', segment=''){
  return [analyticsKey(product), analyticsKey(channel), analyticsKey(segment)].join('|');
}
function combinationKeyOf(value={}){
  if(value.combinationId){
    const combo=combinationRegistry?.find?.(x=>x.id===value.combinationId);
    if(combo) return combo.key;
  }
  return combinationKeyFromParts(value.product, value.channel, value.segment);
}
function combinationNameFromParts(product='', channel='', segment=''){
  return [product, channel, segment].map(x=>String(x||'').trim()).filter(Boolean).join(' ') || 'Комбинация без аналитик';
}
function combinationComposition(combo){
  const parts=[];
  if(combo?.product) parts.push(`Продукт: ${combo.product}`);
  if(combo?.channel) parts.push(`Канал: ${combo.channel}`);
  if(combo?.segment) parts.push(`Сегмент: ${combo.segment}`);
  return parts.join(' · ') || '—';
}
function combinationType(combo){
  const flags=[combo?.product?'Продукт':'',combo?.channel?'Канал':'',combo?.segment?'Сегмент':''].filter(Boolean);
  return flags.join(' + ') || '—';
}
function makeCombination(value={}, preferredId='', status='Активна'){
  const product=String(value.product||'').trim();
  const channel=String(value.channel||'').trim();
  const segment=String(value.segment||'').trim();
  const key=combinationKeyFromParts(product,channel,segment);
  return {id:preferredId||`combo-${Math.abs(hashString(key))}`, key, name:combinationNameFromParts(product,channel,segment), product, channel, segment, type:'analytics', status};
}
function hashString(str){ let h=0; for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return h; }
function buildSeedCombinations(sourceDrivers=[]){
  const map=new Map();
  for(const d of sourceDrivers){
    if(!d.product) continue;
    const combo=makeCombination(d, d.combinationId||'');
    if(!map.has(combo.key)) map.set(combo.key, combo);
  }
  // Несколько явных примеров разных уровней аналитичности для демонстрации справочника комбинаций.
  [
    {product:'Ипотечное кредитование'},
    {product:'Потребительский кредит', channel:'Онлайн'},
    {product:'Потребительский кредит', segment:'Массовый'},
    {product:'Дебетовые карты', channel:'Мобильное приложение', segment:'Массовый'},
    {product:'ОСАГО'},
    {product:'КАСКО', channel:'Онлайн'}
  ].forEach(x=>{ const c=makeCombination(x); if(!map.has(c.key)) map.set(c.key,c); });
  return [...map.values()];
}
function ensureCombination(value={}, newStatus='Активна'){
  if(!value.product) return null;
  const key=combinationKeyFromParts(value.product,value.channel,value.segment);
  let combo=combinationRegistry.find(x=>x.key===key);
  if(!combo){ combo=makeCombination(value,'',newStatus); combinationRegistry.push(combo); }
  return combo;
}
function syncDriverCombination(d){
  const combo=ensureCombination(d, d.status==='На согласовании'?'Подготовлена':'Активна');
  if(combo){ d.combinationId=combo.id; d.combinationName=combo.name; }
  return d;
}
function exactDuplicate(c, excludeId='') {
  const key=combinationKeyOf(c);
  return drivers.find(d => d.id!==excludeId && analyticsKey(d.indicator)===analyticsKey(c.indicator) && combinationKeyOf(d)===key);
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
  // Продукт/комбинация — gate: не показываем аналоги из других продуктов.
  // Если выбран продукт, похожесть считаем только внутри него.
  const pool=c.product ? drivers.filter(d=>d.product===c.product) : drivers;
  const matches=pool.map(d=>{
    const sameIndicator=!!c.indicator && d.indicator===c.indicator;
    const sameCombination=!!c.combinationId && combinationKeyOf(d)===combinationKeyOf(c);
    const score=sameCombination&&sameIndicator?4:sameIndicator?3:sameCombination?2:1;
    return {d,score,sameIndicator,sameCombination};
  }).filter(x=>x.sameIndicator || x.sameCombination).sort((a,b)=>b.score-a.score);
  if(!matches.length) return [];
  const bestScore=matches[0].score;
  return matches.filter(x=>x.score===bestScore).slice(0,3);
}
function similarKind(x){ return x.score>=4?'Максимально похожий':x.score===3?'Похожий показатель по продукту':'Аналог по комбинации'; }
function inferEffectType(c){
  const t=normalizeText([c?.indicator,c?.original,flow?.original].filter(Boolean).join(' '));
  if(/сокращ|эконом|не найм|ненайм|снижен.*затрат|оптимизац.*расход|пше/.test(t)) return {value:'Расходы',confidence:.95};
  if(/выдач|продаж|клиент|оборот|сбор|доля рынка|проникнов|конверс|выруч|доход/.test(t)) return {value:'Доходы',confidence:.9};
  return {value:null,confidence:0};
}
function expenseIndicatorName(name){
  const raw=String(name||'').trim();
  const t=normalizeText(raw);
  if(!raw || /^(сокращение|снижение|экономия)/.test(t)) return raw;
  // Не переименовываем показатели, для которых «сокращение» обычно меняет бизнес-смысл.
  if(/продаж|выдач|сбор|выруч|доход|доля рынка|проникнов|конверс/.test(t)) return null;
  const quantity=raw.match(/^Количество\s+(.+)$/i);
  if(quantity) return `Сокращение количества ${quantity[1].toLowerCase()}`;
  const volume=raw.match(/^Объ[её]м\s+(.+)$/i);
  if(volume) return `Снижение объёма ${volume[1].toLowerCase()}`;
  if(/операц|транзакц|обращен|пше|затрат|расход/.test(t)) return `Сокращение ${raw.charAt(0).toLowerCase()+raw.slice(1)}`;
  return null;
}
function normalizeExpenseIndicator(c){
  if(!c || c.effectType!=='Расходы') return {ok:true,changed:false};
  const next=expenseIndicatorName(c.indicator);
  if(!next) return {ok:false,changed:false};
  if(normalizeText(next)===normalizeText(c.indicator)) return {ok:true,changed:false};
  const previous=c.indicator; c.indicator=next; c.newIndicator=true; c.newIndicatorPrepared=true;
  if(!c.unit) c.unit=inferUnitForNewIndicator(next);
  if(!indicatorRegistry.some(x=>normalizeText(x.name)===normalizeText(next))) indicatorRegistry.push({name:next,unit:c.unit,status:'Подготовлен'});
  return {ok:true,changed:true,previous,next};
}
function defaultBaseForCandidate(c){
  if(c?.unit==='шт.') return '1';
  if(c?.unit==='₽') return '1000000';
  if(c?.unit==='%') return '1';
  return '';
}
function parsePlArticles(text){
  const t=normalizeText(text);
  const aliases=[
    ['Чистый процентный доход',/чпд|процентн.*доход/],
    ['Чистый комиссионный доход',/чкд|комиссионн.*доход/],
    ['Расходы на резервы',/резерв/],
    ['Операционные доходы',/операционн.*доход/],
    ['Прочие доходы',/проч.*доход/],
    ['Прочие расходы',/проч.*расход/]
  ];
  const found=aliases.filter(([,re])=>re.test(t)).map(([name])=>name);
  for(const a of PL_ARTICLES) if(t.includes(normalizeText(a))&&!found.includes(a)) found.push(a);
  return found;
}
function relevantPlArticles(c){
  const allowed=allowedPlArticles(c?.effectType);
  const counts=new Map();
  for(const d of drivers){
    if(!c?.product || d.product!==c.product) continue;
    for(const a of (d.plAllocations||[])) if(allowed.includes(a.article)) counts.set(a.article,(counts.get(a.article)||0)+1);
  }
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  for(const a of allowed) if(!ranked.includes(a)) ranked.push(a);
  return ranked.slice(0,4);
}
function plCandidateCatalog(c){
  const relevant=relevantPlArticles(c);
  return [...relevant,...allowedPlArticles(c?.effectType).filter(x=>!relevant.includes(x))];
}
async function interpretPlArticles(text,c){
  const local=parsePlArticles(text).filter(a=>plArticleMatchesEffect(a,c?.effectType));
  if(local.length) return local;
  const candidates=plCandidateCatalog(c);
  const system=`Ты помогаешь выбрать статьи P&L для финансового драйвера. Пользователь может назвать сокращения, разговорные названия или описать смысл. Выбирай ТОЛЬКО из переданного списка кандидатов. Верни ТОЛЬКО JSON вида {"articles":["точное название"]}. Можно вернуть несколько статей. Если уверенности нет — пустой массив. Не придумывай новые статьи.`;
  const response=await fetch(LLM_API_URL,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:`Продукт: ${c?.product||'—'}\nТип эффекта: ${c?.effectType||'—'}\nКандидаты: ${JSON.stringify(candidates)}\nЗапрос: ${text}`}]})});
  const payload=await response.json().catch(()=>({}));
  if(response.status===401){ requireLogin(); throw new Error('pl'); }
  if(!response.ok) throw new Error('pl');
  const content=payload?.choices?.[0]?.message?.content; if(!content) throw new Error('pl');
  const data=JSON.parse(cleanJsonText(content));
  const list=Array.isArray(data?.articles)?data.articles:[];
  return list.map(x=>PL_ARTICLES.find(a=>normalizeText(a)===normalizeText(x))).filter(a=>a && plArticleMatchesEffect(a,c?.effectType));
}
function applySelectedPlArticles(articles){
  if(!flow) return;
  const c=flow.candidate;
  const uniq=[...new Set((articles||[]).filter(a=>PL_ARTICLES.includes(a) && plArticleMatchesEffect(a,c.effectType)))];
  if(!uniq.length) return false;
  c.pendingPlArticles=uniq;
  if(uniq.length===1){ c.plAllocations=[{article:uniq[0],profile:[...(c.costProfile||[])]}]; c.plSplitDone=true; }
  else { c.plAllocations=[]; c.plSplitDone=false; }
  flow.selectedPlArticles=[];
  flow.step=''; flow.stepKind=''; flow.options=[]; save(); continueFlow();
  return true;
}
function splitProfileByPercent(profile, articles, percents){
  return articles.map((article,i)=>({article,profile:(profile||[]).map(v=>moneyNumber(v)*(percents[i]/100))}));
}
function parsePercents(text,n){
  const vals=[...String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m=>moneyNumber(m[1]));
  if(vals.length===n && Math.abs(vals.reduce((a,b)=>a+b,0)-100)<.01) return vals;
  return null;
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
function fullArticleChoiceLabel(article){
  return ({
    'Чистый процентный доход':'Чистый процентный доход (ЧПД)',
    'Чистый комиссионный доход':'Чистый комиссионный доход (ЧКД)',
    'Расходы на резервы':'Расходы на резервы',
    'Операционные доходы':'Операционные доходы',
    'Прочие доходы':'Прочие доходы',
    'Прочие расходы':'Прочие расходы'
  })[article] || article;
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
// v5.6: модельный драйвер всегда хранит рассчитанную стоимость.
// Это не только демо-инициализация: при каждом старте восстанавливаем профиль из модели,
// если он пустой/нулевой или расходится с текущими параметрами модели.
function repairModelDriverCost(d){
  if(d?.calcMethod!=='model' || !d.modelId) return false;
  const model=availableModel(d);
  if(!model) {
    if(d.status==='Готов') d.status='Черновик';
    return false;
  }
  const result=calculateModel(d);
  if(!result.profile.length){
    d.cost=''; d.costProfile=[]; d.plAllocations=[];
    if(d.status==='Готов') d.status='Черновик';
    return false;
  }
  d.costProfile=result.profile;
  d.plAllocations=result.allocations;
  d.cost=String(profileTotal(result.profile));
  d.costMode=result.profile.length>1?'monthly':'single';
  d.costLogicText=modelLogic(d);
  d.businessRationale=modelBusinessRationale(d);
  d.status='Готов';
  return true;
}
function hydrateModelDriverCosts(list){
  let count=0;
  for(const d of (list||[])){
    if(repairModelDriverCost(d)) count++;
    // Дополнительный инвариант: «Готов» никогда не показывается с нулевой стоимостью.
    if(d.status==='Готов' && !hasNonZeroEffect(d.costProfile?.length?d.costProfile:[d.cost])) d.status='Черновик';
    d.name=buildDriverName(d)||d.name;
  }
  return count;
}
let modelCostsRepaired=hydrateModelDriverCosts(drivers);
localStorage.setItem(REGISTRY_KEY, JSON.stringify(drivers));
localStorage.setItem(MODEL_COST_REPAIR_KEY, JSON.stringify({version:'6.0',at:new Date().toISOString(),count:modelCostsRepaired}));
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
function cancelPendingLlm(){
  llmRequestSeq++;
  if(activeLlmController){
    try{ activeLlmController.abort(); }catch{}
    activeLlmController=null;
  }
  setLlmBusy(false);
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
async function callOpenRouter(userText, candidate={}, expectedStep='', signal=null){
  const system=`Ты — модуль INTERPRETING агента управления финансовыми драйверами. Твоя единственная задача — понять произвольный текст пользователя и вернуть структурированный JSON. НЕ сопоставляй значения со справочниками, НЕ нормализуй названия и НЕ выбирай ближайшие сущности.

Извлеки из текста бизнес-смысл как его сформулировал пользователь:
- indicator — что измеряем / бизнес-показатель;
- product — к какому продукту относится драйвер;
- effectType — Доходы или Расходы, только если это явно следует из текста;
- base — 1, 1000, 1000000 или 1000000000, только если явно указано;
- cost — стоимость в рублях, если явно указана;
- channel — канал, если назван;
- segment — сегмент, если назван.

Если пользователь отвечает на уточняющий вопрос короткой фразой, учитывай поле «Ожидаемое поле». Не придумывай отсутствующие значения. Не исправляй «карты» на «Дебетовые карты» или «обороты» на справочное название — верни смысл максимально близко к словам пользователя. Единицу измерения не определяй.

Критически важно не путать роли сущностей. В конструкции «X по Y» X обычно отвечает на вопрос «что измеряем?» (indicator), а Y — «по какому продукту/аналитике?» (product), если контекст не говорит обратного. Примеры:
- «создай драйвер обороты по картам» → indicator=«обороты», product=«карты»;
- «количество клиентов по ипотеке» → indicator=«количество клиентов», product=«ипотека»;
- «объём сборов ОСАГО» → indicator=«объём сборов», product=«ОСАГО»;
- «драйвер для карандашей» → indicator=null, product=«карандаши»;
- «продажи по картам онлайн массовый» → indicator=«продажи», product=«карты», channel=«онлайн», segment=«массовый».

Верни ТОЛЬКО JSON без markdown с ключами: indicator, product, effectType, base, cost, channel, segment. Для неизвестных полей null.`;
  const current=JSON.stringify(candidate||{});
  const response=await fetch(LLM_API_URL,{
    method:'POST',
    headers:authHeaders({'Content-Type':'application/json'}),
    body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:`Текущая карточка: ${current}\nОжидаемое поле: ${expectedStep||'не задано'}\n\nСообщение пользователя: ${userText}`} ]}),
    signal
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

function coreCatalogDecision(query, names, aliases={}, autoThreshold=0.88, clarifyThreshold=0.64){
  const catalog=names.map((name,i)=>({id:`core-nsi-${i}`,name,aliases:aliases[name]||[]}));
  const c=resolveCandidates(query,catalog,5,0.40);
  if(!c.length) return {status:'none',candidates:[]};
  const top=c[0], second=c[1];
  if(top.score>=autoThreshold && (!second || top.score-second.score>=0.10)) return {status:'auto',value:top.entity.name,confidence:top.score,candidates:c};
  if(top.score>=clarifyThreshold) return {status:'clarify',confidence:top.score,candidates:c.filter(x=>x.score>=Math.max(clarifyThreshold,top.score-0.14)).slice(0,5)};
  return {status:'none',confidence:top.score,candidates:c};
}
function genericProductChoices(value){
  const t=normalizeText(value||'');
  if(!t) return null;
  if(/^(?:карт|карта|карты|карточн)/.test(t) || t==='банковские карты') return ['Дебетовые карты','Кредитные карты'];
  if(/^(?:кредит|кредиты|кредитование)$/.test(t)) return [...CREDIT_PRODUCTS];
  if(/страхов/.test(t) && !/осаго|каско/.test(t)) return [...INSURANCE_PRODUCTS];
  return null;
}
function looksLikeIndicatorPhrase(value){
  const t=normalizeText(value||'');
  if(!t) return false;
  return /(колич|числ|объ[её]м|оборот|сумм|доля|уровень|проникнов|конверс|клиент|продаж|выдач|сбор|операц|транзакц|остат|активац|заяв|одобр)/.test(t);
}
function looksLikeProductPhrase(value){
  const t=normalizeText(value||'');
  if(!t) return false;
  if(genericProductChoices(t)) return true;
  const d=coreCatalogDecision(value, PRODUCTS, PRODUCT_ALIASES, 0.86, 0.58);
  return d.status!=='none';
}
function repairInterpretedRoles(data,userText,expectedStep=''){
  const out={...(data||{})};
  const raw=String(userText||'').trim();
  // Ответ на CLARIFICATION относится к ожидаемому полю, а не является новым запросом.
  if(expectedStep && ['indicator','product','channel','segment'].includes(expectedStep) && !out[expectedStep] && raw){
    out[expectedStep]=raw;
  }
  // Семантическая sanity-check: не позволяем очевидному показателю оказаться продуктом и наоборот.
  if(out.product && looksLikeIndicatorPhrase(out.product) && !looksLikeProductPhrase(out.product)){
    if(!out.indicator) out.indicator=out.product;
    out.product=null;
  }
  if(out.indicator && looksLikeProductPhrase(out.indicator) && !looksLikeIndicatorPhrase(out.indicator)){
    if(!out.product) out.product=out.indicator;
    out.indicator=null;
  }
  // Детерминированная проверка исходной фразы используется только как защитный слой
  // после LLM: заполняет пропуски/исправляет переставленные роли, но не заменяет INTERPRETING.
  const local=detect(raw);
  // Если исходная фраза содержит просто «выдачи» без явного «количество/объём»,
  // не разрешаем LLM молча выбрать тип показателя. Пользователь должен увидеть
  // явный выбор и понимать, какой именно драйвер создаётся.
  if(!expectedStep && Array.isArray(local.indicatorChoices) && local.indicatorChoices.length){
    out.indicator=null;
    out.indicatorChoices=[...local.indicatorChoices];
    out.indicatorMention='выдачи';
  } else if(local.indicator && (!out.indicator || looksLikeProductPhrase(out.indicator))) out.indicator=local.indicator;
  if(local.product && !out.product) out.product=local.product;
  if(!out.product && Array.isArray(local.productChoices) && local.productChoices.length){
    if(/\bкарт(?:а|ы|ам|ах|ой|ами)?\b/i.test(normalizeText(raw))) out.product='карты';
    else if(local.productGroup==='credit') out.product='кредиты';
    else if(local.productGroup==='insurance') out.product='страхование';
  }
  return out;
}
function canonicalNewIndicatorName(value){
  const t=normalizeText(value||'');
  if(/^(?:оборот|обороты|объем оборота|объём оборота|объем оборотов|объём оборотов)$/.test(t)) return 'Объём оборотов';
  return String(value||'').trim();
}
function genericIndicatorChoices(value){
  const t=normalizeText(value||'');
  // «выдачи» без явного количества/объёма — действительно неоднозначный бизнес-смысл.
  if(/^(?:выдач|выдачи|кредитные выдачи|выдачи кредитов)$/.test(t)) return ['Количество выдач','Объём выдач'];
  return null;
}
function normalizeInterpretedData(data){
  const out={...data};
  // NORMALIZING: только алгоритм сопоставляет сырой JSON LLM с НСИ.
  if(data.indicator){
    const genericChoices=genericIndicatorChoices(data.indicator);
    if(genericChoices){
      out.indicator=null; out.indicatorChoices=genericChoices; out.indicatorMention=data.indicator; out.newIndicator=false;
    } else {
      const canonicalNew=canonicalNewIndicatorName(data.indicator);
      const exact=exactIndicatorAlias(canonicalNew);
      const d=exact ? {status:'auto',value:exact} : coreCatalogDecision(canonicalNew, indicatorNames(), INDICATOR_ALIASES, 0.90, 0.68);
      if(d.status==='auto') { out.indicator=d.value; out.newIndicator=false; }
      else if(d.status==='clarify'){ out.indicator=null; out.indicatorChoices=d.candidates.map(x=>x.entity.name); out.indicatorMention=data.indicator; out.newIndicator=false; }
      else { out.indicator=canonicalNew; out.newIndicator=true; }
    }
  }
  if(data.product){
    const genericChoices=genericProductChoices(data.product);
    if(genericChoices){ out.product=null; out.productChoices=genericChoices; out.productMention=null; out.productGroup='ambiguous'; }
    else {
      const d=coreCatalogDecision(data.product, PRODUCTS, PRODUCT_ALIASES, 0.86, 0.64);
      if(d.status==='auto') out.product=d.value;
      else if(d.status==='clarify'){ out.product=null; out.productChoices=d.candidates.map(x=>x.entity.name); out.productMention=null; out.productGroup='ambiguous'; }
      else { out.product=null; out.productMention=data.product; }
    }
  }
  if(data.channel){
    const d=coreCatalogDecision(data.channel, CORE_CHANNELS, {}, 0.88, 0.66);
    if(d.status==='auto') out.channel=d.value;
    else if(d.status==='clarify'){ out.channel=null; out.channelChoices=d.candidates.map(x=>x.entity.name); }
    else out.channel=null;
  }
  if(data.segment){
    const d=coreCatalogDecision(data.segment, CORE_SEGMENTS, {}, 0.88, 0.66);
    if(d.status==='auto') out.segment=d.value;
    else if(d.status==='clarify'){ out.segment=null; out.segmentChoices=d.candidates.map(x=>x.entity.name); }
    else out.segment=null;
  }
  return out;
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
async function runLlmAttempt(userText,candidate,expectedStep,requestId){
  let lastError=null;
  for(let attempt=1;attempt<=LLM_MAX_ATTEMPTS;attempt++){
    if(requestId!==llmRequestSeq) throw new DOMException('Session changed','AbortError');
    const controller=new AbortController();
    activeLlmController=controller;
    const started=performance.now();
    const timeoutId=setTimeout(()=>controller.abort(), LLM_REQUEST_TIMEOUT_MS);
    try{
      const data=await callOpenRouter(userText,candidate,expectedStep,controller.signal);
      clearTimeout(timeoutId);
      const ms=Math.round(performance.now()-started);
      recordLlmDiagnostic({status:'success',attempt,ms,at:new Date().toISOString()});
      return data;
    }catch(err){
      clearTimeout(timeoutId);
      if(requestId!==llmRequestSeq) throw err;
      const ms=Math.round(performance.now()-started);
      const kind=err?.name==='AbortError'?'timeout':(/JSON|разобрать|пустой/i.test(err?.message||'')?'json_error':'http_error');
      recordLlmDiagnostic({status:kind,attempt,ms,message:err?.message||String(err),at:new Date().toISOString()});
      lastError=err;
      if(attempt<LLM_MAX_ATTEMPTS) await new Promise(r=>setTimeout(r,250));
    }
  }
  throw lastError || new Error('LLM недоступна');
}
function recordLlmDiagnostic(info){
  lastLlmDiagnostic=info;
  localStorage.setItem('driver-agent.llm-diagnostic.v1',JSON.stringify(info));
  renderLlmDiagnostic();
}
function renderLlmDiagnostic(){
  const el=document.getElementById('llmDiagnostic'); if(!el) return;
  if(!lastLlmDiagnostic){ el.textContent='Последний вызов: нет данных'; return; }
  const d=lastLlmDiagnostic;
  const labels={success:'успешно',timeout:'таймаут',http_error:'ошибка API',json_error:'ошибка ответа',fallback:'локальный fallback'};
  const seconds=Number.isFinite(d.ms)?` · ${(d.ms/1000).toFixed(1)} с`:'';
  const attempt=d.attempt?` · попытка ${d.attempt}/${LLM_MAX_ATTEMPTS}`:'';
  el.textContent=`Последний вызов: ${labels[d.status]||d.status}${seconds}${attempt}`;
}
function shouldHandleFlowAnswerLocally(flowState){
  if(!flowState?.step) return false;
  // Выбор из уже нормализованных кандидатов никогда не отправляем обратно в LLM.
  if(flowState.stepKind==='choice') return true;
  // После RESOLVED пользователь вводит операционные/расчётные параметры. Это уже не
  // INTERPRETING бизнес-смысла, поэтому такие ответы обрабатываются детерминированно.
  return new Set([
    'unitCustom','effectType','channel','segment','base','modelChoice','calcMethod',
    'modelAvgCheck','modelConversion','modelMargin','modelRisk','modelRepayment',
    'modelHorizon','modelCreditTerm','costRule','costProfile','plArticle','plArticles','plSplitMode','plSplitPercent','formulaMonths','formulaConfirm','cost'
  ]).has(flowState.step);
}
async function processUserText(text){
  if(lastCreatedDriverId){ lastCreatedDriverId=null; renderContextActions(); }
  // LLM нужен только там, где мы действительно уточняем смысл исходного запроса
  // (например, indicator/product). Числа, стоимость, срок, P&L и выбранные варианты
  // обрабатываются локально — иначе LLM стирает текущий step и сценарий зацикливается.
  if(shouldHandleFlowAnswerLocally(flow)){
    handleFlowAnswer(text);
    return;
  }
  cancelPendingLlm();
  const requestId=++llmRequestSeq;
  setLlmBusy(true);
  try{
    const expectedStep=flow?.step||'';
    if(!flow){
      flow={phase:'INTERPRETING',step:'',stepKind:'',candidate:{indicator:null,product:null,effectType:null,unit:null,base:'',cost:'',costMode:'',calcMethod:'',costProfile:[],costLogicText:'',costFormula:null,businessRationale:'',modelId:'',modelParams:null,plAllocations:[],incrementMode:'',channel:'',segment:'',status:'Черновик'},original:text};
      save();
    } else flow.phase='INTERPRETING';
    const data=await runLlmAttempt(text,flow?.candidate||{},expectedStep,requestId);
    if(requestId!==llmRequestSeq) return;
    const repaired=repairInterpretedRoles(data,text,expectedStep);
    flow.phase='NORMALIZING';
    const normalized=normalizeInterpretedData(repaired);
    mergeLlmCandidate(normalized);
    // CLARIFICATION возвращается в INTERPRETING с контекстом; после успешной
    // интерпретации очищаем вопрос и продолжаем нормализацию/оркестрацию.
    flow.step=''; flow.stepKind=''; flow.options=[]; save();
    continueFlow();
  }catch(err){
    if(requestId!==llmRequestSeq) return;
    console.warn('LLM fallback:',err);
    recordLlmDiagnostic({status:'fallback',reason:lastLlmDiagnostic?.status||'error',at:new Date().toISOString()});
    if(!flow) startFlow(text); else {
      const repaired=repairInterpretedRoles({},text,flow.step||'');
      mergeLlmCandidate(normalizeInterpretedData(repaired));
      flow.step=''; flow.stepKind=''; flow.options=[]; save(); continueFlow();
    }
  }finally{
    if(requestId===llmRequestSeq){ activeLlmController=null; setLlmBusy(false); }
  }
}
async function testLlmConnection(){
  const btn=document.getElementById('testLlm');
  const meta=document.getElementById('llmMeta');
  const status=document.getElementById('llmStatus');
  if(btn){btn.disabled=true;btn.textContent='Проверяю…';}
  const requestId=++llmRequestSeq;
  try{
    const data=await runLlmAttempt('Создай драйвер количества клиентов по ипотеке',{},'',requestId);
    const d=lastLlmDiagnostic;
    toast('LLM работает');
    if(meta) meta.textContent=`LLM endpoint отвечает${d?.ms?` · ${(d.ms/1000).toFixed(1)} с`:''}. Проверка подтверждает соединение; рабочие запросы дополнительно контролируются в диагностике ниже.`;
    if(status) status.textContent='Доступно';
  }catch(err){
    console.warn('Connection check failed:',err);
    toast('LLM не ответила');
    if(meta) meta.textContent='Полный вызов LLM завершился ошибкой. Ниже показана диагностика.';
    if(status) status.textContent='Недоступно';
  }finally{
    activeLlmController=null;
    if(btn){btn.disabled=false;btn.textContent='Проверить';}
    renderLlmDiagnostic();
  }
}

async function interpretCostLogic(text, previousFormula=null){
  const system=`Ты — INTERPRETING для бизнес-правила расчёта стоимости драйвера. Ты НЕ считаешь профиль, а только переводишь свободный текст в структурированное правило. Чётко различай роли чисел: start/amount — денежное значение, percent — процент изменения, months — срок в месяцах. Не путай срок с начальным значением. Учитывай предыдущую формулу, если пользователь её корректирует.
Верни ТОЛЬКО JSON без markdown. Разрешённые типы:
- decay_percent: {type,start,percent,months}
- growth_percent: {type,start,percent,months}
- decrease_fixed: {type,start,amount,months}
- increase_fixed: {type,start,amount,months}
- constant: {type,amount,months}
- two_stage: {type,firstAmount,firstMonths,secondAmount,secondMonths}
Если срок не указан, months=null. Для two_stage сроки каждого этапа обязательны. Не добавляй бизнес-смысл и не выполняй арифметику.`;
  const user=`Предыдущая формула: ${previousFormula?JSON.stringify(previousFormula):'нет'}\nСообщение пользователя: ${text}`;
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),LLM_REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(LLM_API_URL,{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({messages:[{role:'system',content:system},{role:'user',content:user}]}),signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(response.status===401){ requireLogin(); throw new Error('formula'); }
    if(!response.ok) throw new Error('formula');
    const content=payload?.choices?.[0]?.message?.content; if(!content) throw new Error('formula');
    const data=JSON.parse(cleanJsonText(content));
    if(!['decay_percent','growth_percent','decrease_fixed','increase_fixed','constant','two_stage'].includes(data.type)) throw new Error('formula');
    const out={...(previousFormula||{}),type:data.type};
    for(const k of ['start','percent','amount','months','firstAmount','firstMonths','secondAmount','secondMonths']) if(data[k]!==undefined && data[k]!==null && data[k]!=='') out[k]=moneyNumber(data[k]);
    if('months' in out) out.months=Math.max(1,Math.min(36,Math.round(out.months)));
    if('firstMonths' in out) out.firstMonths=Math.max(1,Math.min(36,Math.round(out.firstMonths)));
    if('secondMonths' in out) out.secondMonths=Math.max(1,Math.min(36,Math.round(out.secondMonths)));
    return out;
  } finally { clearTimeout(timer); }
}
function localInterpretCostLogic(text){
  const raw=String(text); const t=normalizeText(raw);
  const pctMatch=raw.match(/(?:на|рост|раст[её]т|увелич[^0-9]*)\s*(\d+(?:[.,]\d+)?)\s*%/i) || raw.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const monthMatch=raw.match(/(?:в течение|на срок|срок[^0-9]*)\s*(\d+)\s*(?:месяц|мес)/i) || raw.match(/(\d+)\s*(?:месяц|мес)/i);
  const firstMatch=raw.match(/(?:перв(?:ый|ом)\s+месяц[^0-9]*|сначала[^0-9]*|старт[^0-9]*)(\d[\d\s]*(?:[.,]\d+)?)/i);
  const all=[...raw.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)/g)].map(m=>moneyNumber(m[1]));
  const percent=pctMatch?moneyNumber(pctMatch[1]):null;
  const months=monthMatch?Number(monthMatch[1]):null;
  let start=firstMatch?moneyNumber(firstMatch[1]):null;
  if(start===null){ start=all.find(v=>v!==percent && v!==months) ?? all[0] ?? null; }
  if(start!==null && percent!==null){
    const isGrow=/рост|раст|увелич|прибав|\+/.test(t) && !/уменьш|сниж|пад/.test(t);
    return {type:isGrow?'growth_percent':'decay_percent',start,percent,months,businessLogic:`${formatMoney(start)} ₽ в первый месяц, далее ${isGrow?'рост':'снижение'} на ${percent}% ежемесячно${months?` в течение ${months} мес.`:''}`,businessRationale:'Эффект меняется ежемесячно по заданному бизнесом правилу.'};
  }
  return null;
}

function startFlow(text) {
  const detected = detect(text);
  flow = { phase:'NORMALIZING', step:'', stepKind:'', candidate:{ ...detected, unit: detected.indicator ? unitFor(detected.indicator) : null, base:'', cost:'', costMode:'', calcMethod:'', costProfile:[], costLogicText:'', costFormula:null, businessRationale:'', modelId:'', modelParams:null, plAllocations:[], incrementMode:'', channel:'', segment:'', status:'Черновик' }, original:text };
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
function inferUnitForNewIndicator(name){
  const t=normalizeText(name||'');
  if(/доля|уровень|проникнов|конверс|процент|ставк/.test(t)) return '%';
  if(/колич|числ|шт|клиент|продаж|выдач|операц/.test(t) && !/объ[её]м|оборот|сумм/.test(t)) return 'шт.';
  if(/объ[её]м|оборот|сумм|выруч|доход|расход|стоим|марж/.test(t)) return '₽';
  return '';
}
function rejectUnknownProduct(product) {
  const value=String(product||'').trim();
  if(!value) return false;
  const canonical=canonicalFromList(value, SCALE_PRODUCTS.map(x=>x.name));
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
function askCandidateResolution(){
  if(!flow) return;
  const c=flow.candidate||{};
  const indicatorOptions=Array.isArray(c.indicatorChoices)?c.indicatorChoices:[];
  const productOptions=Array.isArray(c.productChoices)?c.productChoices:[];
  flow.resolveSelections={
    indicator:c.indicator || flow.resolveSelections?.indicator || '',
    product:c.product || flow.resolveSelections?.product || ''
  };
  if(flow.step!=='resolveCandidates') addMessage('agent','Нашёл несколько подходящих вариантов. Выбери показатель и продукт — после этого продолжу создание драйвера.');
  flow.step='resolveCandidates';
  flow.stepKind='choice';
  flow.phase='USER_CHOICE';
  flow.options=[];
  save(); renderContextActions(); renderProgress();
}

function continueFlow() {
  if (!flow) return;
  const c = flow.candidate;
  // Если пользователь уже назвал предполагаемый продукт в исходной фразе,
  // сначала валидируем его. Не задаём вопросы про показатель для заведомо
  // несуществующего продукта.
  if(!c.product && c.productMention){
    const pd=productDecision(c.productMention);
    if(pd.status==='auto') { c.product=pd.value; c.productMention=null; save(); }
    else if(pd.status==='clarify') { c.productChoices=pd.candidates.map(x=>x.entity.name); c.productGroup='ambiguous'; c.productMention=null; save(); }
    else {
      const unknown=c.productMention; addMessage('agent', `Продукт «${unknown}» не найден в справочнике. Проверь название или укажи другой продукт.`);
      flow=null; save(); renderContextActions(); renderProgress(); return;
    }
  }
  // Если из исходного запроса уже видны неоднозначности по нескольким сущностям,
  // не растягиваем их на последовательные вопросы. Сразу показываем top-k кандидатов
  // по показателю и продукту в одной карточке выбора.
  if(!c.product && !Array.isArray(c.productChoices)){
    if(c.productGroup==='credit') c.productChoices=[...CREDIT_PRODUCTS];
    else if(c.productGroup==='insurance') c.productChoices=[...INSURANCE_PRODUCTS];
  }
  if((!c.indicator && Array.isArray(c.indicatorChoices) && c.indicatorChoices.length) &&
     (!c.product && Array.isArray(c.productChoices) && c.productChoices.length)) return askCandidateResolution();
  if (!c.product && Array.isArray(c.productChoices) && c.productChoices.length) return ask('product', 'Нашёл несколько похожих продуктов. Выбери подходящий.', c.productChoices, 'choice');
  if (!c.indicator && Array.isArray(c.indicatorChoices) && c.indicatorChoices.length) return ask('indicator','Нашёл несколько похожих показателей. Выбери, что именно будем измерять.',c.indicatorChoices,'choice');
  if (!c.indicator) return ask('indicator', 'Что именно будем измерять?', [], 'clarification');
  if(isPlArticle(c.indicator)){
    addMessage('agent', `«${c.indicator}» — статья P&L, а статья P&L не может быть драйвером. Укажи бизнес-показатель, изменение которого формирует эту статью — например, объём или количество выдач.`);
    c.indicator=null; c.unit=null; save(); return ask('indicator','Что именно будем измерять?',[], 'clarification');
  }
  // Сначала разрешаем обязательную аналитику продукта. Расчётные параметры
  // (включая единицу нового показателя) не спрашиваем до завершения NORMALIZING.
  if (!c.product) return ask('product', 'К какому продукту относится драйвер? Напиши название обычным языком — я найду варианты в справочнике.', [], 'clarification');
  if (rejectUnknownProduct(c.product)) return;

  const indicatorState=checkIndicator(c.indicator);
  if(indicatorState==='new'){
    c.newIndicatorPrepared=true;
    if(!c.unit) c.unit=inferUnitForNewIndicator(c.indicator);
    save();
  }
  if(c.newIndicator && !c.unit) return ask('unit','В чём измеряем значение драйвера?',['шт.','₽','%','Другое'],'choice');
  if(!c.newIndicator) c.unit = unitFor(c.indicator);

  // RESOLVED: к проверке дубля переходим только после того, как получили
  // indicator + конкретную combinationId из нормализованных аналитик.
  const combo=ensureCombination(c);
  if(combo){ c.combinationId=combo.id; c.combinationName=combo.name; }
  flow.phase='RESOLVED'; save();

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
      flow.similarIds=similar.map(x=>x.d.id); flow.similarMeta=similar.map(x=>({id:x.d.id,score:x.score})); flow.step='similar'; save();
      addMessage('agent', `Нашёл ${similar.length} ${similar.length===1?'вариант':'варианта'} в реестре. Сначала показываю самые близкие.`);
      renderContextActions(); renderProgress(); return;
    }
  }
  if(!c.incrementMode) c.incrementMode=inferIncrementMode(c);

  // v7.2: сущность драйвера и его стоимость — два разных этапа.
  // До этого места фиксируем только indicator + combination. Экономика начинается ниже.
  if(!c.driverDefinitionConfirmed){
    c.driverDefinitionConfirmed=true; flow.step='costIntro'; save();
    addMessage('agent', `Драйвер определён:
${buildDriverName(c)}

Теперь отдельно определим его стоимость — как изменение показателя превращается в финансовый эффект P&L.`);
    renderContextActions(); renderProgress(); return;
  }
  const model=availableModel(c);
  if(model?.effectType && !c.effectType){
    c.effectType=model.effectType;
    save();
  }
  if (!c.effectType){
    const inferred=inferEffectType(c);
    if(inferred.confidence>=.85){ c.effectType=inferred.value; save(); }
    else return ask('effectType', 'Не уверен, как эффект влияет на финансовый результат. Это доходы или расходы?', ['Доходы','Расходы']);
  }
  // v7.2: тип эффекта и направление относятся к стоимости, а не меняют сам показатель НСИ.
  if(c.effectType==='Расходы') c.effectDirection='Сокращение / снижение';
  else c.effectDirection='Рост / увеличение';

  if(!c.calcMethod && model){
    flow.step='modelChoice'; flow.modelId=model.id; save();
    const extra=c.indicator==='Количество выдач'?' + средний чек':'';
    addMessage('agent', `Для этого драйвера есть модель «${model.title}». Рассчитать стоимость?`);
    renderContextActions(); renderProgress(); return;
  }
  if(!c.base){ c.base=c.calcMethod==='model'?defaultModelBase(c,model):defaultBaseForCandidate(c); if(c.base) save(); }
  if (!c.base) return ask('base', 'Для нестандартной единицы нужна база расчёта. Выбери её.', ['1','1 000','1 млн','1 млрд']);

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
      if(!p.creditTermYears) return ask('modelCreditTerm','Укажи срок кредита в годах. Стоимость рассчитаю на срок кредита, но максимум на 36 месяцев.');
      p.horizon=creditHorizonMonths(p);
    }
    if(!(c.costProfile||[]).length){
      const result=calculateModel(c); const profile=result.profile;
      c.costProfile=profile; c.plAllocations=result.allocations; c.cost=String(profileTotal(profile)); c.costLogicText=modelLogic(c); c.businessRationale=modelBusinessRationale(c);
      flow.step='modelResult'; save();
      const sourceLabel=p?.sourcePeriod||'Среднее за последние 3 месяца прогнозного года';
      const sourceValues=model?.id==='credit_income_v2'
        ? [c.indicator==='Количество выдач'&&p.avgCheck?`средний чек ${formatMoney(p.avgCheck)} ₽`:null,`маржа ${p.margin}%`,`риск ${p.risk}%`,`погашение ${p.repayment}%/мес.`,`срок ${p.creditTermYears} г.`].filter(Boolean).join(' · ')
        : `коэффициент ${p.conversion}%`;
      addMessage('agent', `Стоимость рассчитана: ${formatMoney(profileTotal(profile))} ₽ на ${baseLabel(c.base)} ${c.unit}.
Профиль: ${profile.length} мес. · модель «${model.title}».
Источник: демо-данные прогнозной модели · ${sourceLabel.toLowerCase()}.
Исходные значения: ${sourceValues}.
${(c.plAllocations||[]).map(a=>`${shortArticleName(a.article)} ${formatMoney(profileTotal(a.profile||[]))} ₽`).join(' · ')}`, 'result');
      renderContextActions(); renderProgress(); return;
    }
    return showPreview();
  }

  if(!c.calcMethod) return ask('calcMethod','Готовой модели стоимости для этого драйвера пока нет. Как определить финансовый эффект на P&L?',['Описать логику финансового эффекта','Задать стоимость вручную']);
  c.costMode='monthly';
  if(c.calcMethod==='rule' && !(c.costProfile||[]).length) return ask('costRule', `Опиши, как изменение показателя превращается именно в финансовый эффект P&L. Можно писать параметры в любом порядке — я буду собирать их в текущий расчёт. Например: «на 1 млн ₽ объёма выдач ЧКД 20 тыс. ₽ ежемесячно 12 месяцев». Если формула рассчитывает только сам показатель, я это отмечу и попрошу продолжить до P&L.`);
  if(c.calcMethod==='manual' && !(c.costProfile||[]).length) return ask('costProfile', `Укажи стоимость вручную. Можно ввести одно значение или вставить помесячный профиль из Excel. В карточке каждое значение можно будет поправить отдельно.`);
  if(!(c.plAllocations||[]).length) return ask('plArticles','Выбери одну или несколько статей P&L. Сначала показываю наиболее релевантные для этого продукта. Можно также написать название обычным языком.',relevantPlArticles(c));
  if(c.pendingPlArticles?.length>1 && !c.plSplitDone) return ask('plSplitMode','Как распределить общую стоимость между статьями?',['Поровну','Указать доли']);
  showPreview();
}
function ask(step, text, options=[], kind='') {
  if (flow.step !== step) addMessage('agent', text);
  flow.step = step;
  flow.options = options;
  flow.stepKind = kind || (options.length ? 'choice' : 'clarification');
  flow.phase = flow.stepKind==='choice' ? 'USER_CHOICE' : 'CLARIFICATION';
  save(); renderContextActions(); renderProgress();
}
function looksLikeIndicatorFormulaInsteadOfCost(text,c){
  const t=normalizeText(text);
  const hasPlEconomics=/(p&l|pnl|чпд|чкд|доход|расход|марж|риск|резерв|комисс|прибыл|эффект|стоимост)/i.test(t);
  const hasIndicatorConstruction=/(количеств|число|шт|карт).*(средн.*чек|чек)|(средн.*чек|чек).*(количеств|число|шт|карт)/i.test(t);
  const outputLooksLikeVolume=/(объем|объём|выдач|оборот|сбор)/i.test(t) || /объем|объём/i.test(normalizeText(c?.indicator||''));
  return hasIndicatorConstruction && outputLooksLikeVolume && !hasPlEconomics;
}
function directConstantRule(text){
  const t=String(text||'').toLowerCase().replace(/\s+/g,' ');
  const money=t.match(/(\d[\d\s]*(?:[,.]\d+)?)\s*(?:₽|руб(?:лей|ля|ль|\.)?)/i);
  const months=t.match(/(\d{1,2})\s*(?:месяц|месяца|месяцев|мес\.?)/i);
  if(money && /(кажд(?:ый|ого)\s+месяц|ежемесяч|в\s+месяц)/i.test(t)){
    const value=Number(money[1].replace(/\s/g,'').replace(',','.'));
    const m=months?Number(months[1]):null;
    if(value>0) return {type:'constant',start:value,amount:value,months:m};
  }
  return null;
}
function handleFlowAnswer(text) {
  const c = flow.candidate;
  const answeredStep=flow.step;
  if (flow.step === 'indicator') c.indicator = text.trim();
  else if (flow.step === 'unit') { if(text.trim()==='Другое') return ask('unitCustom','Напиши единицу измерения нового показателя.'); c.unit=text.trim(); }
  else if (flow.step === 'unitCustom') c.unit=text.trim();
  else if (flow.step === 'product') {
    const raw=text.trim();
    const exactOption=(flow.options||[]).find(x=>normalizeText(x)===normalizeText(raw));
    const exactCore=PRODUCTS.find(x=>normalizeText(x)===normalizeText(raw));
    if(exactOption || exactCore){
      c.product=exactOption||exactCore;
      c.productGroup=''; c.productChoices=null; c.productMention=null;
    } else {
      const generic=genericProductChoices(raw);
      if(generic){
        c.product=null; c.productChoices=generic; c.productGroup='ambiguous'; c.productMention=null;
      } else {
        // В пользовательском flow работаем только с боевым/core-справочником.
        // SCALE_PRODUCTS нужен исключительно для скрытого нагрузочного теста и не должен
        // создавать ложную неоднозначность вроде «Потребительский кредит» → «Кредитные карты».
        const pd=coreCatalogDecision(raw, PRODUCTS, PRODUCT_ALIASES, 0.86, 0.64);
        if(pd.status==='auto') c.product=pd.value;
        else if(pd.status==='clarify'){
          c.product=null; c.productChoices=pd.candidates.map(x=>x.entity.name); c.productGroup='ambiguous'; c.productMention=null;
        } else c.product=raw;
        if(c.product){c.productGroup=''; c.productChoices=null; c.productMention=null;}
      }
    }
  }
  else if (flow.step === 'effectType') { c.effectType = normalizeEffect(text); c.expenseIndicatorChecked=false; }
  else if (flow.step === 'expenseIndicatorMeaning') { c.indicator=String(text).trim(); c.newIndicator=true; c.newIndicatorPrepared=true; c.expenseIndicatorChecked=false; }
  else if (flow.step === 'channel') c.channel = text.trim();
  else if (flow.step === 'segment') c.segment = text.trim();
  else if (flow.step === 'base') c.base = normalizeBaseAnswer(text);
  else if (flow.step === 'modelChoice') { c.calcMethod = normalizeText(text).includes('модел') || normalizeText(text).includes('использ') ? 'model' : ''; if(!c.calcMethod) c.calcMethod='rule'; c.modelId=flow.modelId||''; }
  else if (flow.step === 'calcMethod') {
    const t=normalizeText(text); c.calcMethod=t.includes('модел')?'model':(t.includes('логик')||t.includes('правил'))?'rule':'manual'; c.costMode='monthly';
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
  else if(flow.step==='modelCreditTerm'){
    const raw=String(text).replace(',','.');
    const n=Number(raw.match(/\d+(?:\.\d+)?/)?.[0]||0);
    if(!n || n<=0){ addMessage('agent','Укажи срок кредита в годах, например 1, 2 или 3.'); return; }
    c.modelParams={...(c.modelParams||{}),creditTermYears:String(n)};
  }
  else if (flow.step === 'costRule') {
    if(looksLikeIndicatorFormulaInsteadOfCost(text,c)){
      c.pendingIndicatorFormula=text; save();
      addMessage('agent', `Похоже, эта формула рассчитывает сам показатель «${c.indicator}», а не его финансовую стоимость. Например, количество × средний чек может дать объём выдач, но ещё не показывает влияние на P&L.

Продолжи логику до финансового эффекта: через маржу, комиссии, риск, резервы, расходы — либо укажи стоимость единицы драйвера напрямую.`);
      return ask('costRule','Как изменение этого показателя влияет на P&L?');
    }
    flow.pendingCostLogic=text; flow.step='formulaParsing'; save(); addMessage('agent','Проверяю логику финансового эффекта и собираю расчёт…');
    (async()=>{
      let f=directConstantRule(text); try{ if(!f) f=await interpretCostLogic(text); }catch{ if(!f) f=localInterpretCostLogic(text); }
      if(!flow) return;
      if(!f){ flow.step='costRule'; save(); addMessage('agent','Не смог однозначно понять правило. Укажи начальное значение, как оно меняется и срок расчёта.'); renderContextActions(); return; }
      c.costFormula=f; c.costLogicText=monthlyFormulaLabel(f)||text; c.businessRationale=c.businessRationale||'Эффект рассчитывается по бизнес-правилу, заданному пользователем.';
      if(f.type!=='two_stage' && !f.months){ return ask('formulaMonths','На сколько месяцев применить это правило? Например: 12, 24 или 36.'); }
      const calculated=calculateProfile(f);
      if(!calculated.length || !hasNonZeroEffect(calculated)){ flow.step='costRule'; save(); addMessage('agent','Расчёт не дал ненулевого финансового эффекта. Я не буду сохранять нулевую стоимость. Уточни параметры или логику влияния на P&L.'); renderContextActions(); renderProgress(); return; }
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
  else if(flow.step==='formulaConfirm'){
    const previous={...(c.costFormula||{})};
    flow.step='formulaParsing'; save(); addMessage('agent','Понял корректировку. Пересчитываю правило…');
    (async()=>{
      let f=null; try{ f=await interpretCostLogic(text,previous); }catch{ f=null; }
      if(!flow) return;
      if(!f){ flow.step='formulaConfirm'; save(); addMessage('agent','Не смог однозначно применить корректировку. Напиши, что именно изменить: начальное значение, процент или срок.'); renderContextActions(); return; }
      c.costFormula=f; c.costLogicText=monthlyFormulaLabel(f); c.businessRationale=c.businessRationale||'Эффект рассчитывается по бизнес-правилу, заданному пользователем.';
      if(f.type!=='two_stage' && !f.months){ flow.step='formulaMonths'; save(); return ask('formulaMonths','На сколько месяцев применить это правило?'); }
      const calculated=calculateProfile(f); if(!calculated.length){ flow.step='formulaConfirm'; save(); addMessage('agent','Не получилось пересчитать профиль. Уточни правило.'); renderContextActions(); return; }
      c.costProfile=calculated; c.cost=String(profileTotal(calculated)); flow.step='formulaConfirm'; save();
      addMessage('agent',`Теперь понял так:\n${monthlyFormulaLabel(f)}\n\n${compactProfileLines(calculated)}\n\nИтого за ${calculated.length} мес.: ${formatMoney(profileTotal(calculated))} ₽\n\nПодтвердить расчёт?`);
      renderContextActions(); renderProgress();
    })(); return;
  }
  else if(flow.step==='plArticles'){
    const recognized=parsePlArticles(text);
    const local=recognized.filter(a=>plArticleMatchesEffect(a,c.effectType));
    const rejected=recognized.filter(a=>!plArticleMatchesEffect(a,c.effectType));
    if(local.length){ applySelectedPlArticles(local); return; }
    if(rejected.length){ addMessage('agent', `Для типа эффекта «${c.effectType}» эти статьи не подходят: ${rejected.join(', ')}. Показываю только ${c.effectType==='Расходы'?'расходные':'доходные'} статьи.`); renderContextActions(); return; }
    flow.step='plParsing'; save(); addMessage('agent','Понял. Подбираю статьи…');
    (async()=>{
      let articles=[]; try{ articles=await interpretPlArticles(text,c); }catch{}
      if(!flow) return;
      if(!articles.length){ flow.step='plArticles'; save(); addMessage('agent','Не смог уверенно подобрать статьи. Выбери одну или несколько кнопками ниже.'); renderContextActions(); return; }
      addMessage('agent',`Понял статьи: ${articles.map(fullArticleChoiceLabel).join(' + ')}.`);
      applySelectedPlArticles(articles);
    })(); return;
  }
  else if(flow.step==='plSplitMode'){
    const t=normalizeText(text); const arts=c.pendingPlArticles||[];
    if(t.includes('поровну')){ const pct=100/arts.length; c.plAllocations=splitProfileByPercent(c.costProfile,arts,arts.map(()=>pct)); c.plSplitDone=true; }
    else return ask('plSplitPercent',`Укажи доли для статей в том же порядке: ${arts.join(' / ')}. Например: «70% / 30%».`);
  }
  else if(flow.step==='plSplitPercent'){
    const arts=c.pendingPlArticles||[]; const pct=parsePercents(text,arts.length);
    if(!pct){ addMessage('agent',`Нужно указать ${arts.length} доли в процентах, сумма должна быть 100%.`); return; }
    c.plAllocations=splitProfileByPercent(c.costProfile,arts,pct); c.plSplitDone=true;
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
  // Для ключевых сущностей сразу подтверждаем полным названием, чтобы пользователь
  // видел, что именно зафиксировано, до перехода к расчёту.
  if(answeredStep==='indicator' && c.indicator) addMessage('agent', `Понял: показатель — «${c.indicator}».`);
  if(answeredStep==='product' && c.product) addMessage('agent', `Понял: продукт — «${c.product}».`);
  flow.step = ''; flow.stepKind=''; flow.options = []; save(); continueFlow();
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
  if(!c.effectType || !c.base || !hasNonZeroEffect(c.costProfile?.length?c.costProfile:[c.cost])){ addMessage('agent','Драйвер определён, но стоимость ещё не готова: нужен тип эффекта, база и ненулевой финансовый эффект. Сохранение со стоимостью 0 ₽ запрещено.'); flow.step=''; save(); continueFlow(); return; }
  const duplicate=exactDuplicate(c); if(duplicate){ addMessage('agent','Такой драйвер с этой же аналитикой уже существует. Чтобы создать новый, измени продукт, канал или сегмент.'); flow.duplicateChecked=false; flow.step=''; save(); continueFlow(); return; }
  let indicator=indicatorRecord(c.indicator);
  if(!indicator){ indicator={name:c.indicator,unit:c.unit,status:'Подготовлен'}; indicatorRegistry.push(indicator); }
  const combinationKey=combinationKeyFromParts(c.product,c.channel,c.segment);
  const combinationExists=combinationRegistry.some(x=>x.key===combinationKey);
  const needsApproval = indicator.status==='Подготовлен' || !combinationExists;
  const combo=ensureCombination(c, combinationExists?'Активна':'Подготовлена');
  const driver={ id:String(Date.now()), name:buildDriverName(c), indicator:c.indicator, product:c.product, unit:c.unit, effectType:c.effectType, base:c.base, cost:c.cost, costMode:c.costMode||'single', calcMethod:c.calcMethod||'single', costProfile:c.costMode==='monthly'?(c.costProfile||[]):[c.cost], costLogicText:c.costLogicText||'', costFormula:c.costFormula||null, businessRationale:c.businessRationale||'', modelId:c.modelId||'', modelParams:c.modelParams||null, plAllocations:c.plAllocations||[], incrementMode:c.incrementMode||inferIncrementMode(c), channel:c.channel||'', segment:c.segment||'', combinationId:combo?.id||'', combinationName:combo?.name||'', status:needsApproval?'На согласовании':'Готов' };
  drivers.unshift(driver); flow=null; lastCreatedDriverId=driver.id; save(); renderRegistry(); renderDictionaries(); updateSummary(); renderProgress();
  addMessage('agent', needsApproval ? `Готово. «${driver.name}» создан и направлен на согласование. После согласования он станет доступен для использования.` : `Готово. «${driver.name}» создан со статусом «Готов».`);
  renderContextActions();
  toast('Драйвер создан');
}
function cancelFlow() {
  flow=null; save(); addMessage('agent','Создание отменено. Можешь написать новый запрос.'); renderContextActions(); renderProgress();
}

function renderMessages() {
  const el=document.getElementById('messages');
  el.innerHTML=messages.map(m=>`<div class="message ${m.role} ${['preview','result'].includes(m.kind)?'preview-message':''}"><span class="label">${m.role==='user'?'Вы':'Агент'}</span>${escapeHtml(m.text)}</div>`).join('');
  requestAnimationFrame(()=>{ el.scrollTop=el.scrollHeight; });
}
function renderContextActions() {
  updatePromptPlaceholder();
  const el=document.getElementById('contextActions');
  const quick=document.getElementById('quickStart');
  if(quick) quick.hidden=!!flow;
  if (!flow) { el.innerHTML=lastCreatedDriverId?`<button data-flow-action="openCreated">Открыть карточку драйвера</button>`:''; return; }
  if(flow.step==='resolveCandidates'){
    const c=flow.candidate||{};
    const sel=flow.resolveSelections||{};
    const indicatorOptions=Array.isArray(c.indicatorChoices)?c.indicatorChoices:[];
    const productOptions=Array.isArray(c.productChoices)?c.productChoices:[];
    const ready=!!sel.indicator && !!sel.product;
    el.innerHTML=`<div class="candidate-resolution">
      <div class="candidate-group"><span class="candidate-group-title">Похожие показатели</span><div class="multi-choice">${indicatorOptions.map(o=>`<button type="button" data-resolve-type="indicator" data-resolve-value="${escapeHtml(o)}" class="${sel.indicator===o?'selected':''}">${escapeHtml(o)}</button>`).join('')}</div></div>
      <div class="candidate-group"><span class="candidate-group-title">Похожие продукты</span><div class="multi-choice">${productOptions.map(o=>`<button type="button" data-resolve-type="product" data-resolve-value="${escapeHtml(o)}" class="${sel.product===o?'selected':''}">${escapeHtml(o)}</button>`).join('')}</div></div>
    </div><button data-flow-action="confirmCandidates" class="${ready?'':'secondary'}">Продолжить</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='duplicate') {
    el.innerHTML=`<button data-flow-action="useExisting">Открыть драйвер</button><button data-flow-action="updateExisting" class="secondary">Изменить стоимость</button><button data-flow-action="differentAnalytics" class="secondary">Создать с другой аналитикой</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if(flow.step==='duplicateAnalytics'){
    el.innerHTML=`<button data-flow-action="changeProduct">Другой продукт</button><button data-flow-action="addChannel" class="secondary">Добавить / изменить канал</button><button data-flow-action="addSegment" class="secondary">Добавить / изменить сегмент</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='similar') {
    const sims=(flow.similarIds||[]).map(id=>drivers.find(d=>d.id===id)).filter(Boolean);
    const meta=new Map((flow.similarMeta||[]).map(x=>[x.id,x.score]));
    el.innerHTML=sims.map(d=>`<div class="similar-card"><small>${escapeHtml(similarKind({score:meta.get(d.id)||1}))}</small><strong>${escapeHtml(d.name)}</strong><span>${escapeHtml(costSummary(d))} за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</span><button data-flow-action="useSimilar" data-driver-id="${d.id}">Открыть</button></div>`).join('')+`<button data-flow-action="continueNew" class="secondary">Ни один не подходит — создать новый</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='costIntro') {
    el.innerHTML=`<button data-flow-action="startCost">Определить стоимость</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='modelChoice') {
    el.innerHTML=`<button data-flow-value="Использовать модель">Использовать модель</button><button data-flow-value="Использовать другую логику расчёта стоимости" class="secondary">Другая логика стоимости</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='modelResult') {
    el.innerHTML=`<button data-flow-action="createFromModel">Создать драйвер</button><button data-flow-action="viewModelCalc" class="secondary">Посмотреть расчёт</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='modelDetails') {
    el.innerHTML=`<button data-flow-action="createFromModel">Создать драйвер</button><button data-flow-action="redoModel" class="secondary">Параметры</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='formulaConfirm') {
    el.innerHTML=`<button data-flow-action="confirmFormula">✓ Подтвердить расчёт</button><button data-flow-action="redoFormula" class="secondary">Изменить логику</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='plArticles') {
    const selected=new Set(flow.selectedPlArticles||[]);
    const opts=(flow.options||relevantPlArticles(flow.candidate));
    const count=selected.size;
    const countLabel=count===1?'выбрана 1 статья':`выбрано ${count} статьи`;
    el.innerHTML=`<div class="pl-choice-block"><div class="multi-choice">${opts.map(o=>{const isSelected=selected.has(o);return `<button type="button" data-pl-toggle="${escapeHtml(o)}" class="${isSelected?'selected':''}" aria-pressed="${isSelected?'true':'false'}">${isSelected?'<span class="choice-check">✓</span> ':''}${escapeHtml(fullArticleChoiceLabel(o))}</button>`}).join('')}</div>${count?`<button data-flow-action="confirmPlArticles" class="pl-confirm">Продолжить · ${countLabel}</button>`:''}</div><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='preview') {
    el.innerHTML=`<button data-flow-action="confirm">✓ Создать</button><button data-flow-action="editMenu" class="secondary">Изменить</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
  } else if (flow.step==='editMenu') {
    el.innerHTML=`<button data-flow-action="editPl">Статьи P&L</button><button data-flow-action="editCost" class="secondary">Стоимость / расчёт</button><button data-flow-action="editAnalytics" class="secondary">Аналитики</button><button data-flow-action="editDriverDefinition" class="secondary">Показатель / продукт</button><button data-flow-action="backPreview" class="quiet">Назад</button>`;
  } else {
    el.innerHTML=(flow.options||[]).map(o=>`<button data-flow-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('') + `<button data-flow-action="cancel" class="quiet">Отмена</button>`;
  }
}
function flowProgressStage(){
  if(!flow) return {stage:0,total:6,label:''};
  const c=flow.candidate||{};
  const step=flow.step||'';
  if(flow.phase==='INTERPRETING') return {stage:1,total:6,label:'Понимаю запрос'};
  if(['resolveCandidates','indicator','product','unit','unitCustom','channel','segment'].includes(step) || !c.indicator || !c.product || !c.combinationId)
    return {stage:2,total:6,label:'Уточняю данные'};
  if(['duplicate','duplicateAnalytics','similar'].includes(step) || !flow.duplicateChecked)
    return {stage:3,total:6,label:'Проверяю реестр'};
  if(['costIntro','modelChoice','calcMethod','modelAvgCheck','modelConversion','modelMargin','modelRisk','modelRepayment','modelHorizon','modelCreditTerm','costRule','formulaMonths','formulaConfirm','costProfile','cost','base','effectType','plArticle','plArticles','plSplitMode','plSplitPercent','modelResult','modelDetails'].includes(step) || !(c.costProfile||[]).length)
    return {stage:4,total:6,label:'Определяю стоимость'};
  if(step==='preview') return {stage:5,total:6,label:'Проверяю результат'};
  return {stage:5,total:6,label:'Готовлю создание'};
}
function renderProgress() {
  const el=document.getElementById('progress');
  if (!flow) { el.hidden=true; return; }
  const c=flow.candidate;
  const understood=[];
  if(c.indicator) understood.push(c.indicator);
  if(c.product) understood.push(c.product);
  if(c.channel) understood.push(c.channel);
  if(c.segment) understood.push(c.segment);
  const summary=understood.length?understood.join(' · '):(c.productMention?`${c.productMention} · уточняю детали`:'Уточняю детали');
  const p=flowProgressStage();
  const percent=Math.max(8,Math.min(100,Math.round((p.stage/p.total)*100)));
  const left=Math.max(0,p.total-p.stage);
  el.hidden=false;
  el.innerHTML=`<div><strong>Создание драйвера</strong><span>${p.stage}/${p.total}</span></div>
    <div class="progress-track"><i style="width:${percent}%"></i></div>
    <div class="progress-meta"><small>${escapeHtml(p.label)}</small><small>${left?`осталось ${left} ${left===1?'шаг':'шага'}`:'почти готово'}</small></div>
    <small class="progress-summary">${escapeHtml(summary)}</small>`;
}

function renderRegistry() {
  const q=(document.getElementById('registrySearch')?.value||'').trim().toLowerCase();
  const list=drivers.filter(d=>!q || [d.name,d.indicator,d.product,d.effectType,d.status,d.channel,d.segment].join(' ').toLowerCase().includes(q));
  const el=document.getElementById('driverList');
  if (!list.length) { el.innerHTML='<div class="empty">Ничего не найдено</div>'; return; }
  el.innerHTML=`<div class="registry-table"><div class="registry-head"><span>Драйвер</span><span>Стоимость</span><span>Статус</span></div>${list.map(d=>`
    <div class="registry-item" data-driver-id="${d.id}">
      <button class="registry-row registry-row-direct" type="button" data-open-driver="${d.id}" aria-label="Открыть карточку ${escapeHtml(d.name)}">
        <span class="registry-main"><strong>${escapeHtml(d.name)}</strong><small class="registry-cost-mobile">${escapeHtml(costSummary(d))} за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</small></span>
        <span class="registry-cost"><strong>${escapeHtml(costSummary(d))}</strong><small>за ${escapeHtml(baseLabel(d.base))} ${escapeHtml(d.unit||'')}</small></span>
        <span class="badge ${d.status==='Готов'?'ready':['Требует согласования','На согласовании'].includes(d.status)?'approval':''}">${escapeHtml(d.status)}</span>
        <i class="row-chevron direct">›</i>
      </button>
    </div>`).join('')}</div>`;
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
  const ch=document.getElementById('channelDict'); if(ch) ch.innerHTML=CORE_CHANNELS.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активен</span></td></tr>`).join('');
  const sg=document.getElementById('segmentDict'); if(sg) sg.innerHTML=CORE_SEGMENTS.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активен</span></td></tr>`).join('');
  const combo=document.getElementById('combinationDict'); if(combo) combo.innerHTML=combinationRegistry.map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(combinationType(x))}</small></td><td><span class="table-status ${x.status==='Подготовлена'?'approval':''}">${escapeHtml(x.status||'Активна')}</span></td></tr>`).join('');
  const pl=document.getElementById('plArticleDict'); if(pl) pl.innerHTML=PL_ARTICLES.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активна</span></td></tr>`).join('');
  document.getElementById('indicatorCount').textContent=`${indicatorRegistry.length} записей`;
  document.getElementById('productCount').textContent=`${PRODUCTS.length} записей`;
  const cc=document.getElementById('channelCount'); if(cc) cc.textContent=`${CORE_CHANNELS.length} записей`;
  const sc=document.getElementById('segmentCount'); if(sc) sc.textContent=`${CORE_SEGMENTS.length} записей`;
  const coc=document.getElementById('combinationCount'); if(coc) coc.textContent=`${combinationRegistry.length} записей`;
  const pc=document.getElementById('plArticleCount'); if(pc) pc.textContent=`${PL_ARTICLES.length} записей`;
}
function switchTab(name){
  closeDriver();
  if(name==='models') renderModels();
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===name));
}
function getProfileFromEditor(){
  return [...document.querySelectorAll('#editProfileGrid input[data-profile-month]')].map(x=>x.value.trim()).slice(0,36);
}
function numericProfile(profile=[]){ return (profile||[]).map(v=>String(v).trim()===''?0:moneyNumber(v)); }
function hasNonZeroEffect(profile=[]){ return numericProfile(profile).some(v=>Math.abs(v)>1e-9); }
function renderProfileEditor(profile=[]){
  const grid=document.getElementById('editProfileGrid'); if(!grid) return;
  const values=(profile||[]).length ? profile : [''];
  const readonly=document.getElementById('editCalcMethod')?.value==='model';
  grid.innerHTML=values.map((v,i)=>`<label class="profile-row"><span>Месяц ${i+1}</span><input data-profile-month="${i}" inputmode="decimal" value="${escapeHtml(v)}" ${readonly?'readonly':''} />${readonly?'':`<button type="button" class="profile-delete" data-delete-profile-month="${i}" aria-label="Удалить месяц ${i+1}">×</button>`}</label>`).join('');
  grid.classList.add('collapsed');
  document.getElementById('toggleProfileRows').textContent=values.length>12?'Показать все':'Все месяцы показаны';
  document.getElementById('toggleProfileRows').hidden=values.length<=12;
  updateProfileTotal();
}
function plArticleOptions(selected=''){
  const effectType=document.getElementById('editEffectType')?.value || staticDriver?.effectType || 'Доходы';
  const allowed=allowedPlArticles(effectType);
  const values=selected && !allowed.includes(selected)?[selected,...allowed]:allowed;
  return `<option value="">Выбери статью</option>${values.map(x=>`<option value="${escapeHtml(x)}" ${x===selected?'selected':''}>${escapeHtml(x)}</option>`).join('')}`;
}
function normalizedAllocationsForMonths(allocations=[],months=1){
  return (allocations||[]).map(a=>({article:a.article||'',profile:Array.from({length:months},(_,i)=>String(a.profile?.[i]??'0'))}));
}
function renderPlAllocationEditor(allocations=[]){
  const el=document.getElementById('editPlAllocations'); if(!el) return;
  const method=document.getElementById('editCalcMethod')?.value;
  const isComputed=method==='model'||method==='rule';
  const profileMonths=getProfileFromEditor().length;
  const source=(allocations||[]);
  if(!source.length){ el.innerHTML='<div class="empty">Статьи пока не заданы</div>'; return; }
  const months=isComputed?Math.max(...source.map(a=>(a.profile||[]).length),1):Math.max(profileMonths,...source.map(a=>(a.profile||[]).length),1);
  const list=normalizedAllocationsForMonths(source,months);
  const visible=Math.min(months,3);
  const mobile=window.matchMedia('(max-width: 700px)').matches;
  const articleControls=isComputed?'':`<div class="pl-article-controls">${list.map((a,idx)=>`<div class="pl-article-control"><select data-pl-article-index="${idx}" aria-label="Статья P&L ${idx+1}">${plArticleOptions(a.article)}</select><button type="button" class="pl-article-delete" data-delete-pl-article="${idx}" aria-label="Удалить статью">×</button></div>`).join('')}</div>`;
  const rows=Array.from({length:months},(_,i)=>`<tr class="pl-month-row ${i>=visible?'extra-month':''}" ${i>=visible?'hidden':''}><td>${i+1}</td>${list.map((a,idx)=>`<td>${isComputed?`<span class="pl-static">${compactRub(a.profile?.[i]??0)}</span>`:`<input data-pl-row-index="${idx}" data-pl-month="${i}" inputmode="decimal" value="${escapeHtml(a.profile?.[i]??'0')}">`}</td>`).join('')}<td><strong>${compactRub(list.reduce((sum,a)=>sum+moneyNumber(a.profile?.[i]),0))}</strong></td></tr>`).join('');
  el.innerHTML=`${articleControls}<div class="pl-combined-wrap ${mobile?'mobile':''}"><table class="pl-combined ${mobile?'pl-mobile-table':''} ${isComputed?'model-table':''}"><thead><tr><th>Мес.</th>${list.map(a=>`<th title="${escapeHtml(a.article)}">${escapeHtml(shortArticleName(a.article||'Статья'))}</th>`).join('')}<th>Итого</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th>Итого</th>${list.map(a=>`<th>${compactRub(profileTotal(a.profile||[]))}</th>`).join('')}<th>${compactRub(profileTotal(profileFromPlAllocations(list)))}</th></tr></tfoot></table></div>${months>visible?'<button type="button" class="secondary-button inline-button" id="togglePlMonths">Показать все месяцы</button>':''}`;
  document.getElementById('togglePlMonths')?.addEventListener('click',e=>{ const hidden=[...el.querySelectorAll('.extra-month')].some(r=>r.hidden); el.querySelectorAll('.extra-month').forEach(r=>r.hidden=!hidden); e.currentTarget.textContent=hidden?'Скрыть лишние месяцы':'Показать все месяцы'; });
}

function getPlAllocationsFromEditor(){
  const selects=[...document.querySelectorAll('#editPlAllocations select[data-pl-article-index]')];
  const staticDriver=drivers.find(x=>x.id===document.getElementById('editId')?.value);
  const fallback=(staticDriver?.plAllocations||[]).map(a=>a.article);
  const count=Math.max(selects.length,fallback.length);
  if(!count) return [];
  return Array.from({length:count},(_,idx)=>{
    const article=selects[idx]?.value ?? fallback[idx] ?? '';
    const inputs=[...document.querySelectorAll(`#editPlAllocations input[data-pl-row-index="${idx}"]`)];
    const profile=inputs.length?inputs.map(x=>x.value.trim()||'0'):[...(staticDriver?.plAllocations?.[idx]?.profile||[])];
    return {article,profile};
  });
}
function distributeTotalAcrossArticles(total, allocations, monthIndex){
  const n=allocations.length; if(!n) return allocations;
  let basis=allocations.map(a=>moneyNumber(a.profile?.[monthIndex]));
  let basisTotal=basis.reduce((a,b)=>a+b,0);
  if(Math.abs(basisTotal)<1e-9 && monthIndex>0){ basis=allocations.map(a=>moneyNumber(a.profile?.[monthIndex-1])); basisTotal=basis.reduce((a,b)=>a+b,0); }
  const shares=Math.abs(basisTotal)>1e-9?basis.map(v=>v/basisTotal):Array(n).fill(1/n);
  let used=0;
  allocations.forEach((a,idx)=>{
    if(!Array.isArray(a.profile)) a.profile=[];
    const value=idx===n-1 ? total-used : Math.round(total*shares[idx]*100)/100;
    a.profile[monthIndex]=String(Math.round(value*100)/100); used+=value;
  });
  return allocations;
}
function syncPlFromProfile(){
  if(document.getElementById('editCalcMethod')?.value!=='manual') return;
  const profile=getProfileFromEditor(); let allocations=getPlAllocationsFromEditor();
  if(!allocations.length) return;
  allocations=normalizedAllocationsForMonths(allocations,Math.max(1,profile.length));
  profile.forEach((v,i)=>distributeTotalAcrossArticles(moneyNumber(v),allocations,i));
  renderPlAllocationEditor(allocations);
}
function syncProfileFromPl(){
  if(document.getElementById('editCalcMethod')?.value!=='manual') return;
  const allocations=getPlAllocationsFromEditor(); if(!allocations.length) return;
  const profile=profileFromPlAllocations(allocations);
  const inputs=[...document.querySelectorAll('#editProfileGrid input[data-profile-month]')];
  if(profile.length!==inputs.length){ renderProfileEditor(profile.map(String)); }
  else inputs.forEach((input,i)=>{ input.value=String(Math.round(moneyNumber(profile[i])*100)/100); });
  updateProfileTotal();
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
  const sourceSelect=document.getElementById('editModelSource');
  if(sourceSelect) sourceSelect.value=(d.calcMethod==='model' && d.modelParams?.sources)?'forecast':'manual';
  document.getElementById('editChannelWrap').hidden=!d.channel;
  document.getElementById('editSegmentWrap').hidden=!d.segment;
  const combo=ensureCombination(d);
  const comboName=document.getElementById('editCombinationName'); if(comboName) comboName.textContent=combo?.name||'—';
  const comboBody=document.getElementById('editCombinationComposition'); if(comboBody) comboBody.textContent=combo?combinationComposition(combo):'—';
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
function updatePromptPlaceholder(){
  const input=document.getElementById('prompt'); if(!input) return;
  if(!flow){ input.placeholder='Например: создай драйвер объёма выдач по ипотеке'; return; }
  const map={indicator:'Напиши показатель…',product:'Напиши продукт…',channel:'Напиши канал…',segment:'Напиши сегмент…',effectType:'Доходы или расходы…',base:'Укажи базу расчёта…',costRule:'Опиши логику финансового эффекта…',costProfile:'Укажи стоимость или вставь профиль…',plArticles:'Напиши название статьи P&L…',plSplitPercent:'Укажи доли статей…',editMenu:'Выбери, что изменить…'};
  input.placeholder=map[flow.step]||'Введите сообщение…';
}
function submitPrompt(){
  const form=document.getElementById('composer'); if(form?.requestSubmit) form.requestSubmit();
}
document.getElementById('prompt').addEventListener('keydown',e=>{
  if(e.key==='Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); submitPrompt(); }
});
document.getElementById('composer').addEventListener('submit',e=>{
  e.preventDefault(); const input=document.getElementById('prompt'); const text=input.value.trim(); if(!text)return;
  addMessage('user',text); input.value='';
  setTimeout(()=>processUserText(text),80);
});
document.getElementById('contextActions').addEventListener('click',e=>{
  const resolveType=e.target.dataset.resolveType;
  const resolveValue=e.target.dataset.resolveValue;
  if(resolveType && resolveValue && flow?.step==='resolveCandidates'){
    flow.resolveSelections={...(flow.resolveSelections||{}),[resolveType]:resolveValue};
    save(); renderContextActions(); return;
  }
  const plToggle=e.target.dataset.plToggle;
  if(plToggle && flow?.step==='plArticles'){
    const selected=new Set(flow.selectedPlArticles||[]); selected.has(plToggle)?selected.delete(plToggle):selected.add(plToggle); flow.selectedPlArticles=[...selected]; save(); renderContextActions(); return;
  }
  const value=e.target.dataset.flowValue; const action=e.target.dataset.flowAction;
  if(value){ addMessage('user',value); handleFlowAnswer(value); return; }
  if(!action) return;
  if(action==='openCreated'){
    const id=lastCreatedDriverId; lastCreatedDriverId=null; renderContextActions();
    if(id){ switchTab('registry'); setTimeout(()=>openDriver(id),120); }
    return;
  }
  const actionLabels={
    cancel:'Отмена', confirm:'Создать драйвер', differentAnalytics:'Создать с другой аналитикой', changeProduct:'Другой продукт', addChannel:'Добавить канал', addSegment:'Добавить сегмент', updateExisting:'Изменить стоимость',
    continueNew:'Создать новый драйвер', confirmFormula:'Подтвердить расчёт', createFromModel:'Создать драйвер', startCost:'Определить стоимость', viewModelCalc:'Посмотреть расчёт',
    redoModel:'Изменить параметры', redoFormula:'Изменить логику', useExisting:'Открыть существующий драйвер', restart:'Изменить', editMenu:'Изменить', editPl:'Статьи P&L', editCost:'Стоимость / расчёт', editAnalytics:'Аналитики', editDriverDefinition:'Показатель / продукт', backPreview:'Назад', confirmCandidates:'Подтвердить выбор', confirmPlArticles:'Продолжить с выбранными статьями'
  };
  if(action==='useSimilar'){
    const d=drivers.find(x=>x.id===e.target.dataset.driverId); addMessage('user',d?`Использовать «${d.name}»`:'Использовать найденный драйвер');
  } else if(actionLabels[action]) addMessage('user',actionLabels[action]);

  if(action==='cancel') cancelFlow();
  else if(action==='startCost'){ flow.step=''; flow.phase='RESOLVED'; save(); continueFlow(); }
  else if(action==='confirmCandidates'){
    const sel=flow?.resolveSelections||{};
    if(!sel.indicator || !sel.product){ toast('Выбери показатель и продукт'); return; }
    const c=flow.candidate;
    c.indicator=sel.indicator; c.indicatorChoices=null; c.indicatorMention=null;
    c.product=sel.product; c.productChoices=null; c.productGroup=''; c.productMention=null;
    c.unit=unitFor(c.indicator);
    flow.resolveSelections=null; flow.step=''; flow.stepKind=''; flow.options=[];
    addMessage('user',`${c.indicator} · ${c.product}`);
    save(); continueFlow();
  }
  else if(action==='confirmPlArticles'){ const arts=flow?.selectedPlArticles||[]; if(!arts.length){ toast('Выбери хотя бы одну статью'); return; } addMessage('user',arts.map(shortArticleName).join(' + ')); applySelectedPlArticles(arts); }
  else if(action==='confirm') finalizeDriver();
  else if(action==='differentAnalytics'){ flow.step='duplicateAnalytics'; save(); renderContextActions(); }
  else if(action==='changeProduct'){ flow.duplicateId=null; flow.duplicateChecked=false; flow.candidate.product=''; ask('product','Выбери другой продукт для нового драйвера.',PRODUCTS); }
  else if(action==='addChannel'){ flow.duplicateId=null; flow.duplicateChecked=false; ask('channel','Укажи канал, который отличает новый драйвер.'); }
  else if(action==='addSegment'){ flow.duplicateId=null; flow.duplicateChecked=false; ask('segment','Укажи сегмент, который отличает новый драйвер.'); }
  else if(action==='continueNew'){ flow.similarIds=[]; flow.step=''; save(); continueFlow(); }
  else if(action==='useSimilar'){ const id=e.target.dataset.driverId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='confirmFormula'){ flow.step=''; save(); continueFlow(); }
  else if(action==='createFromModel'){ finalizeDriver(); }
  else if(action==='viewModelCalc'){
    const c=flow.candidate; const model=DRIVER_MODELS[c.modelId]||availableModel(c);
    flow.step='modelDetails'; save();
    const profile=c.costProfile||[]; const allocations=c.plAllocations||[];
    addMessage('agent', `Расчёт по модели «${model?.title||'расчёта'}»:
${compactProfileLines(profile)}

${allocations.map(a=>`${a.article}: ${formatMoney(profileTotal(a.profile||[]))} ₽`).join('\n')}

Итого: ${formatMoney(profileTotal(profile))} ₽`, 'result');
    renderContextActions(); renderProgress();
  }
  else if(action==='redoModel'){ flow.candidate.costProfile=[]; flow.candidate.cost=''; flow.candidate.modelParams={}; flow.step=''; save(); continueFlow(); }
  else if(action==='redoFormula'){ flow.candidate.costProfile=[]; flow.candidate.costFormula=null; flow.candidate.costLogicText=''; flow.step=''; save(); continueFlow(); }
  else if(action==='updateExisting'){ const id=flow.duplicateId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='useExisting'){ const id=flow.duplicateId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='editMenu'){ flow.step='editMenu'; save(); addMessage('agent','Что именно изменить? Остальные уже выбранные данные я сохраню.'); renderContextActions(); renderProgress(); }
  else if(action==='backPreview'){ flow.step='preview'; save(); renderContextActions(); renderProgress(); }
  else if(action==='editPl'){
    flow.candidate.plAllocations=[]; flow.candidate.pendingPlArticles=[]; flow.candidate.plSplitDone=false; flow.selectedPlArticles=[];
    save(); addMessage('agent','Меняем только статьи P&L. Драйвер, база и рассчитанная стоимость останутся без изменений.');
    ask('plArticles','Выбери одну или несколько статей P&L.',relevantPlArticles(flow.candidate));
  }
  else if(action==='editCost'){
    const c=flow.candidate; c.costProfile=[]; c.cost=''; c.costFormula=null; c.costLogicText=''; c.plAllocations=[]; c.pendingPlArticles=[]; c.plSplitDone=false; c.calcMethod='';
    flow.step=''; save(); addMessage('agent','Меняем расчёт стоимости. Показатель и комбинация аналитик сохранятся.'); continueFlow();
  }
  else if(action==='editAnalytics'){
    const c=flow.candidate; c.channel=''; c.segment=''; c.combinationId=''; c.combinationName=''; flow.duplicateChecked=false; flow.step='';
    save(); addMessage('agent','Показатель и продукт сохраняю. Укажи канал или сегмент, если они нужны; можно написать «без дополнительных аналитик».'); ask('channel','Укажи канал или напиши «без дополнительных аналитик».');
  }
  else if(action==='editDriverDefinition'){
    const c=flow.candidate; c.indicator=''; c.product=''; c.combinationId=''; c.combinationName=''; c.driverDefinitionConfirmed=false; flow.duplicateChecked=false; c.costProfile=[]; c.cost=''; c.plAllocations=[]; c.calcMethod='';
    save(); addMessage('agent','Меняем показатель или продукт. После изменения я повторно проверю дубли, модель и стоимость.'); ask('indicator','Что именно будем измерять?');
  }
  else if(action==='restart'){ const original=flow.original; flow=null; save(); addMessage('agent','Хорошо. Напиши уточнённый запрос заново — текущую карточку я не создал.'); document.getElementById('prompt').value=original; document.getElementById('prompt').focus(); renderContextActions(); renderProgress(); }
});
document.getElementById('modelList')?.addEventListener('click',e=>{ const row=e.target.closest('.model-row'); if(!row)return; const item=row.closest('[data-model-id]'); expandedModelId=expandedModelId===item.dataset.modelId && !focusedModelId ? null : item.dataset.modelId; renderModels(); });
document.getElementById('modelShowAll')?.addEventListener('click',()=>{ focusedModelId=null; expandedModelId=null; renderModels(); });
document.getElementById('quickStart')?.addEventListener('click',e=>{
  const action=e.target.dataset.quick; if(!action)return;
  if(action==='create'){ const input=document.getElementById('prompt'); input.value='Создай драйвер '; input.focus(); }
  if(action==='find'){ switchTab('registry'); setTimeout(()=>document.getElementById('registrySearch')?.focus(),120); }
  if(action==='update'){ switchTab('registry'); toast('Выбери драйвер и открой его карточку'); }
});
document.getElementById('registrySearch').addEventListener('input',renderRegistry);
document.getElementById('driverList').addEventListener('click',e=>{
  const row=e.target.closest('[data-open-driver]');
  if(!row) return;
  openDriver(row.dataset.openDriver);
});
document.getElementById('backToRegistry').addEventListener('click',closeDriver);
document.getElementById('approveDriver').addEventListener('click',()=>{
  const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  if(!hasNonZeroEffect(d.costProfile||[d.cost])){ toast('Стоимость драйвера не может быть 0 ₽'); return; }
  d.status='Готов';
  const ind=indicatorRecord(d.indicator); if(ind && ind.status==='Подготовлен') ind.status='Активен';
  const combo=combinationRegistry.find(x=>x.id===d.combinationId); if(combo && combo.status==='Подготовлена') combo.status='Активна';
  save(); renderAll(); openDriver(id); toast('Драйвер согласован');
});
document.getElementById('driverForm').addEventListener('submit',e=>{
  e.preventDefault(); const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  const calcMethod=document.getElementById('editCalcMethod').value;
  const monthly=true;
  let costProfile=getProfileFromEditor();
  let editedAllocations=getPlAllocationsFromEditor();
  if(calcMethod==='manual'){
    if(costProfile.some(v=>String(v).trim()==='')){ toast('Заполни стоимость месяца или удали пустой месяц'); return; }
    if(!hasNonZeroEffect(costProfile)){ toast('Стоимость драйвера не может быть 0 ₽'); return; }
    if(editedAllocations.some(a=>!a.article)){ toast('Выбери статью P&L или удали пустую статью'); return; }
    const articleNames=editedAllocations.map(a=>a.article);
    if(new Set(articleNames).size!==articleNames.length){ toast('Одна статья P&L выбрана несколько раз'); return; }
  }
  if((calcMethod==='model'||calcMethod==='rule') && !editedAllocations.length) editedAllocations=d.plAllocations||[];
  if(editedAllocations.length) costProfile=profileFromPlAllocations(editedAllocations);
  const cost=costProfile.length?String(profileTotal(costProfile)):document.getElementById('editCost').value.trim();
  const status=document.getElementById('editStatus').value;
  if(status==='Готов' && !hasNonZeroEffect(costProfile.length?costProfile:[cost])){ toast('Стоимость драйвера не может быть 0 ₽'); return; }
  const selectedUnit=document.getElementById('editUnit').value;
  const unit=selectedUnit==='other' ? document.getElementById('editUnitOther').value.trim() : selectedUnit;
  if(!unit){ toast('Укажи единицу измерения'); return; }
  const modelSource=document.getElementById('editModelSource')?.value||'forecast';
  const modelParams=calcMethod==='model'?{avgCheck:document.getElementById('editAvgCheck').value.trim(),margin:document.getElementById('editMargin').value.trim(),risk:document.getElementById('editRisk').value.trim(),repayment:document.getElementById('editRepayment').value.trim(),creditTermYears:document.getElementById('editCreditTermYears').value.trim(),conversion:document.getElementById('editConversion').value.trim(),horizon:Number(document.getElementById('editHorizon').value||0),sources:modelSource==='forecast'?{avgCheck:'Прогнозная модель',margin:'Прогнозная модель',risk:'Прогнозная модель',repayment:'Прогнозная модель',creditTermYears:'Прогнозная модель',conversion:'Прогнозная модель'}:null,sourcePeriod:modelSource==='forecast'?'Среднее за последние 3 месяца прогнозного года':''}:null;
  let updatedIndicator=document.getElementById('editIndicator').value.trim(); const updatedProduct=document.getElementById('editProduct').value.trim(), updatedChannel=document.getElementById('editChannel').value.trim(), updatedSegment=document.getElementById('editSegment').value.trim();
  const updatedEffectType=document.getElementById('editEffectType').value;
  if(calcMethod!=='model' && editedAllocations.some(a=>!plArticleMatchesEffect(a.article,updatedEffectType))){ toast(`Для типа эффекта «${updatedEffectType}» выбраны неподходящие статьи P&L`); return; }
  if(updatedEffectType==='Расходы'){
    const normalized=expenseIndicatorName(updatedIndicator);
    if(!normalized){ toast('Для расходного эффекта укажи показатель как сокращение или снижение'); return; }
    updatedIndicator=normalized;
    if(!indicatorRegistry.some(x=>normalizeText(x.name)===normalizeText(normalized))) indicatorRegistry.push({name:normalized,unit,status:'Подготовлен'});
  }
  const updatedCombo=ensureCombination({product:updatedProduct,channel:updatedChannel,segment:updatedSegment});
  Object.assign(d,{name:buildDriverName({indicator:updatedIndicator,product:updatedProduct,channel:updatedChannel,segment:updatedSegment}),indicator:updatedIndicator,product:updatedProduct,effectType:updatedEffectType,unit,channel:updatedChannel,segment:updatedSegment,combinationId:updatedCombo?.id||'',combinationName:updatedCombo?.name||'',base:document.getElementById('editBase').value,cost,costMode:monthly?'monthly':'single',calcMethod,costProfile:monthly?costProfile:[cost],costLogicText:document.getElementById('editCostLogic').value.trim(),businessRationale:document.getElementById('editBusinessRationale').value.trim(),modelId:calcMethod==='model'?(availableModel({indicator:updatedIndicator,product:updatedProduct})?.id||d.modelId||''):'' ,modelParams,plAllocations:editedAllocations,incrementMode:document.getElementById('editIncrementMode').value,status});
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

  const sourceSelect=document.getElementById('editModelSource');
  const sourceMode=sourceSelect?.value || ((currentDriver?.modelParams?.sources)?'forecast':'manual');
  const sourceNote=document.getElementById('modelSourceNote');
  if(sourceNote && isModel) sourceNote.textContent=sourceMode==='forecast'?'Источник: прогнозная модель · среднее за последние 3 месяца прогнозного года.':'Источник: ручной ввод.';
  const sourceLocked=isModel && sourceMode==='forecast';
  ['editAvgCheck','editMargin','editRisk','editRepayment','editCreditTermYears','editConversion'].forEach(id=>{ const x=document.getElementById(id); if(x) x.readOnly=sourceLocked; });

  const calcDisplay=document.getElementById('editCalcMethodDisplay');
  const calcSelect=document.getElementById('editCalcMethod');
  if(calcDisplay){ calcDisplay.hidden=!isModel; calcDisplay.textContent=model?`Модель «${model.title}»`:'Модель расчёта'; }
  if(calcSelect) calcSelect.hidden=isModel;

  const incSelect=document.getElementById('editIncrementMode');
  const incDisplay=document.getElementById('editIncrementModeDisplay');
  if(incDisplay){ incDisplay.hidden=!isModel; incDisplay.textContent=incSelect?.value==='step'?'Ступенькой с месяца начала эффекта':'Годовой инкремент распределяется по месяцам'; }
  if(incSelect) incSelect.hidden=isModel;

  const business=document.getElementById('businessLogicSection'); if(business) business.hidden=isModel;
  const modelLink=document.getElementById('detailModelLink'); if(modelLink){ modelLink.hidden=!isModel; modelLink.dataset.openModel=model?.id||''; modelLink.textContent=model?`Открыть модель «${model.title}»`:'Открыть модель'; }
  ['editName','editIndicator','editProduct','editChannel','editSegment'].forEach(id=>{ const x=document.getElementById(id); if(x) x.readOnly=isModel; });
  ['editEffectType','editUnit','editBase'].forEach(id=>{ const x=document.getElementById(id); if(x) x.disabled=isModel; });
  updateProfileTotal();
}
document.getElementById('editCalcMethod').addEventListener('change',syncCostEditor);
document.getElementById('editModelSource')?.addEventListener('change',syncCostEditor);
document.getElementById('editCreditTermYears')?.addEventListener('input',()=>{
  const term=moneyNumber(document.getElementById('editCreditTermYears').value);
  document.getElementById('editHorizon').value=term?Math.min(36,Math.round(term*12)):'';
});
document.getElementById('addPlArticle').addEventListener('click',()=>{
  const current=getPlAllocationsFromEditor(); const months=Math.max(1,getProfileFromEditor().length);
  if(current.length>=PL_ARTICLES.length){ toast('Все доступные статьи уже добавлены'); return; }
  current.push({article:'',profile:Array(months).fill('0')}); renderPlAllocationEditor(current);
});
document.getElementById('editPlAllocations').addEventListener('input',e=>{ if(e.target.matches('input[data-pl-row-index]')) syncProfileFromPl(); updatePlSummary(); });
document.getElementById('editPlAllocations').addEventListener('change',e=>{
  if(e.target.matches('select[data-pl-article-index]')){ const current=getPlAllocationsFromEditor(); renderPlAllocationEditor(current); }
});
document.getElementById('editPlAllocations').addEventListener('click',e=>{
  const btn=e.target.closest('[data-delete-pl-article]'); if(!btn)return;
  const idx=Number(btn.dataset.deletePlArticle); const current=getPlAllocationsFromEditor(); current.splice(idx,1); renderPlAllocationEditor(current); syncProfileFromPl();
});

document.getElementById('editProfileGrid').addEventListener('input',e=>{ if(e.target.matches('input[data-profile-month]')){ updateProfileTotal(); syncPlFromProfile(); } });
document.getElementById('editProfileGrid').addEventListener('click',e=>{
  const btn=e.target.closest('[data-delete-profile-month]'); if(!btn)return;
  const idx=Number(btn.dataset.deleteProfileMonth); let profile=getProfileFromEditor(); profile.splice(idx,1);
  let allocations=getPlAllocationsFromEditor(); allocations.forEach(a=>a.profile?.splice(idx,1));
  renderProfileEditor(profile); if(allocations.length) renderPlAllocationEditor(allocations);
});
document.getElementById('addProfileMonth').addEventListener('click',()=>{
  const p=getProfileFromEditor(); if(p.length>=36){toast('Максимум 36 месяцев');return;} p.push(''); renderProfileEditor(p);
  const allocations=getPlAllocationsFromEditor(); if(allocations.length){ allocations.forEach(a=>a.profile.push('0')); renderPlAllocationEditor(allocations); }
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
document.getElementById('runScaleTest')?.addEventListener('click',()=>{
  const btn=document.getElementById('runScaleTest'); const out=document.getElementById('scaleTestResult');
  if(btn){btn.disabled=true;btn.textContent='Тестирую…';}
  requestAnimationFrame(()=>setTimeout(()=>{
    try{
      const r=runScaleBenchmark();
      if(out) out.innerHTML=`<strong>${r.totalPass}/${r.totalChecks} проверок</strong> · product match: ${Math.round(r.productAccuracy*100)}% · ошибочных auto-match: ${r.dangerousAuto}<br>Неоднозначность: ${Math.round(r.ambiguityRate*100)}% · неизвестные: ${Math.round(r.safetyRate*100)}% · поиск: ${r.avgProductLookupMs.toFixed(1)} мс`;
      toast('Масштабный тест завершён');
    }catch(e){ console.warn(e); if(out) out.textContent='Не удалось выполнить тест'; }
    if(btn){btn.disabled=false;btn.textContent='Запустить';}
  },20));
});
function endCurrentSession(){
  cancelPendingLlm();
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
  cancelPendingLlm();
  drivers=clone(seedDrivers); hydrateModelDriverCosts(drivers);
  combinationRegistry=buildSeedCombinations(drivers);
  messages=clone(seedMessages);flow=null;indicatorRegistry=Object.entries(INDICATOR_META).map(([name,unit])=>({name,unit,status:'Активен'}));save();renderAll();toast('Демо-данные восстановлены');
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
function renderAll(){renderMessages();renderContextActions();renderProgress();renderRegistry();renderModels();renderDictionaries();renderLlmSettings();renderLlmDiagnostic();updateSummary();}
if(authStillValid()){ hideAuthGate(); renderAll(); } else { clearAuth(); showAuthGate(''); }

function openSettingsModal(){ const m=document.getElementById('settingsModal'); if(m){m.hidden=false;document.body.classList.add('modal-open');} }
function closeSettingsModal(){ const m=document.getElementById('settingsModal'); if(m){m.hidden=true;document.body.classList.remove('modal-open');} }
document.getElementById('settingsGear')?.addEventListener('click',openSettingsModal);
document.getElementById('closeSettings')?.addEventListener('click',closeSettingsModal);
document.querySelector('[data-close-settings]')?.addEventListener('click',closeSettingsModal);

// Единый источник версии для интерфейса и диагностики.
document.querySelectorAll('.version-pill').forEach(el=>el.textContent=`v${APP_VERSION}`);
