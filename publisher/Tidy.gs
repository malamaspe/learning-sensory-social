/**
 * Διπλότυπα στον φάκελο υλικού (LS Publisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * dedupeMaterial(): ψάχνει ακριβή διπλότυπα (ίδιο περιεχόμενο, MD5 + μέγεθος) σε ΟΛΟ τον φάκελο
 *   «ΥΛΙΚΟ SOCIAL LEARNING & SENSORY» (και στους υποφακέλους), εκτός από τον «ΕΓΚΡΙΣΗ» που φτιάχνει το σύστημα.
 *   Κρατάει ένα αντίγραφο: πρώτα όσα ανήκουν σε σένα, μετά το παλιότερο. Έτσι, αν ξανανέβει κάτι που έχει
 *   ήδη χρησιμοποιηθεί (ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ) ή απορριφθεί (ΑΠΟΡΡΙΦΘΗΚΑΝ), το νέο αντίγραφο φεύγει.
 *   Τα υπόλοιπα: δικά σου → κάδος (30 ημέρες) · άλλων μελών του κέντρου → βγαίνουν μόνο από τον φάκελο
 *   (μένουν στο δικό τους Drive). Τίποτα δεν σβήνεται οριστικά. Email μόνο όταν βρει κάτι.
 * setupDailyDedupe(): τρέχει τον έλεγχο τώρα και μετά κάθε βράδυ (~04:00), αυτόματα. Μετά τα διπλότυπα, την ίδια
 *   νύχτα, κόβει και τα μεγάλα βίντεο για τον Claude (splitBigVideos, Transfer.gs).
 */
const TIDY_ = {
  BUDGET_MS: 4.5 * 60 * 1000,    // ασφαλώς κάτω από το όριο των 6 λεπτών του Apps Script
  API: 'https://www.googleapis.com/drive/v3/files',
  FOLDER: 'application/vnd.google-apps.folder',
};
const DEDUPE_SKIP_ = ['ΕΓΚΡΙΣΗ', '_ΜΕΤΑΦΟΡΑ'];   // αρχεία που φτιάχνει το ίδιο το σύστημα· δεν πειράζονται

function setupDailyDedupe() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dedupeMaterial') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dedupeMaterial').timeBased().everyDays(1).atHour(4).create();
  console.log('Έτοιμο: ο έλεγχος διπλοτύπων θα τρέχει κάθε βράδυ. Τρέχει και τώρα μία φορά…');
  dedupeMaterial();
}

// Κάθε βράδυ: διπλότυπα και μετά κόψιμο μεγάλων βίντεο για τον Claude (Transfer.gs), στον χρόνο που μένει.
function dedupeMaterial() {
  const start = Date.now();
  const n = dedupeOnly_(start + TIDY_.BUDGET_MS - 90 * 1000);
  try {
    splitBigVideos(start + TIDY_.BUDGET_MS);
  } catch (e) {
    notify_('Σφάλμα στο κόψιμο μεγάλων βίντεο', 'Η splitBigVideos σταμάτησε: ' + e.message + '\n\nΕνημερώστε τον Πέτρο.');
  }
  return n;
}

function dedupeOnly_(deadline) {
  const it = DriveApp.getFoldersByName(ROOT_FOLDER);
  if (!it.hasNext()) throw new Error('Δεν βρέθηκε ο φάκελος «' + ROOT_FOLDER + '».');
  const files = tidyWalk_(it.next().getId()).files.filter(function (f) {
    return f.md5 && DEDUPE_SKIP_.indexOf(f.path[0]) < 0;
  });
  const groups = {};
  files.forEach(function (f) { const k = f.md5 + '|' + f.size; (groups[k] = groups[k] || []).push(f); });
  const ops = [], lines = [];
  Object.keys(groups).forEach(function (k) {
    const g = groups[k];
    if (g.length < 2) return;
    g.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      return new Date(a.created) - new Date(b.created);
    });
    const keep = g[0];
    g.slice(1).forEach(function (f) {
      ops.push(f.mine ? { type: 'trash', id: f.id } : { type: 'unlink', id: f.id, from: f.parent });
      lines.push('• ' + f.path.join(' / ') + '  (ίδιο με: ' + keep.path.join(' / ') + ')');
    });
  });
  if (!ops.length) { console.log('Κανένα διπλότυπο σε ' + files.length + ' αρχεία.'); return 0; }
  const x = tidyExec_(ops, deadline);
  console.log('Διπλότυπα: ' + x.ok + '/' + ops.length + ' αφαιρέθηκαν (σε ' + files.length + ' αρχεία).');
  notify_('Διπλότυπα στο υλικό: ' + x.ok,
    'Βρέθηκαν και αφαιρέθηκαν ' + x.ok + ' αρχεία που υπήρχαν ήδη (ίδιο ακριβώς περιεχόμενο):\n\n' +
    lines.slice(0, 60).join('\n') + (lines.length > 60 ? '\n… και άλλα ' + (lines.length - 60) : '') +
    '\n\nΤα δικά σου πήγαν στον κάδο του Drive (30 ημέρες). Όσα είχε ανεβάσει άλλος βγήκαν μόνο από τον φάκελο.' +
    (x.ok < ops.length ? '\n\nΚάποια δεν αφαιρέθηκαν (' + (ops.length - x.ok) + '), θα ξαναδοκιμάσει αύριο.' : ''));
  return x.ok;
}

// ------------------------------------------------------------------ helpers (Drive API v3)
function tidyReq_(method, url, body) {
  const r = { url: url, method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { r.contentType = 'application/json'; r.payload = JSON.stringify(body); }
  return r;
}

function tidyJson_(res) {
  if (res.getResponseCode() >= 300) throw new Error('Drive API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

function tidyListUrl_(folderId, pageToken) {
  return TIDY_.API + '?pageSize=1000&q=' + encodeURIComponent("'" + folderId + "' in parents and trashed = false") +
    '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,md5Checksum,size,createdTime,ownedByMe)') +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
}

// Διαβάζει όλο το δέντρο (ανά επίπεδο, 20 φάκελοι παράλληλα).
function tidyWalk_(rootId) {
  const root = { id: rootId, name: '', folder: true, children: [], path: [] };
  const files = [];
  let level = [root];
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += 20) {
      let todo = level.slice(i, i + 20).map(function (n) { return { node: n, tok: '' }; });
      while (todo.length) {
        const res = UrlFetchApp.fetchAll(todo.map(function (t) { return tidyReq_('get', tidyListUrl_(t.node.id, t.tok)); }));
        const again = [];
        res.forEach(function (r, k) {
          const t = todo[k], j = tidyJson_(r);
          (j.files || []).forEach(function (x) {
            const c = { id: x.id, name: x.name, folder: x.mimeType === TIDY_.FOLDER, children: [], parent: t.node.id, mine: !!x.ownedByMe,
              md5: x.md5Checksum || '', size: x.size || '', created: x.createdTime, path: t.node.path.concat([x.name]) };
            t.node.children.push(c);
            (c.folder ? next : files).push(c);
          });
          if (j.nextPageToken) again.push({ node: t.node, tok: j.nextPageToken });
        });
        todo = again;
      }
    }
    level = next;
  }
  return { root: root, files: files };
}

function tidyExec_(ops, deadline) {
  let ok = 0;
  for (let i = 0; i < ops.length; i += 20) {
    if (Date.now() > deadline) break;
    const chunk = ops.slice(i, i + 20);
    const res = UrlFetchApp.fetchAll(chunk.map(function (o) {
      if (o.type === 'unlink') return tidyReq_('patch', TIDY_.API + '/' + o.id + '?removeParents=' + o.from + '&fields=id', {});
      return tidyReq_('patch', TIDY_.API + '/' + o.id + '?fields=id', { trashed: true });
    }));
    res.forEach(function (r) {
      if (r.getResponseCode() < 300) ok++;
      else console.log('Drive API ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    });
  }
  return { ok: ok };
}
