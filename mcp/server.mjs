#!/usr/bin/env node
/**
 * AfterSales Pro — MCP Server (stdio)
 * ====================================
 * Server Model Context Protocol yang berjalan lewat stdio (standar Claude
 * Desktop / MCP client). Ekspos data & operasi AfterSales Pro kepada AI.
 *
 * Menjalankan langsung:
 *   node mcp/server.mjs
 *   (opsional) DATABASE_URL=file:/path/ke/db.custom.db node mcp/server.mjs
 *
 * Contoh konfigurasi Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "aftersales-pro": {
 *       "command": "node",
 *       "args": ["C:\\path\\ke\\project\\mcp\\server.mjs"],
 *       "env": { "DATABASE_URL": "file:C:\\path\\ke\\db\\custom.db" }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { TOOLS, handleToolCall, APP_INFO, shutdown } from './tools.mjs'

const SERVER_INFO = {
  name: APP_INFO.name,
  version: APP_INFO.version,
}

// Server MCP dengan capability: tools
const server = new Server(SERVER_INFO, {
  capabilities: {
    tools: {},
  },
  instructions:
    'Ini adalah MCP server AfterSales Pro — aplikasi manajemen penjualan, inventory, dan kunjungan teknisi untuk toko sparepart. ' +
    'Gunakan get_stats untuk ringkasan bisnis, list_toko/get_toko untuk data toko (termasuk barcode kunjungan per-toko), ' +
    'record_kunjungan untuk check-in onsite via barcode toko, list_sparepart untuk stok inventory, ' +
    'send_gateway_message untuk notifikasi WhatsApp/Telegram, dan run_backup untuk backup data bersama.',
})

// tools/list — kirim definisi semua tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

// tools/call — dispatch ke handler + bungkus error
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  return handleToolCall({ name, arguments: args })
})

// Jalankan
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[AfterSales Pro MCP] Server siap — db: ${APP_INFO.dbPath}`)
}

main().catch(async (e) => {
  console.error('[AfterSales Pro MCP] Gagal start:', e)
  await shutdown()
  process.exit(1)
})

// Matikan dengan rapi
process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  await shutdown()
  process.exit(0)
})
