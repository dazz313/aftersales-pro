/**
 * AfterSales Pro — Preload Script
 * ===============================
 * Jembatan aman (contextIsolation) antara halaman web dan proses Electron.
 * Halaman bisa memanggil window.asproDesktop.getInfo() untuk mendeteksi
 * mode desktop & path lokal (dipakai kartu "Desktop & AI (MCP)" di Pengaturan).
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('asproDesktop', {
  isDesktop: true,
  getInfo: () => ipcRenderer.invoke('aspro:get-desktop-info'),
})
