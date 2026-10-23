'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './nota-sheet.module.css'
import { hitungBiayaNota, rupiahNota, tanggalNota, type NotaData } from '@/lib/nota'

/**
 * Tampilan nota kertas "SERVICE CENTER" (Nota Servis BASS).
 * Dipakai untuk:
 * 1. Live preview di form (mobile-first, discalakan mengikuti lebar kontainer),
 * 2. Pratinjau dialog klaim di view Klaim,
 * 3. Target cetak PDF (@media print A5 landscape — aturan global di globals.css).
 *
 * Rasio nota 936×690 (landscape), border tipis hitam, cetak hitam-putih.
 * `printable=false` hanya muncul di layar (mis. baris daftar tak perlu targt cetak).
 */
export default function NotaSheet({ nota, lembar = 1, printable = false }: { nota: NotaData; lembar?: 1 | 2; printable?: boolean }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [logoError, setLogoError] = useState(false)
  const hitung = hitungBiayaNota(nota)
  const items = (nota.items ?? []).filter((it) => it.kode || it.nama || (it.harga ?? 0) > 0)
  const baris = [...items, ...Array.from({ length: Math.max(7 - items.length, 0) }, () => ({}))].slice(0, 7)

  // Skala otomatis mengikuti lebar kontainer (HP lebar ±360 → scale ±0.37)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ukur = () => {
      const w = el.clientWidth
      if (w > 0) setScale(Math.min(1, w / 936))
    }
    ukur()
    const ro = new ResizeObserver(ukur)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lokasi = nota.lokasi === 'Outdoor' ? 'Outdoor' : 'Indoor'
  const garansi = nota.garansi === 'Tdk' ? 'Tdk' : 'Ya'

  const lingkar = (aktif: boolean) => ({
    border: aktif ? '2px solid #111' : '1px dashed #666',
  })

  return (
    <div ref={wrapperRef} className="nota-printroot" data-print={printable ? 'on' : 'off'}>
      {/* Salin untuk layar (discalakan mengikuti lebar kontainer) */}
      <div
        className={styles.nsWrap}
        style={{
          height: 690 * scale,
          // Saat media print salinan screen disembunyikan via class in CSS module
        }}
      >
        <div className={styles.nsSheet} style={{ transform: `scale(${scale})` }}>
          <NotaDalam nota={nota} lembar={lembar} hitung={hitung} items={items} baris={baris} lokasi={lokasi} garansi={garansi} lingkar={lingkar} logoError={logoError} setLogoError={setLogoError} />
        </div>
      </div>

      {/* Salinan cetak (hanya tampil saat @media print) — discalakan agar pas A5 landscape */}
      <div className="nota-printonly" style={{ width: Math.round(936 * 0.775), height: Math.round(690 * 0.775), overflow: 'hidden' }}>
        <div className={styles.nsSheet} style={{ transform: 'scale(0.775)' }}>
          <NotaDalam nota={nota} lembar={lembar} hitung={hitung} items={items} baris={baris} lokasi={lokasi} garansi={garansi} lingkar={lingkar} logoError={logoError} setLogoError={setLogoError} />
        </div>
      </div>
    </div>
  )
}

/** Isi nota dipakai ulang di salinan layar & cetak (satu sumber markup). */
function NotaDalam({
  nota,
  lembar,
  hitung,
  items,
  baris,
  lokasi,
  garansi,
  lingkar,
  logoError,
  setLogoError,
}: {
  nota: NotaData
  lembar: 1 | 2
  hitung: ReturnType<typeof hitungBiayaNota>
  items: NonNullable<NotaData['items']>
  baris: Record<string, unknown>[]
  lokasi: string
  garansi: string
  lingkar: (aktif: boolean) => { border: string }
  logoError: boolean
  setLogoError: (v: boolean) => void
}) {
  const barisTabel = items
  return (
    <div className={styles.nsSheetInner}>
      {/* ============ HEADER ============ */}
      <div className={styles.header}>
        <div className={styles.headerKiri}>
          <div className={styles.logoBox}>
            {logoError ? (
              <span className="text-3xl" role="img" aria-label="logo montir">🔧</span>
            ) : (
               
              <img src="/nota-logo.png" alt="Logo montir" width={56} height={56} onError={() => setLogoError(true)} />
            )}
          </div>
          <div className={styles.headerTeks}>
            <p className={styles.judul}>SERVICE CENTER</p>
            <p className={styles.kontakLine}>Telp : 021 - 3877 - 4117</p>
            <p className={styles.csoTitle}>LAYANAN KONSUMEN NASIONAL</p>
            <p className={styles.kontakLine}>Telp : 0804 - 1 - 889 - 889</p>
            <p className={styles.kontakLine}>Whatsapp : 0815 - 112 - 99999 / 0815 - 1961 - 8174</p>
            <p className={styles.kontakLine}>e-mail : cso.jkt@bhakti.co.id</p>
          </div>
        </div>
        <div className={styles.kotakKanan}>
          <div className={styles.lokasiRow}>
            <span className={styles.lokasiLabel}>Lokasi :</span>
            <span className={styles.lokasiOpt} style={lingkar(lokasi === 'Indoor')}>Indoor</span>
            <span className={styles.lokasiOpt} style={lingkar(lokasi === 'Outdoor')}>Outdoor</span>
          </div>
          <div className={styles.bassRow}>
            <span className={styles.bassLabel}>BASS</span>
            <span className={styles.bassNomor}>{nota.nomorBass || '000000'}</span>
          </div>
        </div>
      </div>

      {/* ============ PANEL DATA + TEKNIS ============ */}
      <div className={styles.panel}>
        <div className={styles.panelKiri}>
          <div className={styles.dataRow}><span>Tanggal</span><b>{tanggalNota(nota.tanggal) || '–'}</b></div>
          <div className={styles.dataRow}><span>Jam Masuk</span><b>{nota.jamMasuk || '–'}</b></div>
          <div className={styles.dataRow}><span>Nama</span><b>{nota.nama || '–'}</b></div>
          <div className={styles.dataRow}><span>Alamat</span><b>{nota.alamat || '–'}</b></div>
          <div className={styles.dataRow}><span>Telp</span><b>{nota.telp || '–'}</b></div>
          <div className={styles.dataRow}><span>HP</span><b>{nota.hp || '–'}</b></div>
          <div className={styles.dataRow}><span>Merk</span><b>{nota.merk || '–'}</b></div>
          <div className={styles.dataRow}><span>LP</span><b>{nota.lp || '–'}</b></div>
          <div className={styles.dataRow}><span>Model</span><b>{nota.model || '–'}</b></div>
          <div className={styles.dataRow}><span>No. Seri</span><b>{nota.noSeri || '–'}</b></div>
          <div className={styles.dataRow}><span>Tgl Beli</span><b>{tanggalNota(nota.tglBeli) || '–'}</b></div>
          <div className={styles.dataRow}>
            <span>Garansi</span>
            <b className={styles.garansiOps}>
              <span className={styles.lokasiOpt} style={lingkar(garansi === 'Ya')}>Ya</span>
              <span className={styles.lokasiOpt} style={lingkar(garansi === 'Tdk')}>Tdk</span>
            </b>
          </div>
          <div className={styles.dataRow}><span>Tgl Selesai</span><b>{tanggalNota(nota.tglSelesai) || '–'}</b></div>
          <div className={styles.dataRow}><span>Jam Selesai</span><b>{nota.jamSelesai || '–'}</b></div>
        </div>
        <div className={styles.panelKanan}>
          <div className={styles.tekdo}><p className={styles.tekdoLabel}>Pengaduan</p><p className={styles.tekdoIsi}>{nota.pengaduan || ''}</p></div>
          <div className={styles.tekdo}><p className={styles.tekdoLabel}>Kelengkapan</p><p className={styles.tekdoIsi}>{nota.kelengkapan || ''}</p></div>
          <div className={styles.tekdo}><p className={styles.tekdoLabel}>Penyebab</p><p className={styles.tekdoIsi}>{nota.penyebab || ''}</p></div>
          <div className={styles.tekdo}><p className={styles.tekdoLabel}>Perbaikan</p><p className={styles.tekdoIsi}>{nota.perbaikan || ''}</p></div>
        </div>
      </div>

      {/* ============ TABEL SUKU CADANG ============ */}
      <table className={styles.tabel}>
        <thead>
          <tr>
            <th style={{ width: '22%' }}>Kode Suku Cadang</th>
            <th style={{ width: '36%' }}>Nama Suku Cadang</th>
            <th style={{ width: '14%' }}>Harga Satuan</th>
            <th style={{ width: '7%' }}>QTY</th>
            <th style={{ width: '18%' }}>Total Harga</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((it, i) => {
            const isi = barisTabel[i]
            const total = isi ? (Number(isi.harga) || 0) * (Number(isi.qty) || 0) : null
            return (
              <tr key={i}>
                <td>{isi?.kode || ''}</td>
                <td>{isi?.nama || ''}</td>
                <td>{isi ? rupiahNota(isi.harga) : ''}</td>
                <td>{isi?.qty ? String(isi.qty) : ''}</td>
                <td>{total != null ? rupiahNota(total) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ============ TANDA TANGAN + RINGKASAN BIAYA ============ */}
      <div className={styles.bawah}>
        <div className={styles.ttdRow}>
          {[
            { t: 'Diserahkan oleh (Customer)', ttd: nota.ttdCustomer1, nama: nota.namaCustomer1 },
            { t: 'Teknisi', ttd: nota.ttdTeknisi, nama: nota.namaTeknisi },
            { t: 'Diambil oleh (Customer)', ttd: nota.ttdCustomer2, nama: nota.namaCustomer2 },
          ].map((b, i) => (
            <div key={i} className={styles.ttdBloks}>
              <p className={styles.ttdLabel}>{b.t}</p>
              <div className={styles.ttdKotak}>
                {b.ttd ? (
                   
                  <img src={b.ttd} alt={`Tanda tangan ${b.t}`} className={styles.ttdImg} />
                ) : null}
                <span className={styles.ttdGaris} />
              </div>
              <p className={styles.ttdNama}>{b.nama || ''}</p>
            </div>
          ))}
          <div className={styles.dataRowAmbil}>
            <span>Tgl. Ambil</span><b>{tanggalNota(nota.tglAmbil) || '–'}</b>
          </div>
        </div>
        <div className={styles.biayaBox}>
          {hitung.garansiPenuh ? (
            <p className={styles.biayaGaransi}>* BIAYA DITANGGUNG GARANSI *</p>
          ) : (
            <>
              <div className={styles.biayaRow}><span>Total Harga Suku Cadang</span><b className={styles.biayaVal}>{rupiahNota(hitung.totalSparepart)}</b></div>
              <div className={styles.biayaRow}><span>Biaya Service</span><b className={styles.biayaVal}>{rupiahNota(nota.biayaService)}</b></div>
              <div className={styles.biayaRow}><span>Transportasi</span><b className={styles.biayaVal}>{rupiahNota(nota.biayaTransportasi)}</b></div>
              <div className={styles.biayaRow}><span>Sub Total</span><b className={styles.biayaVal}>{rupiahNota(hitung.subTotal)}</b></div>
              <div className={styles.biayaRow}><span>PPN</span><b className={styles.biayaVal}>{(nota.ppnPersen ?? 0)}% = {rupiahNota(hitung.ppn)}</b></div>
              <div className={styles.biayaRowTot}><span>Total Biaya Service</span><b className={styles.biayaVal}>{rupiahNota(hitung.total)}</b></div>
            </>
          )}
        </div>
      </div>

      {/* ============ FOOTER ============ */}
      <div className={styles.footer}>
        <span>* Lembar Putih : Bukti Pembayaran</span>
        <span>Lembar {lembar} dari 2</span>
      </div>
    </div>
  )
}
