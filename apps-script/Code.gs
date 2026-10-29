/**
 * Beauty Mafia Hair Academy — приём заявок с сайта beautymafia.academy.
 *
 * Заявка из квиза → строка в листе «Заявки» (мини-CRM: статус, заметки)
 * → сообщение в Telegram с кнопкой «WhatsApp» (ответ клиенту в 2 касания)
 * → событие Lead в Meta Conversions API (когда подключён маркер).
 *
 * Код сайта и этот файл публичны, поэтому токены живут ТОЛЬКО в свойствах
 * скрипта: меню таблицы «Beauty Mafia» → «Подключить Telegram» / «Подключить Meta».
 * Установка — apps-script/README.md.
 */

const SHEET = 'Заявки';
const TZ = 'America/Chicago';
const GRAPH = 'https://graph.facebook.com/v23.0/';
const PIXEL = '1012135685120190';
const COLS = ['Дата', 'Статус', 'Имя', 'Телефон', 'Связь', 'Telegram', 'Формат', 'Опыт', 'Цель', 'Штат', 'Старт', 'Оплата',
  'Подарок', 'Язык', 'Источник', 'Кампания', 'Объявление', 'Страница', 'ID события', 'Заметки'];
const STATUSES = ['Новая', 'Написали', 'Консультация', 'Оплатил(а)', 'Думает', 'Не отвечает', 'Отказ', 'Спам', 'Тест'];
const MAX_PER_MIN = 20;  // больше заявок в минуту присылают боты, а не люди
const PROPS = () => PropertiesService.getScriptProperties();

// ---------- меню таблицы ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Beauty Mafia')
    .addItem('1. Подготовить таблицу', 'setup')
    .addItem('2. Подключить Telegram', 'connectTelegram')
    .addItem('3. Тестовая заявка', 'testLead')
    .addSeparator()
    .addItem('Подключить Meta (Conversions API)', 'connectMeta')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  remember_();
  const sh = sheet_(ss);
  if (sh.getMaxRows() < 2) sh.insertRowsAfter(1, 999);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#f8d7e8');
  sh.setFrozenRows(1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build();
  sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  ss.getSheets().forEach(s => {
    if (s.getName() !== SHEET && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  SpreadsheetApp.getUi().alert('Готово: лист «' + SHEET + '» подготовлен. Дальше — «2. Подключить Telegram».');
}

function connectTelegram() {
  const ui = SpreadsheetApp.getUi();
  remember_();
  const r = ui.prompt('Подключить Telegram',
    'Сначала отправьте боту /start из аккаунта (или группы), куда должны приходить заявки.\n\n' +
    'Вставьте токен бота (BotFather → /mybots → бот → API Token):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = r.getResponseText().trim();
  const me = tg_(token, 'getMe', {});
  if (!me.ok) return ui.alert('Токен не подошёл: ' + (me.description || 'ошибка') + '. Скопируйте его из BotFather ещё раз.');
  let chat = null;
  const up = tg_(token, 'getUpdates', { limit: 100 });
  (up.result || []).forEach(u => {
    const m = u.message || u.channel_post || u.my_chat_member;
    if (m && m.chat) chat = m.chat;
  });
  if (!chat) {
    const c = ui.prompt('Чат не найден',
      'Бот @' + me.result.username + ' не видит сообщений' + (up.ok ? '' : ' (' + up.description + ')') + '.\n' +
      'Напишите боту /start и запустите пункт меню ещё раз — или вставьте chat_id вручную:', ui.ButtonSet.OK_CANCEL);
    if (c.getSelectedButton() !== ui.Button.OK || !c.getResponseText().trim()) return;
    chat = { id: c.getResponseText().trim() };
  }
  const hello = tg_(token, 'sendMessage', { chat_id: chat.id, text: '✅ Заявки с сайта Beauty Mafia будут приходить сюда.' });
  if (!hello.ok) return ui.alert('Telegram не дал отправить сообщение: ' + hello.description);
  PROPS().setProperties({ TG_TOKEN: token, TG_CHAT: String(chat.id) });
  ui.alert('Готово! Заявки пойдут в чат «' + (chat.title || chat.first_name || chat.id) + '». Проверьте: «3. Тестовая заявка».');
}

function connectMeta() {
  const ui = SpreadsheetApp.getUi();
  remember_();
  const r = ui.prompt('Подключить Meta (Conversions API)',
    'Events Manager → пиксель ' + PIXEL + ' → Настройки → Conversions API → «Создать маркер доступа».\nВставьте маркер:',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const token = r.getResponseText().trim();
  const check = UrlFetchApp.fetch(GRAPH + PIXEL + '?fields=id&access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (check.getResponseCode() !== 200) return ui.alert('Meta не приняла маркер: ' + check.getContentText().slice(0, 300));
  const c = ui.prompt('Код тестового события (необязательно)',
    'Events Manager → «Тестирование событий» → код вида TEST12345. Оставьте пустым — события пойдут как боевые.',
    ui.ButtonSet.OK_CANCEL);
  const code = c.getSelectedButton() === ui.Button.OK ? c.getResponseText().trim() : '';
  const p = PROPS();
  p.setProperty('META_TOKEN', token);
  if (code) p.setProperty('META_TEST', code); else p.deleteProperty('META_TEST');
  ui.alert('Готово: заявки уходят в Meta событием Lead' + (code ? ' в тестовом режиме — после проверки подключите ещё раз без кода.' : '.'));
}

function testLead() {
  remember_();
  const r = handle_({ name: 'Тест', phone: '+1 312 555 0100', pref: 'WhatsApp', plan: 'Индивидуальное — $2900', exp: 'Проверка',
    state: 'Illinois', event_id: 'test-' + Date.now(), elapsed: 60000, test: true, page: 'https://beautymafia.academy/' });
  SpreadsheetApp.getUi().alert(r.ok ? 'Тестовая заявка записана в таблицу и отправлена в Telegram.' : 'Ошибка: ' + r.error);
}

// ---------- веб-приложение: сюда шлёт квиз сайта ----------

function doGet() { return out_({ ok: true, service: 'beauty-mafia-leads' }); }

function doPost(e) {
  let res;
  try {
    const body = (e && e.postData && e.postData.contents) || '{}';
    res = body.length > 20000 ? { ok: false, error: 'size' } : handle_(JSON.parse(body));
  } catch (err) {
    console.error(err);
    res = { ok: false, error: 'server' };
  }
  return out_(res);
}

function handle_(d) {
  if (d.website) return { ok: true };                           // ловушка для ботов: поле, невидимое человеку
  if (+d.elapsed > 0 && +d.elapsed < 3000) return { ok: true };  // квиз за 3 секунды не пройти
  const name = str_(d.name, 60), phone = phone_(d.phone);
  if (name.length < 2 || !phone) return { ok: false, error: 'validation' };
  const cache = CacheService.getScriptCache();
  const eid = str_(d.event_id, 64).replace(/[^\w-]/g, '');
  if (eid && cache.get('ev:' + eid)) return { ok: true, dup: true };  // повтор той же отправки
  const minute = 'rate:' + Math.floor(Date.now() / 60000), n = +(cache.get(minute) || 0);
  if (n >= MAX_PER_MIN) return { ok: false, error: 'rate' };
  cache.put(minute, String(n + 1), 120);
  const repeat = !!cache.get('ph:' + phone.digits);
  cache.put('ph:' + phone.digits, '1', 3600);
  const utm = d.utm || {};
  const lead = {
    test: !!d.test, name, phone, eid,
    pref: str_(d.pref, 20), tg: tgUser_(d.tg), plan: str_(d.plan, 80), exp: str_(d.exp, 60), goal: str_(d.goal, 60),
    state: str_(d.state, 40), start: str_(d.start, 60), pay: str_(d.pay, 60), gift: d.gift ? 'да' : '',
    lang: d.lang === 'uk' ? 'UA' : 'RU', page: str_(d.page, 300),
    source: join_(' / ', str_(utm.source, 40), str_(utm.medium, 40)) || host_(d.ref) || 'прямой заход',
    campaign: str_(utm.campaign, 120), ad: str_(utm.content, 120)
  };
  let saved = true;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); saveRow_(lead); }
  catch (err) { saved = false; console.error(err); }
  finally { lock.releaseLock(); }
  const sent = notify_(lead, repeat, saved);
  if (!saved && !sent) return { ok: false, error: 'server' };  // сайт покажет человеку Telegram и Calendly
  if (eid) cache.put('ev:' + eid, '1', 21600);
  meta_(lead, d);
  return { ok: true };
}

// ---------- таблица ----------

function sheet_(ss) {
  ss = ss || SpreadsheetApp.openById(PROPS().getProperty('SHEET_ID'));
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET, 0); sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

function saveRow_(l) {
  sheet_().appendRow([stamp_(), l.test ? 'Тест' : 'Новая', l.name, l.phone.pretty, l.pref, l.tg ? '@' + l.tg : '', l.plan,
    l.exp, l.goal, l.state, l.start, l.pay, l.gift, l.lang, l.source, l.campaign, l.ad, l.page, l.eid, ''].map(cell_));
}

function remember_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) PROPS().setProperty('SHEET_ID', ss.getId());
}

// ---------- Telegram ----------

function notify_(l, repeat, saved) {
  const p = PROPS(), token = p.getProperty('TG_TOKEN'), chat = p.getProperty('TG_CHAT');
  const text = [
    (l.test ? '🧪 Тестовая заявка' : repeat ? '🔁 Повторная заявка' : '🔥 Новая заявка') + ' — Beauty Mafia',
    '👤 ' + l.name + ' · ' + l.lang,
    '📞 ' + l.phone.pretty + (l.pref ? ' · ' + l.pref : ''),
    l.tg && '✈️ @' + l.tg,
    l.plan && '🎓 ' + l.plan,
    join_(' · ', l.exp, l.goal) && '📋 ' + join_(' · ', l.exp, l.goal),
    join_(' · ', l.state && '📍 ' + l.state, l.start && '⏱ ' + l.start, l.pay && '💳 ' + l.pay),
    l.gift && '🎁 Подарок: стартовый набор мастера',
    '📣 ' + join_(' · ', l.source, l.campaign, l.ad),
    saved ? '' : '⚠️ Не записано в таблицу — меню «Beauty Mafia» → «1. Подготовить таблицу»'
  ].filter(Boolean).join('\n');
  const buttons = [[{ text: '💬 WhatsApp', url: 'https://wa.me/' + l.phone.digits + '?text=' + encodeURIComponent(greeting_(l)) }]];
  if (l.tg) buttons[0].push({ text: '✈️ Telegram', url: 'https://t.me/' + l.tg });
  const id = p.getProperty('SHEET_ID');
  if (id) buttons.push([{ text: '📊 Таблица заявок', url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' }]);
  if (token && chat) {
    const r = tg_(token, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: buttons } });
    if (r.ok) return true;
    p.setProperty('TG_LAST_ERROR', stamp_() + ' ' + (r.description || ''));
  }
  try {  // Telegram не настроен или недоступен — письмо владельцу, чтобы заявка не пропала
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Заявка с сайта: ' + l.name, text);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function greeting_(l) {
  const first = l.name.split(/\s+/)[0];
  return l.lang === 'UA'
    ? 'Вітаю, ' + first + '! Це Максим, Beauty Mafia Hair Academy 💇‍♀️ Ви залишили заявку на навчання — зручно зараз обговорити деталі?'
    : 'Здравствуйте, ' + first + '! Это Максим, Beauty Mafia Hair Academy 💇‍♀️ Вы оставили заявку на обучение — удобно сейчас обсудить детали?';
}

function tg_(token, method, body) {
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true
    });
    return JSON.parse(r.getContentText());
  } catch (err) {
    return { ok: false, description: String(err) };
  }
}

// ---------- Meta Conversions API ----------

function meta_(l, d) {
  const p = PROPS(), token = p.getProperty('META_TOKEN');
  if (!token || !l.eid || l.test) return;
  const ud = { ph: [sha_(l.phone.digits)], fn: [sha_(l.name.split(/\s+/)[0].toLowerCase())] };
  if (l.phone.digits.length === 11 && l.phone.digits.charAt(0) === '1') ud.country = [sha_('us')];
  if (d.vid) ud.external_id = [sha_(str_(d.vid, 64))];
  if (d.fbp) ud.fbp = str_(d.fbp, 120);
  if (d.fbc) ud.fbc = str_(d.fbc, 300);
  if (d.ua) ud.client_user_agent = str_(d.ua, 400);
  const body = { data: [{ event_name: 'Lead', event_time: Math.floor(Date.now() / 1000), event_id: l.eid, action_source: 'website',
    event_source_url: l.page || 'https://beautymafia.academy/', user_data: ud, custom_data: { content_name: 'quiz' } }] };
  const test = p.getProperty('META_TEST');
  if (test) body.test_event_code = test;
  try {
    const r = UrlFetchApp.fetch(GRAPH + PIXEL + '/events?access_token=' + encodeURIComponent(token), {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) p.setProperty('META_LAST_ERROR', stamp_() + ' ' + r.getContentText().slice(0, 300));
  } catch (err) {
    p.setProperty('META_LAST_ERROR', stamp_() + ' ' + String(err).slice(0, 300));
  }
}

// ---------- помощники ----------

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function stamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function join_(sep, ...xs) { return xs.filter(Boolean).join(sep); }
function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function cell_(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }  // «=…» в ячейке не станет формулой
function host_(u) { const m = String(u || '').match(/^https?:\/\/([^\/?#]+)/i); return m ? m[1].replace(/^www\./, '') : ''; }
function tgUser_(v) { const m = String(v || '').trim().replace(/^@|^https?:\/\/t\.me\//i, '').match(/^[A-Za-z0-9_]{4,32}$/); return m ? m[0] : ''; }

function phone_(v) {  // США — 10 цифр (или 11 с единицей), другие страны — с кодом страны
  const s = String(v || '');
  let dg = s.replace(/\D/g, '');
  if (dg.length === 10 && !/^\s*\+/.test(s)) dg = '1' + dg;
  if (dg.length < 8 || dg.length > 15) return null;
  const pretty = dg.length === 11 && dg.charAt(0) === '1'
    ? '+1 (' + dg.substr(1, 3) + ') ' + dg.substr(4, 3) + '-' + dg.substr(7)
    : '+' + dg;
  return { digits: dg, pretty };
}

function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
