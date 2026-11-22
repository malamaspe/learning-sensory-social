/**
 * Μεγάλα βίντεο → κομμάτια, για να τα παίρνει ο Claude (LS Publisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * Η σύνδεση του Claude με το Drive κατεβάζει μόνο αρχεία έως 10 MB. Η splitBigVideos() κόβει κάθε βίντεο
 * του φακέλου υλικού που είναι μεγαλύτερο σε κομμάτια των 8 MB, μέσα στον υποφάκελο «_ΜΕΤΑΦΟΡΑ».
 *   - Τα πρωτότυπα ΔΕΝ αλλάζουν και ΔΕΝ μετακινούνται. Τίποτα δεν γίνεται δημόσιο: τα κομμάτια έχουν την ίδια
 *     κοινοποίηση με τον φάκελο υλικού.
 *   - Για κάθε βίντεο γράφεται και ένα «<όνομα>__<id>.manifest.json» με το MD5 του πρωτοτύπου και κάθε κομματιού,
 *     ώστε το ξαναένωμα να ελέγχεται byte προς byte (studio/join_parts.py).
 *   - Ό,τι έχει ήδη κοπεί δεν ξανακόβεται. Αν δεν προλάβει (όριο 6 λεπτών), συνεχίζει μόνο του σε 1 λεπτό.
 *   - Κομμάτια παλιότερα από 14 ημέρες πάνε στον κάδο (είναι προσωρινά αντίγραφα).
 * Τρέχει και κάθε βράδυ, αμέσως μετά τον έλεγχο διπλοτύπων (dedupeMaterial).
 */
const XFER_ = {
  DIR: '_ΜΕΤΑΦΟΡΑ',
  CHUNK: 8 * 1024 * 1024,          // 8 MB ανά κομμάτι (όριο λήψης 10 MB)
  MIN_SIZE: 9.5 * 1024 * 1024,     // μόνο ό,τι δεν κατεβαίνει ολόκληρο
  BUDGET_MS: 4.5 * 60 * 1000,
  KEEP_DAYS: 14,
};

function splitBigVideos(until) {
  const deadline = typeof until === 'number' ? until : Date.now() + XFER_.BUDGET_MS;   // από trigger έρχεται event object
  const it = DriveApp.getFoldersByName(ROOT_FOLDER);
  if (!it.hasNext()) throw new Error('Δεν βρέθηκε ο φάκελος «' + ROOT_FOLDER + '».');
  const root = it.next();
  const sub = root.getFoldersByName(XFER_.DIR);
  const dir = sub.hasNext() ? sub.next() : root.createFolder(XFER_.DIR);
  xferCleanupOld_(dir);

  const existing = {};
  const ef = dir.getFiles();
  while (ef.hasNext()) existing[ef.next().getName()] = true;

  // Μόνο απευθείας αρχεία του φακέλου υλικού (όχι ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ / ΑΠΟΡΡΙΦΘΗΚΑΝ / ΕΓΚΡΙΣΗ).
  const list = tidyJson_(UrlFetchApp.fetch(TIDY_.API + '?pageSize=1000&q=' + encodeURIComponent(
      "'" + root.getId() + "' in parents and trashed = false and mimeType contains 'video/'") +
      '&fields=' + encodeURIComponent('files(id,name,size,md5Checksum,createdTime)'),
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true })).files || [];
  const seen = {};
  const todo = list
    .filter(function (f) { return Number(f.size) > XFER_.MIN_SIZE; })
    .sort(function (a, b) { return new Date(a.createdTime) - new Date(b.createdTime); })
    .filter(function (f) { const k = f.md5Checksum + '|' + f.size; if (seen[k]) return false; seen[k] = true; return true; })
    .filter(function (f) { return !existing[xferBase_(f) + '.manifest.json']; });

  let done = 0, parts = 0, unfinished = false;
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i], base = xferBase_(f), size = Number(f.size);
    const n = Math.ceil(size / XFER_.CHUNK), man = [];
    for (let k = 0; k < n; k++) {
      const name = base + '.p' + ('0' + (k + 1)).slice(-2);
      const a = k * XFER_.CHUNK, b = Math.min(size, a + XFER_.CHUNK) - 1;
      if (Date.now() > deadline) { unfinished = true; break; }
      const r = UrlFetchApp.fetch(TIDY_.API + '/' + f.id + '?alt=media', {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + a + '-' + b }, muteHttpExceptions: true });
      if (r.getResponseCode() >= 300) throw new Error('Drive ' + r.getResponseCode() + ' για ' + f.name + ': ' + r.getContentText().slice(0, 200));
      const bytes = r.getContent();
      if (bytes.length !== b - a + 1) throw new Error('Λάθος μέγεθος κομματιού ' + name + ': ' + bytes.length);
      man.push({ name: name, size: bytes.length, md5: xferMd5_(bytes) });
      if (!existing[name]) { dir.createFile(Utilities.newBlob(bytes, 'application/octet-stream', name)); parts++; }
    }
    if (unfinished) break;
    dir.createFile(Utilities.newBlob(JSON.stringify({ id: f.id, name: f.name, size: size, md5: f.md5Checksum,
      created: f.createdTime, chunk: XFER_.CHUNK, parts: man }, null, 1), 'application/json', base + '.manifest.json'));
    done++;
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'splitBigVideos' && t.getEventType() === ScriptApp.EventType.CLOCK) ScriptApp.deleteTrigger(t);
  });
  if (unfinished) ScriptApp.newTrigger('splitBigVideos').timeBased().after(60 * 1000).create();
  console.log('Μεγάλα βίντεο: ' + done + ' έτοιμα (' + parts + ' νέα κομμάτια)' +
    (unfinished ? ' · συνεχίζει μόνο του σε 1 λεπτό για τα υπόλοιπα (' + (todo.length - done) + ').' : ' · τίποτα άλλο για κόψιμο.'));
  return { done: done, left: unfinished ? todo.length - done : 0 };
}

function xferBase_(f) { return f.name + '__' + f.id; }

function xferMd5_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    .map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

function xferCleanupOld_(dir) {
  const limit = Date.now() - XFER_.KEEP_DAYS * 864e5;
  const fs = dir.getFiles();
  while (fs.hasNext()) {
    const f = fs.next();
    if (f.getDateCreated().getTime() < limit) { try { f.setTrashed(true); } catch (e) { /* όχι δικό μας */ } }
  }
}
