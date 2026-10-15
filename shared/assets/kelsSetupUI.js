// kelsSetupUI.js — Kels's "Get set up": a new breeder's first run through her
// kennel's settings, as a chat on pages/kels.html. Each part is saved as it's
// answered (nothing to draft), and every part can be skipped. The parts, each only
// where this edition has what it sets up (data/kelsSetup.js `setupParts`):
//   1. her logo (where something prints it), the Kennel page's own upload;
//   2. lifecycle nudges (the Kennel page's fields);
//   3. Puppy Record fields (Pro): everything, or what to leave off;
//   4. another kennel (Pro, multi-kennel), for a separate side of the business: two
//      breeds with their own waitlists, a pet side and a show side; it starts with
//      the nudge and Puppy Record settings from 1–3, and its own logo;
//   5. Google Drive for Furever (Pro), connected right here (Google's own sign-in
//      window, opened from her tap);
//   6. Dropbox for KennelAssistant (Pro): Dropbox sends her back to the page that
//      asked, so it connects on the KennelAssistant page, in a new tab;
//   7. backup: cloud backup when it isn't on (kelsBackupSteps.offerCloudBackup), else
//      a backup file when she has none recent;
// then Add dogs or Add people (Pro) straight from here, through `handoff`.
// Every save goes through kennelRepo; the form pieces are the Kennel page's own
// (assets/kennelSettingsFields.js, Pro-only like that page, so it's imported only
// by the parts that use it: Lite, with no Kennel page, gets the backup and her dogs).
// Not offered in the Demo, which saves nothing.
import { kennelRepo } from '../data/kennelRepo.js';
import { ownKennels } from '../data/kennelScope.js';
import { resolveMyKennelId } from '../data/kennelSetup.js';
import { editionFlags, edition } from '../data/editionConfig.js';
import { isProOnlyPage } from '../data/proPages.js';
import { isCloudAvailable } from '../data/cloud/cloudConfig.js';
import { setupParts, logoUses, listWords, settingsToCopy, newKennelNameProblem, possessive, SETUP_HOW } from '../data/kelsSetup.js';
import { EXPORT_MAX_DAYS } from '../data/accountHealth.js';
import { getLastBackupDate, setFureverSettings } from '../data/settings.js';
import { downloadBackup } from '../data/importExport.js';
import { isDropboxConnected } from '../data/dropbox.js';
import { offerCloudBackup, cloudBackupOn } from './kelsBackupSteps.js';
import { field, input, val, kennelNameField, pagesPrefix } from './kelsSteps.js';
import { esc } from './ui.js';

export async function runSetupTask(chat, { onExit = () => {}, handoff = null } = {}) {
  if (!(await chat.intro('Welcome aboard! Let\'s get KennelOS set up just the way you like it.', SETUP_HOW))) return onExit('nevermind');
  return new Setup(chat, onExit, handoff).start();
}

const DAY = 86_400_000;

// The Kennel page's form pieces (Pro-only; see above).
const fields = () => import('./kennelSettingsFields.js');

// Google's sign-in script (vendored, like the Furever page's), loaded only when
// she asks to connect Drive: the button that opens Google's window must find it
// already there, since a window opened later than her tap is blocked.
let gsiLoading = null;
function loadGoogleSignIn() {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) return Promise.resolve();
  gsiLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/gsi/client.js', import.meta.url).href;
    s.onload = () => resolve();
    s.onerror = () => { gsiLoading = null; reject(new Error('Google sign-in couldn\'t load. Check your connection.')); };
    document.head.appendChild(s);
  });
  return gsiLoading;
}

class Setup {
  constructor(chat, onExit, handoff) {
    Object.assign(this, { chat, onExit, handoff, added: [] });
  }

  async start() {
    const kennels = (await ownKennels()).filter((k) => !k.is_archived);
    if (!kennels.length) {
      await this.chat.say('You\'ll need your kennel set up first. Once it is, come back and we\'ll do the rest together.');
      return this.onExit('done');
    }
    const mine = await resolveMyKennelId();
    let kennel = kennels.length === 1 ? kennels[0] : null;
    if (!kennel) {
      await this.chat.say('<strong>Which kennel are we setting up?</strong>');
      const id = await this.chat.choose([
        ...kennels.map((k) => ({ label: k.kennel_name || 'Your kennel', value: k.id, primary: k.id === mine })),
        { label: 'Never mind', value: '' }
      ]);
      if (!id) return this.onExit('nevermind');
      kennel = kennels.find((k) => k.id === id);
    }
    this.kennel = kennel;

    const kennelPage = !(edition === 'lite' && isProOnlyPage('kennel.html'));
    const parts = setupParts(editionFlags, { kennelPage });
    for (const [i, part] of parts.entries()) {
      this.first = i === 0;
      await this[part]();
    }
    return this.next();
  }

  get name() { return esc(this.kennel.kennel_name || 'your kennel'); }

  async reload() { this.kennel = await kennelRepo.getById(this.kennel.id); }

  // --- 1. Logo -----------------------------------------------------------------
  async logo() {
    const { logoPreview } = await fields();
    const uses = listWords(logoUses(editionFlags));
    if (this.kennel.logo_data_url) {
      await this.chat.say(`First up, your logo. ${this.name} already has one, and it goes on your ${uses}:<br>${logoPreview(this.kennel, { max: 120 })}`);
      const pick = await this.chat.choose([{ label: 'Keep it', value: '', primary: true }, { label: 'Change it', value: 'change' }]);
      if (pick === 'change') await this.askLogo(this.kennel);
      else await this.chat.say('Lovely, it stays.', { typing: 300 });
      return;
    }
    await this.chat.say(`First up, your logo! It goes at the top of your ${uses}. Have one handy?`);
    const pick = await this.chat.choose([{ label: 'Upload my logo', value: 'yes', primary: true }, { label: 'Skip for now', value: '' }]);
    if (pick === 'yes') await this.askLogo(this.kennel);
    else await this.chat.say('No problem. You can add it any time from your kennel\'s page.', { typing: 300 });
  }

  // A logo file picked, scaled and saved on `kennel`. → true when saved.
  async askLogo(kennel) {
    const { fileToLogoDataUrl, logoPreview, LOGO_ACCEPT } = await fields();
    const res = await this.chat.form({
      title: `<strong>Choose ${esc(possessive(kennel.kennel_name))} logo.</strong><span class="kels-lead">A square or wide image works best; I'll scale a big one down.</span>`,
      html: `${field('Logo', `<input id="ks-logo" type="file" accept="${LOGO_ACCEPT}">`)}<div id="ks-logo-preview"></div>`,
      wire: (root, { showError }) => {
        root.querySelector('#ks-logo').addEventListener('change', async (e) => {
          const file = e.target.files[0];
          root.querySelector('#ks-logo-preview').innerHTML = '';
          if (!file) return;
          try {
            root._logo = await fileToLogoDataUrl(file);
            root.querySelector('#ks-logo-preview').innerHTML = logoPreview({ ...kennel, logo_data_url: root._logo }, { max: 120 });
            showError('');
          } catch (err) { root._logo = null; showError(err.message || String(err)); }
        });
      },
      submit: async (root) => {
        if (!root._logo) return 'Choose your logo first.';
        await kennelRepo.update(kennel.id, { logo_data_url: root._logo });
        return true;
      },
      submitLabel: 'Use this logo',
      cancelLabel: 'Skip for now',
      reply: () => 'Here\'s my logo'
    });
    if (!res.done) return false;
    if (kennel.id === this.kennel.id) await this.reload();
    await this.chat.say('Gorgeous! It\'ll be on everything you print from now on.', { typing: 400 });
    return true;
  }

  // --- 2. Lifecycle nudges -----------------------------------------------------
  async nudges() {
    const { nudgeFields, readNudgeFields } = await fields();
    const res = await this.chat.form({
      title: '<strong>Next, lifecycle nudges.</strong><span class="kels-lead">When a puppy you kept gets old enough to join your breeding program, I can put a reminder on your Today page to move them up. Here\'s how I\'d set it; change the ages to suit your breed.</span>',
      html: nudgeFields(this.kennel, { on: this.kennel.promote_nudge_enabled ?? true }),
      submit: async (root) => {
        const changes = readNudgeFields(root);
        await kennelRepo.update(this.kennel.id, changes);
        return changes;
      },
      reply: (r) => (r.promote_nudge_enabled ? `Nudge me at ${r.promote_age_male_months} months for boys, ${r.promote_age_female_months} for girls` : 'No nudges, thanks'),
      cancelLabel: 'Skip for now'
    });
    if (!res.done) return this.chat.say('Okay, I\'ll leave those as they are. They\'re on your kennel\'s page whenever you want them.', { typing: 300 });
    await this.reload();
    await this.chat.say(res.result.promote_nudge_enabled ? 'Done! You\'ll never miss a keeper\'s big day.' : 'Got it, no nudges.', { typing: 400 });
  }

  // --- 3. Puppy Record fields (Pro) ------------------------------------------------
  async 'puppy-record'() {
    const { puppyRecordFieldsHtml, wirePuppyRecordFields, readPuppyRecordFields } = await fields();
    await this.chat.say('Now your puppy records: the printout each family takes home, with their pup\'s details, parents, health history and their own contact details. Right now they show everything. Want to keep it that way, or choose what\'s left off?');
    const pick = await this.chat.choose([{ label: 'Show everything', value: '', primary: true }, { label: 'Let me choose', value: 'choose' }]);
    if (pick !== 'choose') {
      if (this.kennel.puppy_record_fields) await kennelRepo.update(this.kennel.id, { puppy_record_fields: null });
      await this.reload();
      return this.chat.say('Everything it is. Families love a full record.', { typing: 300 });
    }
    const res = await this.chat.form({
      title: '<strong>Untick what to leave off.</strong><span class="kels-lead">A section with its box unticked is left off, heading and all.</span>',
      html: `<div class="form-grid">${puppyRecordFieldsHtml(this.kennel)}</div>`,
      wire: (root) => wirePuppyRecordFields(root),
      submit: async (root) => { await kennelRepo.update(this.kennel.id, { puppy_record_fields: readPuppyRecordFields(root) }); return true; },
      reply: () => 'That\'s what I want on them',
      cancelLabel: 'Skip for now'
    });
    await this.reload();
    if (res.done) await this.chat.say('Saved! Every puppy record you print will look just like that.', { typing: 300 });
  }

  // --- 4. Another kennel (Pro, multi-kennel) -----------------------------------------
  async kennels() {
    const programs = editionFlags.waitlist ? ' (If it\'s just two breeds on one waitlist, a program for each breed may be all you need.)' : '';
    await this.chat.say(`Some breeders keep two sides of the business apart: two breeds with their own waitlists, say, or a pet-home side and a show side. Each kennel gets its own dogs, litters${editionFlags.waitlist ? ', waitlist' : ''}, money and reports, and you can switch between them, or see them all, from the kennel menu at the top.${programs} Do you need another kennel?`);
    let pick = await this.chat.choose([{ label: 'Yes, add another kennel', value: 'yes' }, { label: 'No, one is plenty', value: '', primary: true }]);
    while (pick === 'yes') {
      const added = await this.addKennel();
      if (!added) break;
      await this.chat.say('Need another one?', { typing: 300 });
      pick = await this.chat.choose([{ label: 'Add another kennel', value: 'yes' }, { label: 'That\'s all', value: '', primary: true }]);
    }
    if (!this.added.length) await this.chat.say(`Perfect, ${this.name} it is. You can add one any time from Kennels.`, { typing: 300 });
  }

  // One new own kennel, with this one's nudge and Puppy Record settings. → it, or null.
  async addKennel() {
    const all = await kennelRepo.getAll();
    const warned = new Set();
    const res = await this.chat.form({
      title: '<strong>What\'s the new kennel called?</strong>',
      html: `${kennelNameField('ks-k-name')}
        ${field('Kennel prefix (optional)', input('ks-k-prefix', '', { placeholder: 'For registered names' }))}
        ${field('Location (optional)', input('ks-k-location', ''))}`,
      submit: async (root) => {
        const name = val(root, 'ks-k-name');
        const problem = newKennelNameProblem(name, all);
        if (typeof problem === 'string') return problem;
        if (problem && !warned.has(problem.key)) { warned.add(problem.key); return problem.message; }
        return kennelRepo.create({
          kennel_name: name, prefix: val(root, 'ks-k-prefix') || null, location: val(root, 'ks-k-location') || null,
          is_own_kennel: true, ...settingsToCopy(this.kennel)
        });
      },
      reply: (k) => k.kennel_name,
      submitLabel: 'Add',
      cancelLabel: 'Never mind'
    });
    if (!res.done) return null;
    const k = res.result;
    this.added.push(k);
    await this.chat.say(`${esc(k.kennel_name)} is ready! It starts with ${esc(possessive(this.kennel.kennel_name))} nudge${editionFlags.puppyRecord ? ' and puppy record' : ''} settings; you can change them on its own page.`);
    if (logoUses(editionFlags).length) await this.newKennelLogo(k);
    return k;
  }

  async newKennelLogo(k) {
    await this.chat.say(`Does ${esc(k.kennel_name)} have its own logo?`, { typing: 300 });
    const pick = await this.chat.choose([
      { label: 'Upload its logo', value: 'own', primary: true },
      ...(this.kennel.logo_data_url ? [{ label: `Use ${possessive(this.kennel.kennel_name)}`, value: 'same' }] : []),
      { label: 'Not now', value: '' }
    ]);
    if (pick === 'own') return this.askLogo(k);
    if (pick === 'same') {
      await kennelRepo.update(k.id, { logo_data_url: this.kennel.logo_data_url });
      return this.chat.say('Done, they match.', { typing: 300 });
    }
  }

  // --- 5. Google Drive for Furever (Pro) ----------------------------------------------
  async furever() {
    await this.chat.say('When a pup goes home, Furever is their family\'s own app for them. You can send along your care guides and the pup\'s papers through your Google Drive, and KennelOS does the uploading. It can only ever see the files it makes there, nothing else. Want to connect Google Drive now?');
    const pick = await this.chat.choose([{ label: 'Connect Google Drive', value: 'yes', primary: true }, { label: 'Not now', value: '' }]);
    if (pick !== 'yes') return this.chat.say('No problem. Furever will ask when you publish your first files.', { typing: 300 });
    try {
      await loadGoogleSignIn();
    } catch (err) {
      return this.chat.say(`${esc(err.message)} Furever will ask again when you publish your first files.`);
    }
    // Google's window opens from this tap (connectDrive is called before any wait).
    const { connectDrive } = await import('../data/googleDrive.js');
    const res = await this.chat.form({
      title: 'Tap <strong>Connect</strong> and Google will ask you to sign in and allow it.',
      html: '<p class="field-hint">A Google window opens. If nothing appears, check whether your browser blocked a pop-up.</p>',
      submit: async () => {
        await connectDrive();
        setFureverSettings({ driveConnected: true });
        return true;
      },
      submitLabel: 'Connect',
      cancelLabel: 'Not now',
      reply: () => 'Connected!'
    });
    if (res.done) await this.chat.say('Google Drive is connected! Google may ask you to sign in again now and then; Furever\'s Publish will ask when it needs to.');
    else await this.chat.say('No problem. Furever will ask when you publish your first files.', { typing: 300 });
  }

  // --- 6. Dropbox for KennelAssistant (Pro) --------------------------------------------
  async assistant() {
    if (isDropboxConnected()) {
      return this.chat.say('KennelAssistant, the app for a helper\'s phone, works through your Dropbox, and it\'s already connected. Nice!', { typing: 400 });
    }
    await this.chat.say('Do you have help with the dogs? KennelAssistant is a little app for a helper\'s phone: they see your dogs, log feedings, weights and notes, and you bring their updates in. It works through your Dropbox (only a KennelOS folder, nothing else). Want to connect Dropbox?');
    const pick = await this.chat.choose([{ label: 'Connect Dropbox', value: 'yes', primary: true }, { label: 'Not now', value: '' }]);
    if (pick !== 'yes') return this.chat.say('No problem. It\'s under Sharing whenever you want it.', { typing: 300 });
    await this.chat.say('Dropbox connects on the KennelAssistant page, so I\'ll open it in a new tab. Tap <strong>Connect Dropbox</strong> there and sign in, then come back here. I\'ll be waiting!');
    if ((await this.chat.choose([{ label: 'Okay, open it', value: 'go', primary: true }, { label: 'Not now', value: '' }])) !== 'go') {
      return this.chat.say('No problem. It\'s under Sharing whenever you want it.', { typing: 300 });
    }
    const href = `${pagesPrefix()}assistant.html`;
    const tab = window.open(href, '_blank');
    if (!tab) await this.chat.say(`Your browser blocked the new tab. <a href="${esc(href)}" target="_blank" rel="noopener">Tap here to open KennelAssistant</a>.`);
    for (;;) {
      const back = await this.chat.choose([{ label: 'I\'m back, check it now', value: 'check', primary: true }, { label: 'Skip it for now', value: '' }]);
      if (!back) return this.chat.say('No problem. It\'s under Sharing whenever you want it.', { typing: 300 });
      if (isDropboxConnected()) return this.chat.say('Dropbox is connected! Send your helper the dogs from the KennelAssistant page whenever they\'re ready.');
      await this.chat.say('I don\'t see it connected yet. Did Dropbox finish? Give it another go in that tab, then tap below.', { typing: 400 });
    }
  }

  // --- 7. Backup -------------------------------------------------------------------
  async backup() {
    const cloud = isCloudAvailable();
    const lead = this.first ? 'Let\'s start with the most important one: backups.' : 'One more, and it\'s an important one: backups.';
    const why = 'Everything lives on this device, so if it\'s lost or broken, your records go with it.';
    if (cloud && (await cloudBackupOn())) return this.chat.say(`${this.first ? 'Your' : 'And your'} cloud backup is already on, so your records are safe. Smart move!`, { typing: 400 });
    if (cloud && await offerCloudBackup(this.chat, {
      line: `${lead} ${why} Cloud backup keeps a copy safe, and it backs up by itself after that. Want to turn it on? It only takes a minute.`
    })) return this.chat.say('Cloud backup is on. Your records are safe!', { typing: 400 });
    const last = getLastBackupDate();
    if (last && Date.now() - Date.parse(last) < EXPORT_MAX_DAYS * DAY) return;
    await this.chat.say(cloud
      ? 'Then let\'s at least save a backup file: you can bring everything back from it. Want to save one now? Keep it somewhere safe, like your email or a cloud drive.'
      : `${lead} ${why} A backup file brings them back. Want to save one now? Keep it somewhere safe, like your email or a cloud drive.`);
    const pick = await this.chat.choose([{ label: 'Download a backup now', value: 'yes', primary: true }, { label: 'Not now', value: '' }]);
    if (pick !== 'yes') return this.chat.say('No problem. It\'s on Import/Export whenever you\'re ready.', { typing: 300 });
    await downloadBackup();
    await this.chat.say('Saved! Do one now and then, after you\'ve added a lot.', { typing: 400 });
  }

  // --- Then: her dogs, or her people ------------------------------------------------
  async next() {
    await this.chat.say(`That's ${this.name} all set up, beautifully done! Want to start adding your dogs${editionFlags.contactsSection ? ' or your people' : ''} now?`, { typing: 700 });
    const pick = await this.chat.choose([
      { label: 'Add my dogs', value: 'add-dogs', primary: true },
      ...(editionFlags.contactsSection ? [{ label: 'Add my people', value: 'add-people' }] : []),
      { label: 'I\'m all set for now', value: '' }
    ]);
    if (pick && this.handoff) return this.handoff(pick);
    this.onExit('done');
  }
}
