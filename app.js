const REGISTRY_KEY = 'driver-agent.pwa.registry.v1';
const MESSAGES_KEY = 'driver-agent.pwa.messages.v2';
const FLOW_KEY = 'driver-agent.pwa.flow.v2';

const INDICATORS = ['Количество выдач','Объём выдач','Количество клиентов','Объём сборов','Количество продаж','Количество бонусов'];
const PRODUCTS = ['Ипотека','Кредитование','Страхование','Карты','Вклады','Бонусная программа','Общий'];

const seedDrivers = [{
  id: 'seed-1', name: 'Количество выдач — Ипотека', indicator: 'Количество выдач', product: 'Ипотека',
  unit: 'шт.', effectType: 'Доходы', base: '1', cost: '2500', channel: '', segment: '', status: 'Готов'
}];
const seedMessages = [{
  id: 'hello', role: 'agent',
  text: 'Привет! Я помогу создать драйвер. Напиши запрос обычным языком — например: «Создай драйвер количества выдач по ипотеке». Я проверю реестр, уточню недостающие параметры и покажу карточку перед созданием.'
}];

let drivers = load(REGISTRY_KEY, seedDrivers);
let messages = load(MESSAGES_KEY, seedMessages);
let flow = load(FLOW_KEY, null);

// Миграция данных из предыдущих версий
drivers = drivers.map(d => ({
  ...d,
  effectType: ['Доход','Доходы'].includes(d.effectType) ? 'Доходы' : 'Расходы',
  base: normalizeStoredBase(d.base),
  channel: d.channel || '',
  segment: d.segment || '',
  status: d.status === 'Готов' && !String(d.cost || '').trim() ? 'Черновик' : d.status
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
  if (t.includes('ипотек')) product = 'Ипотека';
  else if (t.includes('страх')) product = 'Страхование';
  else if (t.includes('карт')) product = 'Карты';
  else if (t.includes('вклад') || t.includes('депозит')) product = 'Вклады';
  else if (t.includes('кредит')) product = 'Кредитование';
  else if (t.includes('бонус')) product = 'Бонусная программа';

  let indicator = null;
  if (t.includes('выдач')) indicator = 'Количество выдач';
  else if (t.includes('клиент')) indicator = 'Количество клиентов';
  else if (t.includes('сбор')) indicator = 'Объём сборов';
  else if (t.includes('продаж')) indicator = 'Количество продаж';
  else if ((t.includes('объем') || t.includes('объём')) && t.includes('выдач')) indicator = 'Объём выдач';
  else if (t.includes('бонус')) indicator = 'Количество бонусов';

  let effectType = null;
  if (t.includes('расход') || t.includes('сокращ') || t.includes('не найм') || t.includes('ненайм')) effectType = 'Расходы';
  else if (t.includes('доход')) effectType = 'Доходы';

  return { indicator, product, effectType };
}
function unitFor(indicator) {
  if (indicator === 'Объём сборов' || indicator === 'Объём выдач') return '₽';
  return 'шт.';
}
function exactDuplicate(c) {
  return drivers.find(d => d.indicator.toLowerCase() === c.indicator?.toLowerCase() && d.product.toLowerCase() === c.product?.toLowerCase());
}
function similarDrivers(c) {
  if (!c.indicator && !c.product) return [];
  return drivers.filter(d => (c.indicator && d.indicator === c.indicator) || (c.product && d.product === c.product)).slice(0,3);
}

function startFlow(text) {
  const detected = detect(text);
  flow = { step:'', candidate:{ ...detected, unit: unitFor(detected.indicator), base:'', cost:'', status:'Черновик' }, original:text };
  save();
  continueFlow();
}
function continueFlow() {
  if (!flow) return;
  const c = flow.candidate;
  if (!c.indicator) return ask('indicator', 'Какой показатель должен лежать в основе драйвера?', INDICATORS);
  c.unit = unitFor(c.indicator);
  if (!c.product) return ask('product', 'К какому продукту относится драйвер?', PRODUCTS);

  if (!flow.duplicateChecked) {
    flow.duplicateChecked = true;
    const duplicate = exactDuplicate(c);
    if (duplicate) {
      flow.duplicateId = duplicate.id;
      flow.step = 'duplicate'; save();
      addMessage('agent', `Нашёл точное совпадение в реестре: «${duplicate.name}» со статусом «${duplicate.status}». Использовать существующий драйвер или всё-таки создать новый?`);
      renderContextActions(); renderProgress(); return;
    }
    const similar = similarDrivers(c);
    if (similar.length) addMessage('agent', `Проверил реестр. Точного дубля нет, но есть ${similar.length} похожих записей. Продолжаю создание нового драйвера.`);
  }
  if (!c.effectType) return ask('effectType', 'Какой тип эффекта у драйвера?', ['Доходы','Расходы']);
  if (!c.base) return ask('base', 'Выбери базу стоимости драйвера.', ['1','1 000','1 млн','1 млрд']);
  if (!c.cost) return ask('cost', `Укажи стоимость в рублях для базы ${baseLabel(c.base)}. Например: «2500».`);
  showPreview();
}
function ask(step, text, options=[]) {
  if (flow.step !== step) addMessage('agent', text);
  flow.step = step; flow.options = options; save(); renderContextActions(); renderProgress();
}
function handleFlowAnswer(text) {
  const c = flow.candidate;
  if (flow.step === 'indicator') c.indicator = text.trim();
  else if (flow.step === 'product') c.product = text.trim();
  else if (flow.step === 'effectType') c.effectType = normalizeEffect(text);
  else if (flow.step === 'base') c.base = normalizeBaseAnswer(text);
  else if (flow.step === 'cost') {
    const parsed = parseCost(text);
    if (!parsed) {
      addMessage('agent','Не смог разобрать стоимость. Укажи сумму в рублях, например «2500».');
      return;
    }
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
function showPreview() {
  const c=flow.candidate; c.name = `${c.indicator} — ${c.product}`;
  flow.step='preview'; save();
  addMessage('agent', `Проверь карточку перед созданием:

${c.name}
Показатель: ${c.indicator}
Продукт: ${c.product}
Тип эффекта: ${c.effectType}
База стоимости: ${baseLabel(c.base)}
Стоимость: ${c.cost} ₽`,'preview');
  renderContextActions(); renderProgress();
}
function finalizeDriver() {
  const c=flow.candidate;
  const driver={ id:String(Date.now()), name:`${c.indicator} — ${c.product}`, indicator:c.indicator, product:c.product, unit:c.unit, effectType:c.effectType, base:c.base, cost:c.cost, channel:'', segment:'', status:'Черновик' };
  drivers.unshift(driver); flow=null; save(); renderRegistry(); updateSummary(); renderProgress(); renderContextActions();
  addMessage('agent', `Готово. «${driver.name}» создан в реестре со статусом «Черновик». Нажми на него в реестре, если нужно изменить параметры или перевести в другой статус.`);
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
  if (flow.step==='duplicate') {
    el.innerHTML=`<button data-flow-action="useExisting">Открыть существующий</button><button data-flow-action="createAnyway" class="secondary">Создать новый</button><button data-flow-action="cancel" class="quiet">Отмена</button>`;
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
  const complete=[c.indicator,c.product,c.effectType,c.base&&c.cost].filter(Boolean).length;
  el.hidden=false;
  el.innerHTML=`<div><strong>Создание драйвера</strong><span>${complete}/4 параметров</span></div><div class="progress-track"><i style="width:${complete*25}%"></i></div><small>${escapeHtml(c.indicator||'Показатель не определён')} · ${escapeHtml(c.product||'Продукт не определён')}</small>`;
}
function renderRegistry() {
  const q=(document.getElementById('registrySearch')?.value||'').trim().toLowerCase();
  const list=drivers.filter(d=>!q || [d.name,d.indicator,d.product,d.effectType,d.status].join(' ').toLowerCase().includes(q));
  const el=document.getElementById('driverList');
  if (!list.length) { el.innerHTML='<div class="empty">Ничего не найдено</div>'; return; }
  el.innerHTML=list.map(d=>`<article class="driver-card" data-driver-id="${d.id}">
    <header><div><div class="mini-label">${escapeHtml(d.effectType)}</div><h3>${escapeHtml(d.name)}</h3></div><span class="badge ${d.status==='Готов'?'ready':d.status==='Требует согласования'?'approval':''}">${escapeHtml(d.status)}</span></header>
    <div class="cost-line"><strong>${escapeHtml(d.cost||'—')} ₽</strong><span>за ${escapeHtml(baseLabel(d.base))}</span></div>
    <div class="meta-grid">${meta('Показатель',d.indicator)}${meta('Продукт',d.product)}${meta('База стоимости',baseLabel(d.base))}${meta('Единица измерения',d.unit)}</div>
  </article>`).join('');
}
function meta(label,value){ return `<div class="meta"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`; }
function updateSummary(){
  document.getElementById('driverCount').textContent=drivers.length;
  document.getElementById('draftCount').textContent=drivers.filter(d=>d.status==='Черновик').length;
  document.getElementById('readyCount').textContent=drivers.filter(d=>d.status==='Готов').length;
}
function renderDictionaries(){
  const unitMap={'Количество выдач':'шт.','Объём выдач':'₽','Количество клиентов':'шт.','Объём сборов':'₽','Количество продаж':'шт.','Количество бонусов':'шт.'};
  document.getElementById('indicatorDict').innerHTML=INDICATORS.map(x=>`<tr><td>${escapeHtml(x)}</td><td>${escapeHtml(unitMap[x]||'—')}</td><td><span class="table-status">Активен</span></td></tr>`).join('');
  document.getElementById('productDict').innerHTML=PRODUCTS.map(x=>`<tr><td>${escapeHtml(x)}</td><td><span class="table-status">Активен</span></td></tr>`).join('');
  document.getElementById('indicatorCount').textContent=`${INDICATORS.length} записей`;
  document.getElementById('productCount').textContent=`${PRODUCTS.length} записей`;
}
function switchTab(name){
  closeDriver();
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===name));
}
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
  document.getElementById('editBase').value=d.base||'';
  document.getElementById('editCost').value=d.cost||'';
  document.getElementById('editStatus').value=d.status;
  document.getElementById('detailHeading').textContent=d.name;
  const badge=document.getElementById('detailBadge'); badge.textContent=d.status; badge.className='badge '+(d.status==='Готов'?'ready':d.status==='Требует согласования'?'approval':'');
  document.getElementById('registryListView').hidden=true;
  document.getElementById('driverDetailView').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
function closeDriver(){
  document.getElementById('driverDetailView').hidden=true;
  document.getElementById('registryListView').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
for(const tab of document.querySelectorAll('.tab')) tab.addEventListener('click',()=>switchTab(tab.dataset.tab));
document.getElementById('composer').addEventListener('submit',e=>{
  e.preventDefault(); const input=document.getElementById('prompt'); const text=input.value.trim(); if(!text)return;
  addMessage('user',text); input.value='';
  setTimeout(()=> flow ? handleFlowAnswer(text) : startFlow(text),120);
});
document.getElementById('contextActions').addEventListener('click',e=>{
  const value=e.target.dataset.flowValue; const action=e.target.dataset.flowAction;
  if(value){ addMessage('user',value); handleFlowAnswer(value); return; }
  if(action==='cancel') cancelFlow();
  else if(action==='confirm') finalizeDriver();
  else if(action==='createAnyway'){ flow.duplicateId=null; flow.step=''; save(); continueFlow(); }
  else if(action==='useExisting'){ const id=flow.duplicateId; flow=null; save(); switchTab('registry'); renderContextActions(); renderProgress(); setTimeout(()=>openDriver(id),120); }
  else if(action==='restart'){ const original=flow.original; flow=null; save(); addMessage('agent','Хорошо. Напиши уточнённый запрос заново — текущую карточку я не создал.'); document.getElementById('prompt').value=original; document.getElementById('prompt').focus(); renderContextActions(); renderProgress(); }
});
document.getElementById('registrySearch').addEventListener('input',renderRegistry);
document.getElementById('driverList').addEventListener('click',e=>{const card=e.target.closest('[data-driver-id]');if(card)openDriver(card.dataset.driverId);});
document.getElementById('backToRegistry').addEventListener('click',closeDriver);
document.getElementById('driverForm').addEventListener('submit',e=>{
  e.preventDefault(); const id=document.getElementById('editId').value; const d=drivers.find(x=>x.id===id); if(!d)return;
  const cost=document.getElementById('editCost').value.trim();
  const status=document.getElementById('editStatus').value;
  if(status==='Готов' && !cost){ toast('Сначала укажи стоимость'); document.getElementById('editCost').focus(); return; }
  const selectedUnit=document.getElementById('editUnit').value;
  const unit=selectedUnit==='other' ? document.getElementById('editUnitOther').value.trim() : selectedUnit;
  if(!unit){ toast('Укажи единицу измерения'); return; }
  Object.assign(d,{name:document.getElementById('editName').value.trim(),indicator:document.getElementById('editIndicator').value.trim(),product:document.getElementById('editProduct').value.trim(),effectType:document.getElementById('editEffectType').value,unit,channel:document.getElementById('editChannel').value.trim(),segment:document.getElementById('editSegment').value.trim(),base:document.getElementById('editBase').value,cost,status});
  save();renderRegistry();updateSummary();closeDriver();toast('Изменения сохранены');
});
document.getElementById('editUnit').addEventListener('change',e=>{
  const other=document.getElementById('editUnitOther');
  other.hidden=e.target.value!=='other';
  if(!other.hidden) setTimeout(()=>other.focus(),50);
});
document.getElementById('deleteDriver').addEventListener('click',()=>{
  const id=document.getElementById('editId').value; if(!confirm('Удалить этот драйвер из локального реестра?'))return;
  drivers=drivers.filter(x=>x.id!==id);save();renderRegistry();updateSummary();closeDriver();toast('Драйвер удалён');
});
document.getElementById('resetButton').addEventListener('click',()=>{
  if(!confirm('Сбросить реестр, диалог и незавершённое создание?'))return;
  drivers=clone(seedDrivers);messages=clone(seedMessages);flow=null;save();renderAll();toast('Демо-данные восстановлены');
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

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
function renderAll(){renderMessages();renderContextActions();renderProgress();renderRegistry();renderDictionaries();updateSummary();}
renderAll();
