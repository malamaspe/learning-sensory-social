# learning-sensory-social

Αυτόματες δημοσιεύσεις στο Instagram και στη σελίδα Facebook του **Learning & Sensory Ωραιόκαστρο**.

Το repo είναι δημόσιο, γιατί το Instagram Graph API κατεβάζει τα αρχεία από δημόσιο link τη στιγμή της δημοσίευσης. Εδώ μπαίνει **μόνο περιεχόμενο που έχει εγκρίνει η υπεύθυνη του κέντρου**, με θολωμένα τα πρόσωπα των παιδιών, χωρίς metadata (EXIF/τοποθεσία), και σβήνεται (μαζί με το ιστορικό του git) 3 ημέρες μετά τη δημοσίευση. Είναι ανεξάρτητο από κάθε άλλο repo, Sheet ή εφαρμογή.

```
queue.json                 το εγκεκριμένο πρόγραμμα (τι, πότε)
media/<ΕΕΕΕ-ΜΜ>/LS/...     τα αρχεία των επόμενων δημοσιεύσεων
publisher/                 Apps Script: Code.gs (δημοσίευση), Tidy.gs (διπλότυπα), Upload.gs (iPhone), appsscript.json
studio/                    εργαλεία παραγωγής (engine, privacy_check, make_reel, make_queue, build_approval_pdf, cleanup_repo)
studio/RUNBOOK.md          η διαδικασία του μήνα (παραγωγή → έγκριση με email → ουρά → καθαρισμός)
PRIVACY.md                 πολιτική απορρήτου (για την εφαρμογή Meta)
```

## Πώς δουλεύει
1. Η υπεύθυνη και οι συνεργάτιδες του κέντρου ανεβάζουν φωτογραφίες/βίντεο στον φάκελο Drive **«ΥΛΙΚΟ SOCIAL LEARNING & SENSORY»** (εφαρμογή Google Drive → + → Μεταφόρτωση).
2. Κάθε 20 του μήνα ο Claude φτιάχνει το πρόγραμμα του επόμενου μήνα (posts Δευ/Τετ/Παρ/Κυρ 21:00, story κάθε μέρα 09:30, reels όταν υπάρχει βίντεο), με θόλωμα κάθε προσώπου παιδιού σε κάθε φωτογραφία και κάθε καρέ βίντεο.
3. Στέλνει στην υπεύθυνη του κέντρου email με PDF προεπισκόπησης. Εκείνη απαντά «ΟΚ» / 👍 ή γράφει διορθώσεις (#αριθμός + αλλαγή). Ο Claude ελέγχει το Gmail κάθε 2 ώρες (09:00–21:00), κάνει τις διορθώσεις και ξαναστέλνει στο ίδιο thread.
4. Μετά την έγκριση, τα αρχεία μπαίνουν εδώ και στο `queue.json`. Το Apps Script τα δημοσιεύει στην ώρα τους.
5. Το υλικό που χρησιμοποιήθηκε πάει στο `ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ/<ΕΕΕΕ-ΜΜ>` (ποτέ διαγραφή). Κάθε νύχτα καθαρίζονται τα διπλότυπα του φακέλου.

## Εγκατάσταση (μία φορά, ~30 λεπτά, από υπολογιστή)

### 1. Σελίδα Facebook και Instagram
- Η υπεύθυνη του κέντρου σού δίνει **πλήρη έλεγχο** στη σελίδα: Meta Business Suite → Ρυθμίσεις → Άτομα → Προσθήκη ατόμων → το προφίλ σου → «Πλήρης έλεγχος».
- Το Instagram `@learning.sensory.or` πρέπει να είναι **επαγγελματικός** λογαριασμός, **συνδεδεμένος με τη σελίδα** (Ρυθμίσεις σελίδας → Συνδεδεμένοι λογαριασμοί → Instagram).

### 2. Εφαρμογή Meta (νέα, δωρεάν, ξεχωριστή από της NDT)
1. developers.facebook.com → My Apps → **Create App** → όνομα **LS Social Publisher** → use cases: **«Manage everything on your Page»** και **«Manage messaging & content on Instagram»** (API setup with Facebook login).
2. App settings → Basic → Privacy Policy URL: `https://github.com/malamaspe/learning-sensory-social/blob/main/PRIVACY.md` · Category: Business · Αποθήκευση.
3. Πάνω: App Mode → **Live** (σε Development οι δημοσιεύσεις φαίνονται μόνο σε όσους έχουν ρόλο στην εφαρμογή).

### 3. Μόνιμο token σελίδας
1. developers.facebook.com/tools/explorer → Meta App: **LS Social Publisher** → User Token → πρόσθεσε τα δικαιώματα `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` → **Generate Access Token** → στο παράθυρο του Facebook επίλεξε **μόνο** τη σελίδα του Learning & Sensory και το Instagram της.
2. Αντέγραψε το token → developers.facebook.com/tools/debug/accesstoken → **Debug** → κάτω **Extend Access Token** → αντέγραψε το νέο token.
3. Πίσω στο Graph API Explorer: επικόλλησε το νέο token, ερώτημα `me/accounts?fields=name,access_token` → **Submit**.
4. Αντέγραψε το `access_token` της σελίδας Learning & Sensory. Έλεγχος στο Debugger: **Type: Page, Expires: Never**.

Το token δεν λήγει. Σταματά μόνο αν αλλάξεις κωδικό στο Facebook ή χάσεις τον ρόλο σου στη σελίδα: τότε έρχεται email σφάλματος και επαναλαμβάνεις τα βήματα 1–4.

### 4. Google Sheet + Apps Script
1. Νέο Google Sheet με όνομα **LS Publisher** (στο `malamaspe@gmail.com`).
2. Επεκτάσεις → Apps Script. Όνομα έργου: **LS Publisher**.
3. Σβήνεις ό,τι υπάρχει στο `Code.gs` και επικολλάς το `publisher/Code.gs`.
4. Νέο αρχείο (+ → Σενάριο) `Tidy` → επικόλληση `publisher/Tidy.gs`. Νέο αρχείο `Upload` → επικόλληση `publisher/Upload.gs`.
5. Ρυθμίσεις έργου (γρανάζι) → «Εμφάνιση αρχείου manifest appsscript.json» → επικόλληση `publisher/appsscript.json`. Ζώνη ώρας: Athens.
6. Ρυθμίσεις έργου → Ιδιότητες σεναρίου → Προσθήκη: `TOKEN_LS` = το token του βήματος 3.

### 5. Έλεγχος και ενεργοποίηση (επιλογή συνάρτησης πάνω → Εκτέλεση)
1. `findInstagramIds` → την πρώτη φορά ζητάει άδειες Google: τις δίνεις («Σύνθετες ρυθμίσεις → Μετάβαση στο LS Publisher»). Πρέπει να γράψει τη σελίδα και `@learning.sensory.or`.
2. `checkSetup` → «δεν λήγει, δικαιώματα εντάξει», ο λογαριασμός Instagram, η σελίδα Facebook, «προβληματικά: 0».
3. `dryRun` (όταν υπάρχει κάτι στην ουρά) → «Instagram OK» και «Facebook OK … ΔΕΝ δημοσιεύτηκε τίποτα».
4. `setup` → από εδώ και πέρα ελέγχει κάθε 10 λεπτά.
5. `setupDailyDedupe` → καθαρισμός διπλοτύπων στον φάκελο υλικού κάθε βράδυ.

### 6. (Προαιρετικό) Συντόμευση iPhone
Αν θέλετε ανέβασμα από τα Φύλλα του iPhone σε πρωτότυπη ποιότητα: Ανάπτυξη → Νέα ανάπτυξη → Εφαρμογή ιστού (Εκτέλεση ως: Εγώ, Πρόσβαση: Οποιοσδήποτε) → αντιγραφή του URL (/exec) στην Ιδιότητα σεναρίου `UPLOAD_URL` → `sendUploadLink` → έρχεται email με τον σύνδεσμο για τη συντόμευση. Αλλιώς αρκεί η εφαρμογή Google Drive.

## Καθημερινά
- Καρτέλα **Ουρά** στο Sheet: το πρόγραμμα με την κατάσταση κάθε δημοσίευσης και link. Καρτέλα **Ιστορικό**: κάθε δημοσίευση ή σφάλμα.
- Όλα τα email ειδοποίησης (σφάλματα, τέλος ουράς, διπλότυπα) πάνε στο **learning.sensory.or@gmail.com** (απόφαση 22/11). Για άλλον παραλήπτη: Ιδιότητα σεναρίου `NOTIFY_TO` (πολλοί με κόμμα).
- Σε σφάλμα έρχεται email. Μετά από 3 αποτυχίες ή καθυστέρηση πάνω από 3 ώρες η δημοσίευση παραλείπεται, ώστε να μη βγει ποτέ διπλή.
- Instagram και Facebook παρακολουθούνται χωριστά: αν αποτύχει το ένα, το άλλο δεν ξαναδημοσιεύεται.
- Κάθε reel βγαίνει και ως story 15′ μετά (`REEL_STORY=false` το σταματά).
- Email όταν η ουρά τελειώνει σε λιγότερο από 5 ημέρες.
- `pause()` σταματά τα πάντα, `resume()` συνεχίζει. Μόνο το Facebook: `FB_ENABLED` = `false`. Ρυθμίσεις και από το μενού **⚙️ Publisher** του Sheet.
