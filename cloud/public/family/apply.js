// The online application form: /apply/<kennel public_id> (Waitlist Spec §5.1,
// §15.1, §15.8; W2 Plan step 4). Her questions in her order and wording, her FAQ
// first, the matching notice before the questions that decide which pups are
// offered, and the public-list notice to acknowledge. The answers are sealed in
// this browser to her form key (seal.js) before they're sent; the applicant then
// types the code emailed to them, which sends the application to her and signs
// this browser in (See Your Details). Inside her own website (embedded.js), the
// status page opens in a new tab instead.
import { esc, fetchJson, loadError, possessive, SEX_LABEL, READY_LABEL, PURPOSE_LABEL } from './common.js';
import { seal } from './seal.js';
import { rememberFamily } from './session.js';
import { EMBEDDED, setupEmbed, toTop, outward } from './embedded.js';

const $ = (id) => document.getElementById(id);
const publicId = decodeURIComponent(location.pathname.split('/')[2] || '');
let turnstileToken = null;

const FIELD_LIMIT = { short: 500, long: 10000 };

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = false;
}

const required = (q) => (q.required ? ' <span class="req" aria-label="required">*</span>' : '');
const help = (q) => (q.help && q.type !== 'notice' ? `<p class="small muted mt0">${esc(q.help)}</p>` : '');
const fieldId = (q) => `q_${q.id}`;

function radios(name, options, { requiredGroup = false } = {}) {
  return `<div class="choices" role="radiogroup">${options.map(([value, label]) => `
    <label class="choice"><input type="radio" name="${esc(name)}" value="${esc(value)}"${requiredGroup ? ' required' : ''}> ${esc(label)}</label>`).join('')}</div>`;
}

// One question as a form field. Preference questions use the app's own choices.
function fieldHtml(q, form) {
  const id = fieldId(q);
  const label = `<label class="q" for="${esc(id)}">${esc(q.label)}${required(q)}</label>`;
  switch (q.type) {
    case 'notice':
      return `<div class="card notice-card"><h2>${esc(q.label)}</h2><p class="pre">${esc(q.help)}</p>
        <label class="choice"><input type="checkbox" id="${esc(id)}" data-notice required> I understand</label>
        <label class="choice"><input type="checkbox" id="private_request"> Please show my name privately on the public list</label>
        <p class="small muted mt0">Your first name shows as its first letter and an asterisk for each letter after it, then your last initial (Andrea Kim shows as A***** K). The breeder decides whether to allow it; your place in line is the same either way.</p></div>`;
    case 'preference':
      return prefHtml(q, form);
    case 'long_text':
      return `<div class="field">${label}${help(q)}<textarea id="${esc(id)}" data-q="${esc(q.id)}" maxlength="${FIELD_LIMIT.long}" rows="4"></textarea></div>`;
    case 'email':
      return `<div class="field">${label}${help(q)}<input id="${esc(id)}" data-q="${esc(q.id)}" type="email" autocomplete="email" maxlength="254"></div>`;
    case 'number':
      return `<div class="field">${label}${help(q)}<input id="${esc(id)}" data-q="${esc(q.id)}" type="text" inputmode="decimal" maxlength="30"></div>`;
    case 'date':
      return `<div class="field">${label}${help(q)}<input id="${esc(id)}" data-q="${esc(q.id)}" type="date"></div>`;
    case 'yes_no':
      return `<fieldset class="field" data-q="${esc(q.id)}" data-kind="radio"><legend class="q">${esc(q.label)}${required(q)}</legend>${help(q)}${radios(id, [['yes', 'Yes'], ['no', 'No']])}</fieldset>`;
    case 'single_choice':
      return `<fieldset class="field" data-q="${esc(q.id)}" data-kind="radio"><legend class="q">${esc(q.label)}${required(q)}</legend>${help(q)}${radios(id, q.options.map((o) => [o, o]))}</fieldset>`;
    case 'checkboxes':
      return `<fieldset class="field" data-q="${esc(q.id)}" data-kind="checkboxes"><legend class="q">${esc(q.label)}${required(q)}</legend>${help(q)}
        <div class="choices">${q.options.map((o) => `<label class="choice"><input type="checkbox" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div></fieldset>`;
    default:
      return `<div class="field">${label}${help(q)}<input id="${esc(id)}" data-q="${esc(q.id)}" type="text" maxlength="${FIELD_LIMIT.short}"${q.key === 'name' ? ' autocomplete="name"' : ''}></div>`;
  }
}

function prefHtml(q, form) {
  const legend = `<legend class="q">${esc(q.label)}${q.key === 'ready_timing' ? required({ required: true }) : ''}</legend>`;
  switch (q.key) {
    case 'pref_sex':
      return `<fieldset class="field" data-pref="pref_sex">${legend}${radios('pref_sex', Object.entries(SEX_LABEL))}</fieldset>`;
    case 'pref_breed':
      if (!form.breeds.length) return '';
      return `<div class="field"><label class="q" for="pref_breed">${esc(q.label)}</label>
        <select id="pref_breed" data-pref="pref_breed"><option value="">Any breed</option>${form.breeds.map((b) => `<option>${esc(b)}</option>`).join('')}</select></div>`;
    case 'pref_purposes':
      return `<fieldset class="field" data-pref="pref_purposes">${legend}<p class="small muted mt0">Leave all unticked if any is fine.</p>
        <div class="choices">${Object.entries(PURPOSE_LABEL).map(([v, l]) => `<label class="choice"><input type="checkbox" value="${esc(v)}"> ${esc(l)}</label>`).join('')}</div></fieldset>`;
    case 'pref_colors':
      return `<div class="field"><label class="q" for="pref_colors">${esc(q.label)}</label>
        <input id="pref_colors" data-pref="pref_colors" type="text" maxlength="300" placeholder="Leave blank for any">
        <p class="small muted mt0">Separate colors with commas.${form.color_matching ? ' Only pups in a color you list will be offered.' : ''}</p></div>`;
    case 'ready_timing':
      return `<fieldset class="field" data-pref="ready_timing">${legend}${radios('ready_timing', Object.entries(READY_LABEL), { requiredGroup: true })}</fieldset>`;
    default:
      return '';
  }
}

function renderForm(view) {
  const { form } = view;
  const firstMatch = form.questions.find((q) => form.matching_keys.includes(q.key));
  $('questions').innerHTML = form.questions.map((q) => {
    const notice = q === firstMatch && form.matching_notice
      ? `<div class="card notice-card"><h2>Matching you with a pup</h2><p class="mt0">${esc(form.matching_notice)}</p></div>` : '';
    const html = fieldHtml(q, form);
    return notice + (html.startsWith('<div class="card') ? html : `<div class="card">${html}</div>`);
  }).join('');
}

function radioValue(name) {
  return document.querySelector(`input[name="${CSS.escape(name)}"]:checked`)?.value ?? '';
}

// The answers and preferences, plus what's missing.
function readForm(view) {
  const answers = {};
  const missing = [];
  for (const q of view.form.questions) {
    if (q.type === 'notice') {
      if (!$(fieldId(q)).checked) missing.push(q.label);
      continue;
    }
    if (q.type === 'preference') continue;
    let value;
    if (q.type === 'yes_no' || q.type === 'single_choice') value = radioValue(fieldId(q));
    else if (q.type === 'checkboxes') value = [...document.querySelectorAll(`fieldset[data-q="${CSS.escape(q.id)}"] input:checked`)].map((el) => el.value);
    else value = q.type === 'long_text' ? $(fieldId(q)).value : $(fieldId(q)).value.trim();
    answers[q.id] = value;
    const blank = Array.isArray(value) ? !value.length : !String(value).trim();
    if (q.required && blank) missing.push(q.label);
  }
  const prefs = {
    pref_sex: radioValue('pref_sex') || 'any',
    pref_breed: document.querySelector('[data-pref="pref_breed"]')?.value || '',
    pref_purposes: [...document.querySelectorAll('[data-pref="pref_purposes"] input:checked')].map((el) => el.value),
    pref_colors: (document.querySelector('[data-pref="pref_colors"]')?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    ready_timing: radioValue('ready_timing') || null,
  };
  const readyQ = view.form.questions.find((q) => q.key === 'ready_timing');
  if (readyQ && !prefs.ready_timing) missing.push(readyQ.label);
  const email = String(answers.email || '').trim();
  const badEmail = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const privateRequest = Boolean(document.getElementById('private_request')?.checked);
  return { answers, prefs, privateRequest, missing, badEmail };
}

const short = (label) => label.replace(/[?.!:]+$/, '');

async function loadTurnstile(siteKey) {
  if (!siteKey) return;
  $('turnstile-card').hidden = false;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  globalThis.turnstile.render('#turnstile', { sitekey: siteKey, callback: (t) => { turnstileToken = t; } });
}

function showConfirm(email, kennelName) {
  $('app-form').hidden = true;
  $('faq').hidden = true;
  $('confirm').hidden = false;
  $('confirm-email').textContent = email;
  $('code').focus();
  toTop();

  $('confirm-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = $('confirm-form').querySelector('button');
    button.disabled = true;
    const r = await fetchJson('/f/verify', { method: 'POST', json: { public_id: publicId, code: $('code').value } });
    button.disabled = false;
    if (r.ok) {
      rememberFamily(publicId, { session: r.body.session, statusToken: r.body.status_token, expiresAt: r.body.expires_at });
      const statusPath = `/s/${encodeURIComponent(r.body.status_token)}`;
      if (EMBEDDED) { showSent(statusPath, kennelName); return; }
      location.assign(statusPath);
      return;
    }
    const code = r.body?.error;
    $('confirm-result').textContent = code === 'invalid_code' || code === 'bad_code'
      ? "That code didn't work. Check it, or send a new one below."
      : loadError(r, { notFound: 'Please try again.' });
  });

  $('resend').addEventListener('click', async () => {
    const r = await fetchJson('/f/code', { method: 'POST', json: { public_id: publicId, email } });
    $('confirm-result').textContent = r.ok
      ? `A new code is on its way to ${email}.`
      : loadError(r, { notFound: 'Please try again.' });
  });
  document.title = `Confirm your application to ${kennelName}`;
}

// Embedded: the application is in. Her status page is one family's private page,
// so it opens in its own tab, never inside the breeder's website.
function showSent(statusPath, kennelName) {
  $('confirm').innerHTML = `<h2>Your application is in</h2>
    <p class="mt0">${esc(kennelName)} will review it. Your own status page shows your place in line and anything waiting for you. Bookmark it to come back.</p>
    <div class="actions"><a class="button primary" id="open-status" href="${esc(statusPath)}">Open my status page</a></div>`;
  outward($('open-status'));
  toTop();
}

async function load() {
  const res = await fetchJson(`/f/form/${encodeURIComponent(publicId)}`);
  if (!res.ok) {
    showError(loadError(res, { notFound: "This breeder isn't taking applications online right now. Please contact them directly." }));
    return;
  }
  const view = res.body;
  const kennelName = view.kennel.name;
  document.title = `Apply to ${possessive(kennelName)} Waitlist`;
  $('title').textContent = `Apply to ${possessive(kennelName)} Waitlist`;
  $('subtitle').textContent = 'Fields marked * are required.';
  if (view.form.faq.length) {
    $('faq-items').innerHTML = view.form.faq.map((x) => `<details><summary>${esc(x.question || 'Question')}</summary><p class="pre">${esc(x.answer)}</p></details>`).join('');
    $('faq').hidden = false;
  }
  renderForm(view);
  $('app-form').hidden = false;
  loadTurnstile(view.turnstile_site_key).catch(() => showError('The spam check could not load. Please reload the page.'));

  $('app-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { answers, prefs, privateRequest, missing, badEmail } = readForm(view);
    const problems = [];
    if (missing.length) problems.push(`Please answer: ${missing.map(short).join('; ')}.`);
    if (badEmail) problems.push("Your email address doesn't look right.");
    if (view.turnstile_site_key && !turnstileToken) problems.push('Please complete the check above the button.');
    $('form-problems').hidden = !problems.length;
    $('form-problems').textContent = problems.join(' ');
    if (problems.length) return;

    const button = $('submit');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const sealed = await seal(view.form.public_key, view.form.key_id, { answers, prefs, ...(privateRequest ? { private_request: true } : {}), sent_at: new Date().toISOString() });
      const r = await fetchJson(`/f/apply/${encodeURIComponent(publicId)}`, {
        method: 'POST',
        json: { key_id: view.form.key_id, sealed, name: String(answers.name || '').trim(), email: String(answers.email || '').trim(), turnstile: turnstileToken },
      });
      if (r.ok) { showConfirm(String(answers.email).trim(), kennelName); return; }
      const code = r.body?.error;
      const msg = code === 'form_changed' ? `${kennelName} just updated this form. Please reload the page and send it again (copy any long answers first).`
        : code === 'form_closed' ? `${kennelName} has stopped taking applications online.`
          : code === 'not_verified' ? 'The spam check failed. Please try it again.'
            : code === 'bad_email' ? "Your email address doesn't look right."
              : loadError(r, { notFound: 'Please try again.' });
      $('form-problems').textContent = msg;
      $('form-problems').hidden = false;
      if (globalThis.turnstile) { globalThis.turnstile.reset('#turnstile'); turnstileToken = null; }
    } finally {
      button.disabled = false;
      button.textContent = 'Send my application';
    }
  });
}

setupEmbed();
load();
