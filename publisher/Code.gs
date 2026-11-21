/**
 * LS Publisher — Learning & Sensory Ωραιόκαστρο
 *
 * Δημοσιεύει στο Instagram (post, carousel, story, reel) μέσω του Instagram Graph API και τα ίδια στη σελίδα
 * Facebook (post, πολλαπλές φωτογραφίες, story, reel), σύμφωνα με το queue.json του repo
 * malamaspe/learning-sensory-social. Στην ουρά μπαίνει μόνο ό,τι έχει εγκρίνει η υπεύθυνη του κέντρου.
 * Ανεξάρτητο από κάθε άλλο project: δικό του Sheet («LS Publisher»), δικά του Script Properties.
 *
 * Script Properties (Ρυθμίσεις έργου → Ιδιότητες σεναρίου):
 *   TOKEN_LS        Page access token της σελίδας (μόνιμο, «Expires: Never»). Το βάζεις εσύ.
 *   IG_USER_LS      Instagram Business Account ID     } τα βρίσκει και τα γράφει μόνο του
 *   FB_PAGE_LS      Facebook Page ID                   } το findInstagramIds()
 *   FB_ENABLED      false για να σταματήσει μόνο το Facebook
 *   PAUSED          true για παύση όλων των δημοσιεύσεων (ή pause() / resume())
 *   REEL_STORY      false για να ΜΗΝ βγαίνει κάθε reel και ως story (προεπιλογή: βγαίνει 15′ μετά)
 *   TRIAL_REELS     true για δοκιμαστικά reels (πρώτα σε μη ακολούθους). Προεπιλογή: false, κανονικά reels.
 *   GRAPH_VERSION   προαιρετικό, π.χ. v23.0 (κενό = η έκδοση της εφαρμογής Meta)
 *
 * Συναρτήσεις που τρέχεις με το χέρι (επιλογή πάνω στη γραμμή εργαλείων → Εκτέλεση):
 *   findInstagramIds()  βρίσκει και αποθηκεύει τα IDs Instagram και σελίδας Facebook
 *   checkSetup()        ελέγχει token, δικαιώματα, λογαριασμούς, ουρά και αρχεία (δεν δημοσιεύει)
 *   dryRun()            δοκιμή στο επόμενο post/story με εικόνα ΧΩΡΙΣ να δημοσιεύσει τίποτα
 *   dryRunReel()        δοκιμή στο επόμενο reel ΧΩΡΙΣ να δημοσιεύσει τίποτα (1–3 λεπτά)
 *   setup()             βάζει τον αυτόματο έλεγχο κάθε 10 λεπτά
 *   pause() / resume()  παύση / συνέχεια
 * Μενού «⚙️ Publisher» στο Sheet: «Αλλαγή ρύθμισης…», «Δες τις ρυθμίσεις» (χρειάζεται όταν οι Ιδιότητες
 * σεναρίου ξεπεράσουν τις 50, γιατί τότε η οθόνη του Apps Script τις δείχνει μόνο για ανάγνωση).
 */

const ACC = 'LS';
const ROOT_FOLDER = 'ΥΛΙΚΟ SOCIAL LEARNING & SENSORY';   // ο φάκελος Drive με το υλικό (Tidy.gs, Upload.gs)

const CFG = {
  QUEUE_URL: 'https://raw.githubusercontent.com/malamaspe/learning-sensory-social/main/queue.json',
  GRAPH: 'https://graph.facebook.com',
  LATE_LIMIT_MIN: 180,        // αν κάτι καθυστερήσει πάνω από 3 ώρες, δεν δημοσιεύεται (έρχεται email)
  MAX_FAILS: 3,               // μετά από 3 αποτυχίες σταματάει να ξαναδοκιμάζει (έρχεται email)
  EVERY_MIN: 10,
  REEL_STORY_DELAY_MIN: 15,   // το story ενός reel βγαίνει τόσα λεπτά μετά το reel
  QUEUE_WARN_DAYS: 5,         // email όταν η ουρά τελειώνει σε λιγότερες από τόσες ημέρες
};

// ------------------------------------------------------------------ helpers
function P_() { return PropertiesService.getScriptProperties(); }
function prop_(k, d) { const v = P_().getProperty(k); return v === null || v === '' ? d : v; }

function token_() {
  const t = prop_('TOKEN_' + ACC, '');
  if (!t) throw new Error('Λείπει το token: βάλε TOKEN_' + ACC + ' στις Ιδιότητες σεναρίου');
  return t;
}

function igUserId_() {
  const id = prop_('IG_USER_' + ACC, '');
  if (!id) throw new Error('Λείπει το IG_USER_' + ACC + ': τρέξε findInstagramIds()');
  return id;
}

function base_() {
  const v = prop_('GRAPH_VERSION', '');
  return v ? CFG.GRAPH + '/' + v : CFG.GRAPH;
}

function api_(method, path, params, tok) {
  const p = Object.assign({}, params || {}, { access_token: tok || token_() });
  let url = base_() + '/' + path;
  const opt = { method: method, muteHttpExceptions: true };
  if (method === 'get') {
    url += '?' + Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
  } else {
    opt.payload = p;
  }
  const res = UrlFetchApp.fetch(url, opt);
  let body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = { raw: res.getContentText() }; }
  if (res.getResponseCode() >= 400 || body.error) {
    const er = body.error || {};
    throw new Error('Graph API ' + res.getResponseCode() + ': ' + (er.message || res.getContentText()) +
      ' [code ' + (er.code || '') + ', subcode ' + (er.error_subcode || '') + ']');
  }
  return body;
}

function notify_(subject, text) {
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[LS Publisher] ' + subject, text);
  } catch (e) { console.error('email failed: ' + e.message); }
}

function athens_(d, fmt) { return Utilities.formatDate(d, 'Europe/Athens', fmt); }

function fetchQueue_() {
  const res = UrlFetchApp.fetch(CFG.QUEUE_URL + '?nocache=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Δεν διαβάστηκε το queue.json (' + res.getResponseCode() + ')');
  const q = JSON.parse(res.getContentText());
  q.items = withReelStories_((q.items || []).filter(function (it) { return !it.account || it.account === ACC; }));
  q.items.forEach(function (it) { it.account = ACC; });
  q.items.sort(function (a, b) { return new Date(a.publish_at) - new Date(b.publish_at); });
  return q;
}

// Κάθε reel της ουράς βγαίνει και ως story (το ίδιο βίντεο), REEL_STORY_DELAY_MIN λεπτά μετά.
// Όχι αν το reel έχει "story": false ή αν REEL_STORY = false.
function withReelStories_(items) {
  if (prop_('REEL_STORY', 'true') === 'false') return items;
  const have = {};
  items.forEach(function (it) { have[it.id] = true; });
  const extra = [];
  items.forEach(function (it) {
    if (it.type !== 'REEL' || it.story === false || !it.video) return;
    const id = String(it.id).replace(/-post$/, '') + '-reelstory';
    if (have[id]) return;
    extra.push({
      id: id, account: ACC, type: 'STORY', video: it.video, from_reel: it.id,
      caption: '(story από το reel ' + it.id + ')',
      publish_at: new Date(new Date(it.publish_at).getTime() + CFG.REEL_STORY_DELAY_MIN * 60000).toISOString(),
    });
  });
  return items.concat(extra);
}

// ------------------------------------------------------------------ Instagram
function createContainer_(igId, params, tok) {
  return api_('post', igId + '/media', params, tok).id;
}

function waitReady_(containerId, tries, sleepMs, tok) {
  tries = tries || 20; sleepMs = sleepMs || 3000;
  for (let i = 0; i < tries; i++) {
    const s = api_('get', containerId, { fields: 'status_code,status' }, tok);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error('Container ' + containerId + ': ' + s.status_code + ' ' + (s.status || ''));
    }
    Utilities.sleep(sleepMs);
  }
  throw new Error('Το container ' + containerId + ' δεν ετοιμάστηκε εγκαίρως');
}

function storyParams_(item) {
  return item.video ? { video_url: item.video, media_type: 'STORIES' } : { image_url: item.images[0], media_type: 'STORIES' };
}

function trialOn_(item) {
  return item.type === 'REEL' && item.trial !== false && prop_('TRIAL_REELS', 'false') === 'true';
}

function reelParams_(item, cap, trial) {
  const p = { media_type: 'REELS', video_url: item.video, caption: cap };
  if (item.cover) p.cover_url = item.cover;
  if (trial) p.trial_params = JSON.stringify({ graduation_strategy: prop_('TRIAL_STRATEGY', 'SS_PERFORMANCE') });
  else p.share_to_feed = 'true';
  return p;
}

function buildContainer_(item) {
  const ig = igUserId_(), tok = token_();
  const cap = item.caption || '';
  switch (item.type) {
    case 'IMAGE':
      return createContainer_(ig, { image_url: item.images[0], caption: cap }, tok);
    case 'STORY':
      return createContainer_(ig, storyParams_(item), tok);
    case 'CAROUSEL': {
      const kids = item.images.map(function (u) {
        return createContainer_(ig, { image_url: u, is_carousel_item: 'true' }, tok);
      });
      kids.forEach(function (k) { waitReady_(k, 0, 0, tok); });
      return createContainer_(ig, { media_type: 'CAROUSEL', children: kids.join(','), caption: cap }, tok);
    }
    case 'REEL':
      return createContainer_(ig, reelParams_(item, cap, trialOn_(item)), tok);
    default:
      throw new Error('Άγνωστος τύπος: ' + item.type);
  }
}

function publishItemOnce_(item) {
  const ig = igUserId_(), tok = token_();
  const c = buildContainer_(item);
  const isVideo = item.type === 'REEL' || !!item.video;
  waitReady_(c, isVideo ? 50 : 20, isVideo ? 5000 : 3000, tok);
  const r = api_('post', ig + '/media_publish', { creation_id: c }, tok);
  let link = '';
  try { link = api_('get', r.id, { fields: 'permalink' }, tok).permalink || ''; } catch (e) { /* τα stories δεν έχουν πάντα permalink */ }
  return { mediaId: r.id, permalink: link };
}

// Αν το Instagram δεν δεχτεί trial reel, βγαίνει ως κανονικό (email μία φορά).
function publishItem_(item) {
  if (!trialOn_(item)) return publishItemOnce_(item);
  try {
    return publishItemOnce_(item);
  } catch (e) {
    let r;
    try { r = publishItemOnce_(Object.assign({}, item, { trial: false })); } catch (e2) { throw e; }
    log_(item, 'Instagram: το trial δεν έγινε δεκτό, δημοσιεύτηκε ως κανονικό reel', e.message);
    if (!prop_('TRIAL_REJECTED', '')) {
      P_().setProperty('TRIAL_REJECTED', new Date().toISOString());
      notify_('Trial reel δεν έγινε δεκτό', 'Το Instagram δεν δέχτηκε το ' + item.id + ' ως δοκιμαστικό reel και δημοσιεύτηκε ως κανονικό.\n\n' + e.message);
    }
    return r;
  }
}

// ------------------------------------------------------------------ Facebook
function fbPageId_() { return prop_('FB_PAGE_' + ACC, ''); }

function fbEnabled_(item) {
  if (prop_('FB_ENABLED', 'true') === 'false') return false;
  if (!fbPageId_()) return false;
  return !item.platforms || item.platforms.indexOf('facebook') >= 0;
}

function igEnabled_(item) { return !item.platforms || item.platforms.indexOf('instagram') >= 0; }

// Βίντεο στο Facebook (reel ή video story): start → upload από URL → finish
function fbVideo_(pid, pt, edge, videoUrl, desc) {
  const st = api_('post', pid + '/' + edge, { upload_phase: 'start' }, pt);
  const up = UrlFetchApp.fetch(st.upload_url, {
    method: 'post', muteHttpExceptions: true,
    headers: { Authorization: 'OAuth ' + pt, file_url: videoUrl },
  });
  if (up.getResponseCode() >= 400) throw new Error('FB upload ' + up.getResponseCode() + ': ' + up.getContentText());
  const fin = { upload_phase: 'finish', video_id: st.video_id };
  if (edge === 'video_reels') { fin.video_state = 'PUBLISHED'; fin.description = desc || ''; }
  const r = api_('post', pid + '/' + edge, fin, pt);
  return { id: r.post_id || st.video_id, link: '' };
}

function publishFb_(item) {
  const pid = fbPageId_(), pt = token_();   // το TOKEN_LS είναι ήδη token της σελίδας
  const cap = item.fb_caption || item.caption || '';
  switch (item.type) {
    case 'IMAGE': {
      const r = api_('post', pid + '/photos', { url: item.images[0], message: cap, published: 'true' }, pt);
      return { id: r.post_id || r.id, link: 'https://www.facebook.com/' + (r.post_id || r.id) };
    }
    case 'CAROUSEL': {
      const p = { message: cap };
      item.images.forEach(function (u, i) {
        const ph = api_('post', pid + '/photos', { url: u, published: 'false' }, pt);
        p['attached_media[' + i + ']'] = JSON.stringify({ media_fbid: ph.id });
      });
      const r = api_('post', pid + '/feed', p, pt);
      return { id: r.id, link: 'https://www.facebook.com/' + r.id };
    }
    case 'STORY': {
      if (item.video) return fbVideo_(pid, pt, 'video_stories', item.video, '');
      const ph = api_('post', pid + '/photos', { url: item.images[0], published: 'false' }, pt);
      const r = api_('post', pid + '/photo_stories', { photo_id: ph.id }, pt);
      return { id: r.post_id || ph.id, link: '' };
    }
    case 'REEL':
      return fbVideo_(pid, pt, 'video_reels', item.video, cap);
    default:
      throw new Error('Άγνωστος τύπος: ' + item.type);
  }
}

// ------------------------------------------------------------------ main loop (trigger)
// Instagram και Facebook παρακολουθούνται χωριστά: αν αποτύχει το ένα, το άλλο δεν ξαναδημοσιεύεται.
// Κλειδιά: Instagram done_/fail_/skip_<id>, Facebook fbdone_/fbfail_/fbskip_<id>
function targets_(item) {
  const t = [];
  if (igEnabled_(item)) t.push({ pre: '', label: 'Instagram', fn: publishItem_, link: function (r) { return r.permalink || r.mediaId; } });
  if (fbEnabled_(item)) t.push({ pre: 'fb', label: 'Facebook', fn: publishFb_, link: function (r) { return r.link || r.id; } });
  return t;
}

function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const q = fetchQueue_();
    if (prop_('PAUSED', 'false') === 'true') { syncSheet_(q); return; }
    const S = P_();
    const now = new Date();
    q.items.forEach(function (item) {
      const when = new Date(item.publish_at);
      if (when > now) return;
      const late = (now - when) / 60000;
      targets_(item).forEach(function (t) {
        const kd = t.pre + 'done_' + item.id, ks = t.pre + 'skip_' + item.id, kf = t.pre + 'fail_' + item.id;
        if (S.getProperty(kd) || S.getProperty(ks)) return;
        if (late > CFG.LATE_LIMIT_MIN) {
          S.setProperty(ks, now.toISOString());
          log_(item, t.label + ': ΠΑΡΑΛΕΙΦΘΗΚΕ', 'Καθυστέρηση ' + Math.round(late) + ' λεπτά');
          notify_('Παραλείφθηκε ' + item.id + ' (' + t.label + ')', 'Το ' + item.id + ' δεν δημοσιεύτηκε στο ' + t.label + ' γιατί πέρασαν ' + Math.round(late) + ' λεπτά από την ώρα του.');
          return;
        }
        try {
          const r = t.fn(item);
          const link = t.link(r);
          S.setProperty(kd, JSON.stringify({ at: new Date().toISOString(), link: link, media: r.mediaId || r.id || '' }));
          S.deleteProperty(kf);
          log_(item, t.label + ': ΔΗΜΟΣΙΕΥΤΗΚΕ', link);
        } catch (e) {
          const n = Number(S.getProperty(kf) || 0) + 1;
          S.setProperty(kf, String(n));
          log_(item, t.label + ': ΣΦΑΛΜΑ ' + n + '/' + CFG.MAX_FAILS, e.message);
          if (n >= CFG.MAX_FAILS) {
            S.setProperty(ks, now.toISOString());
            notify_('Απέτυχε ' + item.id + ' (' + t.label + ')', 'Το ' + item.id + ' απέτυχε ' + n + ' φορές στο ' + t.label + ' και δεν θα ξαναδοκιμαστεί.\n\n' + e.message);
          }
        }
      });
    });
    try { queueEndCheck_(q, S, now); } catch (e) { console.log('Τέλος ουράς: ' + e.message); }
    syncSheet_(q);
  } catch (e) {
    notify_('Σφάλμα εκτέλεσης', e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// Email μία φορά όταν η ουρά τελειώνει σε λιγότερες από QUEUE_WARN_DAYS ημέρες (δεύτερο δίχτυ ασφαλείας·
// κανονικά το επόμενο πακέτο έχει ήδη εγκριθεί).
function queueEndCheck_(q, S, now) {
  const future = q.items.filter(function (it) { return new Date(it.publish_at) > now; });
  const last = future.length ? future[future.length - 1] : null;
  const key = last ? last.id : 'EMPTY-' + athens_(now, 'yyyy-MM');
  if (S.getProperty('QEND_WARNED') === key) return;
  const daysLeft = last ? (new Date(last.publish_at) - now) / 864e5 : 0;
  if (daysLeft >= CFG.QUEUE_WARN_DAYS) return;
  S.setProperty('QEND_WARNED', key);
  notify_('Η ουρά τελειώνει ' + (last ? 'στις ' + athens_(new Date(last.publish_at), 'd/M') : 'τώρα'),
    (last ? 'Η τελευταία προγραμματισμένη δημοσίευση είναι ' + last.id + ' (' + athens_(new Date(last.publish_at), 'd/M HH:mm') + ').'
      : 'Δεν υπάρχει καμία επόμενη δημοσίευση στην ουρά.') +
    '\nΑν το πακέτο του επόμενου μήνα δεν έχει εγκριθεί ακόμα, δες το email έγκρισης.');
}

// ------------------------------------------------------------------ sheet view
function sheet_(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function log_(item, status, detail) {
  const sh = sheet_('Ιστορικό', ['Χρόνος', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες']);
  sh.appendRow([new Date(), item.id, item.type, status, String(detail || '').slice(0, 500)]);
}

function status_(S, pre, id) {
  const done = S.getProperty(pre + 'done_' + id), skip = S.getProperty(pre + 'skip_' + id), fail = S.getProperty(pre + 'fail_' + id);
  if (done) { let l = ''; try { l = JSON.parse(done).link || ''; } catch (e) {} return ['Δημοσιεύτηκε', l]; }
  if (skip) return ['Δεν δημοσιεύτηκε', ''];
  if (fail) return ['Σφάλμα (' + fail + ')', ''];
  return ['Σε αναμονή', ''];
}

function syncSheet_(q) {
  const H = ['Ώρα δημοσίευσης', 'Τύπος', 'Λεζάντα', 'Αρχεία', 'Instagram', 'Link Instagram', 'Facebook', 'Link Facebook', 'ID'];
  const sh = sheet_('Ουρά', H);
  sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold');
  const S = P_();
  const rows = q.items.map(function (it) {
    const ig = igEnabled_(it) ? status_(S, '', it.id) : ['—', ''];
    const fb = fbEnabled_(it) ? status_(S, 'fb', it.id) : ['—', ''];
    const files = (it.images || []).length + (it.video ? 1 : 0);
    return [new Date(it.publish_at), it.type, String(it.caption || '').slice(0, 120), files, ig[0], ig[1], fb[0], fb[1], it.id];
  });
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, H.length).setValues(rows);
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('ddd dd/MM HH:mm');
  }
}

// ------------------------------------------------------------------ manual helpers
function findInstagramIds() {
  const r = api_('get', 'me', { fields: 'id,name,instagram_business_account{id,username}' }, token_());
  P_().setProperty('FB_PAGE_' + ACC, String(r.id));
  const ig = r.instagram_business_account;
  if (ig) P_().setProperty('IG_USER_' + ACC, String(ig.id));
  console.log('Σελίδα «' + r.name + '» (FB_PAGE_' + ACC + ' = ' + r.id + ')' +
    (ig ? ', Instagram @' + ig.username + ' (IG_USER_' + ACC + ' = ' + ig.id + ')' : ' — Η ΣΕΛΙΔΑ ΔΕΝ ΕΧΕΙ ΣΥΝΔΕΔΕΜΕΝΟ INSTAGRAM!'));
  console.log(ig ? 'Έτοιμο. Τρέξε τώρα το checkSetup.' : 'Σύνδεσε το Instagram με τη σελίδα (Ρυθμίσεις σελίδας → Συνδεδεμένοι λογαριασμοί) και ξανατρέξε.');
}

function checkSetup() {
  try {
    const t = token_();
    const d = api_('get', 'debug_token', { input_token: t }, t).data || {};
    const need = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_manage_posts'];
    const miss = need.filter(function (n) { return (d.scopes || []).indexOf(n) < 0; });
    const exp = !d.expires_at ? 'δεν λήγει' : 'ΛΗΓΕΙ ' + new Date(d.expires_at * 1000).toLocaleDateString('el-GR');
    console.log('TOKEN_' + ACC + ': ' + (d.type || '?') + ', ' + exp + ', ' + (miss.length ? 'ΛΕΙΠΟΥΝ ' + miss.join(', ') : 'δικαιώματα εντάξει') + (d.is_valid === false ? ', ΜΗ ΕΓΚΥΡΟ' : ''));
  } catch (e) { console.log('TOKEN_' + ACC + ': δεν ελέγχθηκε (' + e.message + ')'); }

  const id = igUserId_(), tok = token_();
  const u = api_('get', id, { fields: 'username,followers_count' }, tok);
  console.log('Instagram: @' + u.username + ' (' + u.followers_count + ' ακόλουθοι)');
  const pid = fbPageId_();
  if (!pid) console.log('Facebook: δεν έχει οριστεί FB_PAGE_' + ACC + ' (μόνο Instagram)');
  else {
    try {
      const pg = api_('get', pid, { fields: 'name,followers_count' }, tok);
      console.log('Facebook: ' + pg.name + ' (' + (pg.followers_count || 0) + ' ακόλουθοι)');
    } catch (e) { console.log('Facebook: ΣΦΑΛΜΑ ' + e.message); }
  }

  const q = fetchQueue_();
  const now = new Date();
  let bad = 0, checked = 0;
  q.items.forEach(function (it) {
    if (new Date(it.publish_at) < now) return;   // τα παλιά αρχεία σβήνονται από το repo μετά τη δημοσίευση
    (it.images || []).concat(it.video ? [it.video] : []).forEach(function (url) {
      checked++;
      const r = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
      if (r.getResponseCode() !== 200) { bad++; console.log('ΛΑΘΟΣ ' + r.getResponseCode() + ': ' + url); }
    });
  });
  console.log('Ουρά: ' + q.items.length + ' δημοσιεύσεις, ' + checked + ' επόμενα αρχεία, προβληματικά: ' + bad);
  syncSheet_(q);
}

function dryRun() {
  const q = fetchQueue_();
  const S = P_(), now = new Date();
  const next = q.items.filter(function (it) {
    return igEnabled_(it) && !S.getProperty('done_' + it.id) && new Date(it.publish_at) > now && it.images && it.images.length;
  })[0];
  if (!next) { console.log('Δεν υπάρχει επόμενη δημοσίευση με εικόνα.'); return; }
  const ig = igUserId_(), tok = token_();
  const c = next.type === 'STORY'
    ? createContainer_(ig, { image_url: next.images[0], media_type: 'STORIES' }, tok)
    : createContainer_(ig, { image_url: next.images[0], caption: 'dry run' }, tok);
  waitReady_(c, 0, 0, tok);
  console.log('Instagram OK: δέχτηκε την εικόνα του ' + next.id + '. ΔΕΝ δημοσιεύτηκε τίποτα.');
  if (fbEnabled_(next)) {
    const pid = fbPageId_();
    const ph = api_('post', pid + '/photos', { url: next.images[0], published: 'false' }, tok);
    try { api_('post', ph.id, { method: 'delete' }, tok); } catch (e) { /* μένει αδημοσίευτη, δεν φαίνεται πουθενά */ }
    console.log('Facebook OK: η σελίδα δέχτηκε την εικόνα (αδημοσίευτη, σβήστηκε). ΔΕΝ δημοσιεύτηκε τίποτα.');
  }
}

function dryRunReel() {
  const q = fetchQueue_();
  const now = new Date();
  const next = q.items.filter(function (it) { return it.type === 'REEL' && igEnabled_(it) && new Date(it.publish_at) > now; })[0];
  if (!next) { console.log('Δεν υπάρχει επόμενο reel στην ουρά.'); return; }
  const ig = igUserId_(), tok = token_();
  const c = createContainer_(ig, reelParams_(next, 'dry run', false), tok);
  waitReady_(c, 50, 5000, tok);
  console.log('Instagram OK: το reel ' + next.id + ' επεξεργάστηκε σωστά. ΔΕΝ δημοσιεύτηκε τίποτα.');
}

// ------------------------------------------------------------------ μενού «⚙️ Publisher» στο Sheet
const STATUS_KEY_ = /^(fb)?(done|fail|skip)_/;
function secretKey_(k) { return /TOKEN|KEY|SECRET/.test(k); }
function mask_(v) { v = String(v || ''); return v.length <= 10 ? '••••' : v.slice(0, 4) + '…' + v.slice(-4) + ' (' + v.length + ' χαρ.)'; }

function onOpen() {
  SpreadsheetApp.getUi().createMenu('⚙️ Publisher')
    .addItem('Αλλαγή ρύθμισης…', 'menuSetProperty')
    .addItem('Δες τις ρυθμίσεις', 'menuShowSettings')
    .addToUi();
}

function menuSetProperty() {
  const ui = SpreadsheetApp.getUi();
  const k = ui.prompt('Αλλαγή ρύθμισης', 'Όνομα ρύθμισης, π.χ. TOKEN_LS, FB_ENABLED, PAUSED, REEL_STORY:', ui.ButtonSet.OK_CANCEL);
  if (k.getSelectedButton() !== ui.Button.OK) return;
  const key = k.getResponseText().trim();
  if (!/^[A-Za-z0-9_]+$/.test(key)) { ui.alert('Μη έγκυρο όνομα: «' + key + '»'); return; }
  if (STATUS_KEY_.test(key)) { ui.alert('Το ' + key + ' το κρατάει μόνο του το script (κατάσταση δημοσίευσης). Δεν αλλάζει από εδώ.'); return; }
  const secret = secretKey_(key);
  const cur = P_().getProperty(key);
  const v = ui.prompt(key, 'Τωρινή τιμή: ' + (cur === null ? '(δεν υπάρχει)' : secret ? mask_(cur) : cur) +
    '\n\nΝέα τιμή (άφησέ το κενό για διαγραφή):', ui.ButtonSet.OK_CANCEL);
  if (v.getSelectedButton() !== ui.Button.OK) return;
  const val = v.getResponseText().trim();
  if (!val) {
    if (cur === null) return;
    if (ui.alert('Διαγραφή του ' + key + ';', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    P_().deleteProperty(key);
    ui.alert('Διαγράφηκε: ' + key);
    return;
  }
  P_().setProperty(key, val);
  ui.alert('Αποθηκεύτηκε: ' + key + ' = ' + (secret ? mask_(val) : val));
}

function menuShowSettings() {
  const all = P_().getProperties();
  let status = 0;
  const lines = Object.keys(all).sort().filter(function (k) {
    if (STATUS_KEY_.test(k)) { status++; return false; }
    return true;
  }).map(function (k) {
    const v = secretKey_(k) ? mask_(all[k]) : String(all[k]);
    return k + ' = ' + (v.length > 90 ? v.slice(0, 90) + '…' : v);
  });
  SpreadsheetApp.getUi().alert('Ρυθμίσεις', lines.join('\n') + '\n\n(+ ' + status + ' σημειώσεις κατάστασης δημοσιεύσεων)', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(CFG.EVERY_MIN).create();
  sheet_('Ιστορικό', ['Χρόνος', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες']);
  syncSheet_(fetchQueue_());
  console.log('Έτοιμο: ο έλεγχος τρέχει κάθε ' + CFG.EVERY_MIN + ' λεπτά.');
}

function pause() { P_().setProperty('PAUSED', 'true'); console.log('Παύση: δεν θα δημοσιευτεί τίποτα μέχρι resume().'); }
function resume() { P_().setProperty('PAUSED', 'false'); console.log('Συνέχεια δημοσιεύσεων.'); }
