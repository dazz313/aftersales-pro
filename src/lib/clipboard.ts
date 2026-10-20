/**
 * Salin teks ke clipboard dengan fallback.
 * Clipboard API kadang diblokir (iframe / konteks non-secure) —
 * fallback: textarea sementara + document.execCommand('copy').
 */
export async function copyToClipboard(teks: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(teks)
    return
  } catch {
    // lanjut ke fallback di bawah
  }
  const ta = document.createElement('textarea')
  ta.value = teks
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    // abaikan — pemanggil tetap memberi umpan balik lewat toast/UI
  }
  ta.remove()
}
