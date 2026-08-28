const STORAGE_KEY = 'driver-agent.pwa.registry.v1';
const MESSAGES_KEY = 'driver-agent.pwa.messages.v1';

const seedDrivers = [{
  id: 'seed-1',
  name: 'Количество выдач — Ипотека',
  indicator: 'Количество выдач',
  product: 'Ипотека',
  unit: 'шт.',
  effectType: 'Доход',
  cost: '—',
  startDate: '01.09.2026',
  status: 'Готов'
}];

const seedMessages = [{
  id: 'hello', role: 'agent',
  text: 'Привет! Напиши, какой драйвер нужно создать. Например: «Создай драйвер количества выдач по ипотеке».'
}];

let drivers = load(STORAGE_KEY, seedDrivers);
let messages = load(MESSAGES_KEY, seedMessages);
let installPrompt = null;

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drivers));
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

function normalizeRequest(text) {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  let product = 'Не определён';
  if (t.includes('ипотек')) product = 'Ипотека';
  else if (t.includes('кредит')) product = 'Кредитование';
  else if (t.includes('страх')) product = 'Страхование';
  else if (t.includes('карт')) product = 'Карты';
  else if (t.includes('вклад') || t.includes('депозит')) product = 'Вклады';
  else if (t.includes('бонус')) product = 'Бонусная программа';

  let indicator = 'Новый показатель';
  if (t.includes('выдач')) indicator = 'Количество выдач';
  else if (t.includes('клиент')) indicator = 'Количество клиентов';
  else if (t.includes('сбор')) indicator = 'Объём сборов';
  else if (t.includes('продаж')) indicator = 'Количество продаж';
  else if (t.includes('пше') || t.includes('fte')) indicator = 'ПШЕ';
  else if (t.includes('бонус')) indicator = 'Количество бонусов';

  let effectType = 'Доход';
  if (t.includes('сокращ')) effectType = 'Сокращение';
  else if (t.includes('не найм') || t.includes('ненайм')) effectType = 'Не найм';
  else if (t.includes('расход')) effectType = 'Расход';

  let unit = 'шт.';
  if (indicator === 'Объём сборов') unit = '₽';
  if (indicator === 'ПШЕ') unit = 'ПШЕ';

  return { name: `${indicator} — ${product}`, indicator, product, unit, effectType };
}

function similarityWarning(candidate) {
  return drivers.find(d => d.indicator === candidate.indicator && d.product === candidate.product);
}

function addMessage(role, text) {
  messages.push({ id: `${Date.now()}-${Math.random()}`, role, text });
  save();
  renderMessages();
}

function createDriverFromText(text) {
  const candidate = normalizeRequest(text);
  const duplicate = similarityWarning(candidate);
  if (duplicate) {
    addMessage('agent', `Нашёл похожий драйвер «${duplicate.name}». Новый не создаю, чтобы не плодить дубли. Он уже есть в реестре со статусом «${duplicate.status}».`);
    toast('Найден существующий драйвер');
    return;
  }

  const driver = {
    id: `${Date.now()}`,
    ...candidate,
    cost: 'Не задана',
    startDate: 'Не задана',
    status: 'Черновик'
  };
  drivers.unshift(driver);
  save();
  renderRegistry();
  updateSummary();
  addMessage('agent', `Создал черновик «${driver.name}».\n\nПоказатель: ${driver.indicator}\nПродукт: ${driver.product}\nТип эффекта: ${driver.effectType}\n\nЗапись уже появилась в реестре.`);
  toast('Драйвер добавлен в реестр');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function renderMessages() {
  const el = document.getElementById('messages');
  el.innerHTML = messages.map(m => `
    <div class="message ${m.role}">
      <span class="label">${m.role === 'user' ? 'Вы' : 'Агент'}</span>${escapeHtml(m.text)}
    </div>`).join('');
  requestAnimationFrame(() => { el.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }); });
}

function renderRegistry() {
  const el = document.getElementById('driverList');
  if (!drivers.length) { el.innerHTML = '<div class="empty">Реестр пока пуст</div>'; return; }
  el.innerHTML = drivers.map(d => `
    <article class="driver-card">
      <header><h3>${escapeHtml(d.name)}</h3><span class="badge ${d.status === 'Готов' ? 'ready' : ''}">${escapeHtml(d.status)}</span></header>
      <div class="meta-grid">
        ${meta('Показатель', d.indicator)}
        ${meta('Продукт', d.product)}
        ${meta('Тип эффекта', d.effectType)}
        ${meta('Единица', d.unit)}
        ${meta('Стоимость', d.cost)}
        ${meta('Начало эффекта', d.startDate)}
      </div>
    </article>`).join('');
}
function meta(label, value) { return `<div class="meta"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`; }

function updateSummary() {
  document.getElementById('driverCount').textContent = drivers.length;
  document.getElementById('draftCount').textContent = drivers.filter(d => d.status === 'Черновик').length;
  document.getElementById('readyCount').textContent = drivers.filter(d => d.status === 'Готов').length;
}

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
}

document.getElementById('composer').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('prompt');
  const text = input.value.trim();
  if (!text) return;
  addMessage('user', text);
  input.value = '';
  setTimeout(() => createDriverFromText(text), 180);
});

document.querySelectorAll('[data-prompt]').forEach(btn => btn.addEventListener('click', () => {
  document.getElementById('prompt').value = btn.dataset.prompt;
  document.getElementById('prompt').focus();
}));

document.getElementById('resetButton').addEventListener('click', () => {
  if (!confirm('Сбросить созданные драйверы и вернуть демо-данные?')) return;
  drivers = structuredClone(seedDrivers);
  messages = structuredClone(seedMessages);
  save(); renderMessages(); renderRegistry(); updateSummary(); toast('Демо-данные восстановлены');
});

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installPrompt = e;
  document.getElementById('installButton').hidden = false;
});
document.getElementById('installButton').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null;
  document.getElementById('installButton').hidden = true;
});

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

renderMessages(); renderRegistry(); updateSummary();
