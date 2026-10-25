/**
 * ===== Surat Jalan dari PDF/TEKS — penerimaan faktur tanpa konversi manual =====
 *
 * Tujuan: pemilik aplikasi meng-upload faktur/surat jalan produsen LANGSUNG
 * (PDF atau foto) tanpa mengubah ke Excel/CSV dahulu. Dua jalur teks:
 *
 * 1. PDF berlapis-teks  → teks diekstrak langsung dari lapisan teks (pdfjs,
 *    akurat, tanpa OCR) — jalur tercepat & paling akurat.
 * 2. PDF hasil scan/foto/teks-tipis → OCR tesseract.js (infra vision.ts yang
 *    sudah ada & teruji; salah-ketik OCR ditangkap pencocok aturan + AI di
 *    /api/surat-jalan/match — prompt AI memang sudah siap kasus OCR).
 *
 * Teks kedua jalur dinormalkan ke konvensi yang sama: SEL KOLOM dipisah celah
 * spasi ≥2 (layout tabel menempatkan kolom berjauhan dengan celah lebar),
 * lalu diuraikan bersama parser alias Excel (cariBarisHeader/DAFTAR_ALIAS).
 */
import type { BarisSuratJalan, HasilTabsheet } from './surat-jalan'
import { cariBarisHeader } from './surat-jalan'

// ===== 1. Ekstraksi teks dari PDF (lapisan teks, tanpa OCR) =====
// pdfjs-dist legacy build → aman di runtime Node standalone (tanpa canvas,
// karena hanya getTextContent — tidak perlu merender halaman).
 
async function muatPdfjs(): Promise<any> {
  return await import(/* turbopackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs')
}

/** Gabungkan item teks per halaman menjadi teks layout: sel kolom dipisah ≥2 spasi. */
function teksHalamanDariItems(items: any[]): string {
  // Kelompokkan item berdasar garis (koordinat Y hampir sama), urut X lalu rakit.
  // transform = [a,b,c,d,e,f] — d=tinggi font, e=x, f=y (sumbu Y ke atas).
  const berY = items
    .filter((it) => typeof it?.str === 'string' && it.str.trim() !== '')
    .map((it) => ({ str: it.str as string, x: Number(it.transform?.[4] ?? 0), y: Number(it.transform?.[5] ?? 0), h: Number(it.transform?.[3] ?? 10) || 10 }))
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x))
  if (!berY.length) return ''
  const baris: typeof berY[] = []
  let kini: typeof berY = [berY[0]]
  for (let i = 1; i < berY.length; i++) {
    const prev = kini[kini.length - 1]
    if (Math.abs(berY[i].y - prev.y) <= Math.max(2, prev.h * 0.6)) kini.push(berY[i])
    else { baris.push(kini); kini = [berY[i]] }
  }
  baris.push(kini)
  const keluar: string[] = []
  for (const b of baris) {
    b.sort((a, c) => a.x - c.x)
    let teks = ''
    let xAkhir = -1
    let hStd = 10
    for (const it of b) {
      if (xAkhir >= 0) {
        const lebarTeks = hStd * 0.5 // perkiraan lebar 1 karakter — jarak jauh = kolom berbeda
        const gap = it.x - xAkhir
        teks += gap > lebarTeks * 1.8 ? '   ' : gap > lebarTeks * 0.9 ? '  ' : ' '
      }
      teks += it.str
      xAkhir = it.x + it.str.length * it.h * 0.5
      hStd = it.h
    }
    keluar.push(teks.replace(/\s+$/, ''))
  }
  return keluar.join('\n')
}

/** Teks lapisan-teks PDF (semua halaman). Gagal → error berbahasa Indonesia. */
export async function teksDariPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfjs = await muatPdfjs()
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      standardFontDataUrl: undefined,
    }).promise
    const halaman: string[] = []
    for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
      const page = await doc.getPage(n)
      const tc = await page.getTextContent()
      halaman.push(teksHalamanDariItems(tc.items ?? []))
    }
    return halaman.join('\n')
  } catch (e) {
    throw new Error(`Tidak dapat membaca PDF: ${(e as Error).message}`)
  }
}

// ===== 2. Parser teks (dari lapisan PDF maupun OCR) =====

/** Pecah 1 baris teks menjadi SEL: pemisah = TAB atau celah spasi ≥2. */
function selDariBaris(baris: string): string[] {
  return baris
    .replace(/\t/g, '   ')
    .split(/\s{2,}/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}

const KODE_RE = /^[A-Z0-9][A-Z0-9\-\/#._]{2,24}$/ // campuran huruf+angka/tanda
const INT_RE = /^\d{1,3}$/ // qty wajar: 1–999
const SN_RE = /^\d{9,17}$/ // SN unit pola umum: 02100056000

/** Sel teranggap KODE bila campuran alnum (ada huruf & angka) ATAU angka 6–8 digit. */
function tampangKode(sel: string): boolean {
  const s = sel.toUpperCase()
  if (!KODE_RE.test(s)) return false
  const campur = /[A-Z]/.test(s) && /\d/.test(s)
  const digitBersih = s.replace(/\D/g, '')
  return campur || (digitBersih.length >= 6 && digitBersih.length <= 8)
}

/**
 * Uraikan teks surat jalan/faktur (hasil PDF lapisan-teks ATAU OCR) menjadi
 * struktur sama dgn parseTabsheet — integrasi mulus ke /api/surat-jalan/match.
 */
export function uraikanTeksSuratJalan(teks: string): HasilTabsheet {
  const semua = teks.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const matriks = semua.map(selDariBaris)

  // Meta: NO surat jalan & tanggal & produsen — regex lembut di seluruh teks.
  // Pola khusus urutan harian aplikasi ini dulu (SJR-YYYYMMDD-NNNN), lalu
  // pola "No. Surat Jalan : …" bebas.
  const mSjr = teks.match(/\b((?:SJR|SJ)[-/]\d{8}-\d{1,4})\b/i)
  let noSuratJalan: string | undefined = mSjr ? mSjr[1].toUpperCase() : undefined
  if (!noSuratJalan) {
    const mMeta = teks.match(/(?:no\.?\s*(?:surat\s*jalan|sj)|surat\s*jalan\s*no\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/.]{3,24})/i)
    if (mMeta) noSuratJalan = mMeta[1].toUpperCase()
  }

  let tglSurat: Date | null = null
  const tglM = teks.match(/\b(\d{4})-(\d{2})-(\d{2})\b/) ?? teks.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/)
  if (tglM) {
    const d = tglM[1].length === 4
      ? new Date(`${tglM[1]}-${tglM[2]}-${tglM[3]}`)
      : new Date(`${tglM[3]}-${tglM[2]}-${tglM[1]}`)
    if (!Number.isNaN(d.getTime())) tglSurat = d
  }

  let produsen: string | null = null
  for (const s of semua) {
    const m = s.match(/^(?:produsen|supplier|pengirim|kepada|dari)\s*[:\-]?\s*(.{3,60})$/i)
    if (m) { produsen = m[1].trim(); break }
  }

  const rows: BarisSuratJalan[] = []
  let terlewati = 0

  // A. Jalur tabel rapi: baris kepala alias kolom (paling sering & akurat).
  const kepala = cariBarisHeader(matriks)
  if (kepala) {
    const map = kepala.map
    // Aturan ketat jalur TEKS (beda dgn Excel yang longgar): sel kode wajib
    // SATU token tanpa spasi & berpola kode — baris kaki dokumen (mis.
    // "Total Item : 2") tidak ikut menjadi item.
    let kepalaKol = -1
    for (const [kol, f] of map) if (f === 'kodePart') { kepalaKol = kol; break }
    for (const sel of matriks.slice(kepala.idx + 1)) {
      const kodeMentah = kepalaKol >= 0 && kepalaKol < sel.length ? sel[kepalaKol] : ''
      if (!kodeMentah || kodeMentah.includes(' ') || !tampangKode(kodeMentah)) {
        if (sel.length > 1 || /\d/.test(sel[0] ?? '')) terlewati++
        continue
      }
      const ambil = (field: string) => {
        for (const [kol, f] of map) if (f === field) return kol < sel.length ? sel[kol] : undefined
        return undefined
      }
      const qtyN = Number(ambil('qty'))
      rows.push({
        kodePart: kodeMentah.trim(),
        namaPart: String(ambil('namaPart') ?? '').trim() || undefined,
        qty: Number.isFinite(qtyN) && qtyN > 0 ? Math.floor(qtyN) : 1,
        serialNumber: String(ambil('serialNumber') ?? '').trim() || undefined,
      })
    }
    return { rows, noSuratJalan, tglSurat, produsen, terlewati }
  }

  // B. Jalur tanpa kepala: klasifikasi sel per baris (kode/qty/nama/SN).
  for (const matriksRow of matriks) {
    // OCR sering menghasilkan baris kompakt (sel 1-panjang, spasi tunggal
    // antartoken) — lakukan tokenisasi supaya kolom tetap dapat diklasifikasi;
    // penyusunan nama kembali dengan join untuk mengembalikan formatnya.
    const sel = matriksRow.length === 1 && matriksRow[0].includes(' ') ? matriksRow[0].split(' ') : matriksRow
    let kode = ''
    let qty: number | undefined
    let sn: string | undefined
    const sisaNama: string[] = []
    for (const c of sel) {
      const u = c.toUpperCase().replace(/\s+/g, '')
      if (!kode && tampangKode(c) && !SN_RE.test(u)) { kode = c; continue }
      if (qty === undefined && INT_RE.test(c)) { qty = Number(c); continue }
      if (!sn && SN_RE.test(u)) { sn = c; continue }
      if (u.length >= 3) sisaNama.push(c)
    }
    if (!kode) {
      // Fallback: selini pertama bukan angka & cukup panjang = kode.
      const kandidat = sel.find((c) => tampangKode(c) && !SN_RE.test(c.toUpperCase().replace(/\s+/g, '')))
      if (!kandidat) { terlewati++; continue }
      kode = kandidat
      const idx = sel.indexOf(kandidat)
      for (const c of sel.slice(0, idx).concat(sel.slice(idx + 1))) {
        if (qty === undefined && INT_RE.test(c)) { qty = Number(c); continue }
        if (!sn && SN_RE.test(c.toUpperCase().replace(/\s+/g, ''))) { sn = c; continue }
        if (c.trim().length >= 3) sisaNama.push(c)
      }
    }
    rows.push({
      kodePart: kode,
      namaPart: sisaNama.join(' ').trim() || undefined,
      qty: qty && qty > 0 ? Math.min(qty, 999) : 1,
      serialNumber: sn,
    })
  }

  return { rows, noSuratJalan, tglSurat, produsen, terlewati }
}
