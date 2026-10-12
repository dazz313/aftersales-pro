/**
 * Test E2E MCP Server AfterSales Pro
 * -----------------------------------
 * Spawn mcp/server.mjs sebagai child process, lalu bicara JSON-RPC via stdio:
 *   1. initialize + initialized
 *   2. tools/list
 *   3. tools/call: get_stats, list_toko, add_toko (uji), record_kunjungan (uji),
 *      list_kunjungan, send_gateway_message (simulasi), run_backup (snapshot lokal),
 *      list_audit
 * Setelah itu bersihkan data uji lewat Prisma langsung.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SERVER = path.join(ROOT, 'mcp', 'server.mjs')

let nextId = 1
const pending = new Map()
let buffer = ''
let proc = null

function send(method, params, isNotification = false) {
  return new Promise((resolve, reject) => {
    const id = isNotification ? null : nextId++
    const msg = { jsonrpc: '2.0', method, ...(id ? { id } : {}), ...(params ? { params } : {}) }
    if (id) pending.set(id, { resolve, reject })
    proc.stdin.write(JSON.stringify(msg) + '\n')
    if (isNotification || !id) resolve(null)
    setTimeout(() => {
      if (id && pending.has(id)) {
        pending.delete(id)
        reject(new Error(`Timeout menunggu respons ${method}`))
      }
    }, 60_000)
  })
}

function onLine(line) {
  line = line.trim()
  if (!line) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
}

async function main() {
  console.log('→ Spawn MCP server (stdio)...')
  proc = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: 'file:/home/z/my-project/db/custom.db' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      onLine(line)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk) => process.stderr.write(`[srv] ${chunk}`))
  proc.on('exit', (code) => console.log(`[srv] exited code=${code}`))

  // 1. initialize
  const init = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  })
  console.log('✓ initialize:', init.serverInfo.name, init.serverInfo.version, '| tools ready:', !!init.capabilities?.tools)
  await send('notifications/initialized', undefined, true)

  // 2. tools/list
  const list = await send('tools/list', {})
  console.log(`✓ tools/list: ${list.tools.length} tool → ${list.tools.map((t) => t.name).join(', ')}`)

  async function call(name, args = {}) {
    const res = await send('tools/call', { name, arguments: args })
    if (res.isError) throw new Error(`Tool ${name} error: ${res.content[0].text}`)
    return JSON.parse(res.content[0].text)
  }

  // 3. get_stats
  const stats = await call('get_stats')
  console.log(`✓ get_stats: toko=${stats.ringkasan.toko} customer=${stats.ringkasan.customer} sparepart=${stats.ringkasan.sparepart} unit=${stats.ringkasan.unit} kunjunganBulanIni=${stats.ringkasan.kunjunganBulanIni}`)

  // 4. list_toko
  const tokoList = await call('list_toko', { limit: 5 })
  console.log(`✓ list_toko: total=${tokoList.total} contoh=${tokoList.toko[0]?.kodeToko} barcode=${tokoList.toko[0]?.barcodeToko}`)

  // 5. get_toko via barcode toko pertama
  const bc = tokoList.toko[0]?.barcodeToko
  const detail = await call('get_toko', { barcode: bc })
  console.log(`✓ get_toko (barcode ${bc}): ${detail.toko.namaToko}, unit=${detail.jumlahUnit}, kunjunganTerakhir=${detail.kunjunganTerakhir.length}`)

  // 6. add_toko (data uji)
  const stamp = Date.now().toString().slice(-6)
  const kode = `MCP${stamp}`
  const baru = await call('add_toko', { namaToko: `Toko Uji MCP ${stamp}`, kontak: '0812' })
  console.log(`✓ add_toko: ${baru.toko.kodeToko} barcode=${baru.toko.barcodeToko}`)
  const tokoUjiKode = kode // tidak dipakai karena auto; ambil dari hasil
  const kodeUji = baru.toko.kodeToko

  // 7. record_kunjungan via barcode toko uji (case bervariasi: lowercase + tanpa BC-)
  const kun = await call('record_kunjungan', { barcode: `bc-${kodeUji.toLowerCase()}`, catatan: 'Uji cek-in via MCP' })
  console.log(`✓ record_kunjungan: id=${kun.kunjungan.id} toko=${kun.toko.namaToko} metode=${kun.kunjungan.metode} gateway=${kun.gateway.mode}`)

  // 8. list_kunjungan filter toko
  const kunList = await call('list_kunjungan', { tokoId: kun.toko.id, limit: 5 })
  console.log(`✓ list_kunjungan: ${kunList.total} entri (expect ≥1)`)

  // 9. add_customer + add_sparepart + list (uji cepat)
  const cust = await call('add_customer', { nama: `Customer Uji MCP ${stamp}` })
  console.log(`✓ add_customer: id=${cust.customer.id}`)
  const part = await call('add_sparepart', { namaPart: `Part Uji MCP ${stamp}`, stokInventory: 2, reorderLimit: 5, hargaKlaim: 150000 })
  console.log(`✓ add_sparepart: ${part.sparepart.kodePart}`)
  const low = await call('list_sparepart', { lowStockOnly: true })
  console.log(`✓ list_sparepart lowStockOnly: ${low.total} item kritis`)

  // 10. send_gateway_message (mode simulasi)
  const gw = await call('send_gateway_message', { pesan: 'Uji pesan dari MCP server' })
  console.log(`✓ send_gateway_message: mode=${gw.mode} ok=${gw.ok}`)

  // 11. run_backup (fallback snapshot lokal)
  const bak = await call('run_backup')
  console.log(`✓ run_backup: via=${bak.via} rows=${bak.rowsTotal} file=${bak.file ? path.basename(bak.file) : '-'}`)

  // 12. list_audit
  const audit = await call('list_audit', { limit: 8 })
  console.log(`✓ list_audit: ${audit.total} entri terbaru, aktor contoh=${audit.log[0]?.aktor}`)

  console.log('\n=== SEMUA TES MCP LULUS ===')
  console.log(`DATA_UJI: kodeUji=${kodeUji} custId=${cust.customer.id} partId=${part.sparepart.id} kunjunganId=${kun.kunjungan.id}`)

  await send('notifications/exit', undefined, true).catch(() => {})
  proc.stdin.end()
  setTimeout(() => proc.kill(), 1000)
  process.exit(0)
}

main().catch(async (e) => {
  console.error('✗ TES GAGAL:', e.message)
  if (proc) proc.kill()
  process.exit(1)
})
