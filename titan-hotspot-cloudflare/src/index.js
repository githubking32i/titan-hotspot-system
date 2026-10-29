/**
 * TITAN PAY — Custom Automated Payment Gateway & Hotspot Engine
 * Powered by Cloudflare Workers & D1 Database
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Router-Secret, X-SMS-Secret',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ----------------------------------------------------
      // 1. Health check
      // ----------------------------------------------------
      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', service: 'TITAN PAY Gateway', time: new Date().toISOString() }, corsHeaders);
      }

      // ----------------------------------------------------
      // 2. Gateway API: Get Merchant Receiving Accounts
      // ----------------------------------------------------
      if (path === '/api/v1/accounts') {
        const { results } = await env.DB.prepare(
          'SELECT provider, account_number, account_type FROM merchant_accounts WHERE active = 1'
        ).all();
        return jsonResponse(results, corsHeaders);
      }

      // ----------------------------------------------------
      // 3. Gateway API: Create Checkout Invoice
      // ----------------------------------------------------
      if (path === '/api/v1/checkout/create' && request.method === 'POST') {
        const body = await request.json();
        const { amount, currency, customer_phone, client_mac, client_ip, tok, gateway_address, gateway_port, authaction, redirect_url, metadata } = body;

        if (!amount || amount <= 0) {
          return jsonResponse({ error: 'Valid amount is required' }, corsHeaders, 400);
        }

        const invoiceId = 'INV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 60000).toISOString(); // 30 mins invoice expiry
        const durationMinutes = (metadata && metadata.duration_minutes) ? parseInt(metadata.duration_minutes) : (amount == 50 ? 10080 : (amount == 150 ? 43200 : 120));

        await env.DB.prepare(`
          INSERT INTO invoices (
            id, amount, currency, customer_phone, client_mac, client_ip,
            tok, gateway_address, gateway_port, authaction, redirect_url, metadata, status, expires_at,
            duration_minutes, used_seconds, is_connected
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, 0)
        `).bind(
          invoiceId, amount, currency || 'BDT', customer_phone || '', client_mac || '', client_ip || '',
          tok || '', gateway_address || '192.168.50.1', gateway_port || '2050', authaction || '',
          redirect_url || '', JSON.stringify(metadata || {}), expiresAt, durationMinutes
        ).run();

        const checkoutUrl = `${url.origin}/checkout/${invoiceId}`;

        return jsonResponse({
          success: true,
          invoice_id: invoiceId,
          amount,
          currency: currency || 'BDT',
          checkout_url: checkoutUrl,
          expires_at: expiresAt
        }, corsHeaders, 201);
      }

      // ----------------------------------------------------
      // 4. Gateway API: Get Invoice Status
      // ----------------------------------------------------
      if (path.startsWith('/api/v1/checkout/') && path.endsWith('/status')) {
        const invoiceId = path.split('/')[4];
        const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first();

        if (!invoice) {
          return jsonResponse({ error: 'Invoice not found' }, corsHeaders, 404);
        }

        let metadata = {};
        try { metadata = JSON.parse(invoice.metadata || '{}'); } catch(e) {}

        return jsonResponse({
          invoice_id: invoice.id,
          amount: invoice.amount,
          currency: invoice.currency,
          status: invoice.status,
          trx_id: invoice.trx_id,
          client_mac: invoice.client_mac,
          paid_at: invoice.paid_at,
          expires_at: invoice.expires_at,
          metadata
        }, corsHeaders);
      }

      // ----------------------------------------------------
      // 5. Gateway API: Verify Invoice via TrxID
      // ----------------------------------------------------
      if (path.startsWith('/api/v1/checkout/') && path.endsWith('/verify') && request.method === 'POST') {
        const invoiceId = path.split('/')[4];
        const body = await request.json();
        const { trx_id, phone, method } = body;

        if (!trx_id) {
          return jsonResponse({ error: 'Transaction ID is required' }, corsHeaders, 400);
        }

        const cleanTrx = trx_id.trim().toUpperCase();
        const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first();

        if (!invoice) {
          return jsonResponse({ error: 'Invoice not found' }, corsHeaders, 404);
        }

        if (invoice.status === 'completed') {
          return jsonResponse({ success: true, status: 'completed', message: 'Invoice already paid' }, corsHeaders);
        }

        // Check if SMS Forwarder already verified this TrxID
        const verifiedTx = await env.DB.prepare(
          'SELECT * FROM verified_transactions WHERE trx_id = ? AND used = 0'
        ).bind(cleanTrx).first();

        const now = new Date().toISOString();

        if (verifiedTx) {
          if (verifiedTx.amount >= invoice.amount) {
            // Instant Auto Match!
            await env.DB.prepare(`
              UPDATE invoices
              SET status = 'completed', trx_id = ?, provider = ?, customer_phone = ?, paid_at = ?
              WHERE id = ?
            `).bind(cleanTrx, method || 'bkash', phone || verifiedTx.sender_phone || '', now, invoiceId).run();

            await env.DB.prepare(
              'UPDATE verified_transactions SET used = 1, used_by_invoice_id = ? WHERE trx_id = ?'
            ).bind(invoiceId, cleanTrx).run();

            // Also keep legacy payments table in sync for compatibility
            await syncToLegacyPayments(env, invoice, cleanTrx, method || 'bkash', phone || '', 'approved');

            return jsonResponse({
              success: true,
              status: 'completed',
              message: 'Payment verified instantly via TITAN PAY!'
            }, corsHeaders);
          } else {
            return jsonResponse({
              error: `পর্যাপ্ত টাকা পাঠানো হয়নি। ইনভয়েসের পরিমাণ ৳${invoice.amount}, কিন্তু প্রাপ্ত টাকা ৳${verifiedTx.amount}`
            }, corsHeaders, 400);
          }
        }

        // If not in verified_transactions yet, mark invoice with trx_id and status pending
        await env.DB.prepare(`
          UPDATE invoices
          SET trx_id = ?, provider = ?, customer_phone = ?
          WHERE id = ?
        `).bind(cleanTrx, method || 'bkash', phone || '', invoiceId).run();

        // Also record to legacy payments table so admin can manually approve if needed
        await syncToLegacyPayments(env, invoice, cleanTrx, method || 'bkash', phone || '', 'pending');

        return jsonResponse({
          success: true,
          status: 'pending',
          message: 'TrxID submitted! Waiting for bKash SMS confirmation...'
        }, corsHeaders);
      }

      // ----------------------------------------------------
      // 6. Webhook: Incoming SMS Forwarder from Merchant Phone
      // ----------------------------------------------------
      if (path.toLowerCase() === '/api/webhook/sms' && request.method === 'POST') {
        const secretHeader = request.headers.get('X-SMS-Secret');
        let body = {};
        let rawBodyText = '';
        try {
          rawBodyText = await request.text();
          body = JSON.parse(rawBodyText);
        } catch (e) {
          try {
            const params = new URLSearchParams(rawBodyText);
            body = Object.fromEntries(params.entries());
          } catch (_) {
            body = { message: rawBodyText };
          }
        }

        const providedSecret = secretHeader || body.secret || url.searchParams.get('secret');
        if (providedSecret !== env.SMS_SECRET) {
          return jsonResponse({ error: 'Unauthorized SMS Webhook' }, corsHeaders, 401);
        }

        const smsContent = body.message || body.key || body.text || body.content || body.body || rawBodyText || '';
        const parsed = parseBkashNagadSMS(smsContent);

        // Ping test handler
        if (!parsed.trx_id || !parsed.amount) {
          if (smsContent.includes('[msg]') || smsContent.includes('{msg}') || smsContent.toLowerCase().includes('test') || !smsContent) {
            return jsonResponse({
              success: true,
              is_test: true,
              message: 'Webhook ping test successful! TITAN PAY Gateway is active.'
            }, corsHeaders, 200);
          }

          return jsonResponse({
            error: 'Could not extract valid TrxID or Amount from SMS',
            parsed,
            raw: smsContent
          }, corsHeaders, 422);
        }

        // Save into verified_transactions
        await env.DB.prepare(`
          INSERT INTO verified_transactions (trx_id, amount, sender_phone, raw_message)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(trx_id) DO UPDATE SET raw_message = excluded.raw_message
        `).bind(parsed.trx_id, parsed.amount, parsed.phone || '', smsContent).run();

        // Match against pending invoices
        const pendingInvoice = await env.DB.prepare(`
          SELECT * FROM invoices
          WHERE (trx_id = ? OR (amount = ? AND status = 'pending'))
          ORDER BY created_at DESC LIMIT 1
        `).bind(parsed.trx_id, parsed.amount).first();

        let autoApproved = false;
        if (pendingInvoice && pendingInvoice.status === 'pending') {
          if (parsed.amount >= pendingInvoice.amount) {
            const now = new Date().toISOString();
            await env.DB.prepare(`
              UPDATE invoices
              SET status = 'completed', trx_id = ?, paid_at = ?
              WHERE id = ?
            `).bind(parsed.trx_id, now, pendingInvoice.id).run();

            await env.DB.prepare(`
              UPDATE verified_transactions SET used = 1, used_by_invoice_id = ? WHERE trx_id = ?
            `).bind(pendingInvoice.id, parsed.trx_id).run();

            await syncToLegacyPayments(env, pendingInvoice, parsed.trx_id, 'bkash', parsed.phone || '', 'approved');
            autoApproved = true;
          }
        }

        return jsonResponse({
          success: true,
          trx_id: parsed.trx_id,
          amount: parsed.amount,
          matched_invoice: autoApproved ? pendingInvoice.id : null
        }, corsHeaders);
      }

      // ----------------------------------------------------
      // 7. Hosted Checkout UI: /checkout/:invoice_id
      // ----------------------------------------------------
      if (path.startsWith('/checkout/')) {
        const invoiceId = path.split('/')[2];
        const invoice = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).first();

        if (!invoice) {
          return new Response('<h3>Invoice Not Found or Expired</h3>', { status: 404, headers: { 'Content-Type': 'text/html' } });
        }

        const { results: accounts } = await env.DB.prepare('SELECT * FROM merchant_accounts WHERE active = 1').all();
        return new Response(getCheckoutHTML(invoice, accounts), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // ----------------------------------------------------
      // 8. Router API: Pending Client Authorizations
      // ----------------------------------------------------
      if (path === '/api/router/pending-auth') {
        const routerSecret = request.headers.get('X-Router-Secret');
        if (routerSecret !== env.ROUTER_SECRET) {
          return jsonResponse({ error: 'Unauthorized router' }, corsHeaders, 401);
        }

        // Return from invoices that are completed and not yet authorized
        const { results } = await env.DB.prepare(`
          SELECT id, client_mac, client_ip, tok, gateway_address, gateway_port, authaction, metadata
          FROM invoices
          WHERE status = 'completed' AND (client_mac != '' OR client_ip != '')
          ORDER BY paid_at DESC LIMIT 50
        `).all();

        // Also merge legacy payments table
        const { results: legacy } = await env.DB.prepare(`
          SELECT p.id, p.client_mac, p.client_ip, p.tok, p.gateway_address, p.gateway_port, p.authaction, pk.duration_minutes
          FROM payments p
          JOIN packages pk ON p.package_id = pk.id
          WHERE p.status = 'approved' AND p.router_authorized = 0
        `).all();

        const pendingList = [];

        for (const inv of results) {
          let meta = {};
          try { meta = JSON.parse(inv.metadata || '{}'); } catch(e) {}
          if (!meta.authorized_on_router) {
            pendingList.push({
              id: inv.id,
              client_mac: inv.client_mac,
              client_ip: inv.client_ip,
              duration_minutes: meta.duration_minutes || 120
            });
          }
        }

        for (const leg of legacy) {
          pendingList.push({
            id: leg.id,
            client_mac: leg.client_mac,
            client_ip: leg.client_ip,
            duration_minutes: leg.duration_minutes || 120
          });
        }

        return jsonResponse(pendingList, corsHeaders);
      }

      // ----------------------------------------------------
      // 9. Router API: ACK Authorization
      // ----------------------------------------------------
      if (path === '/api/router/ack-auth' && request.method === 'POST') {
        const routerSecret = request.headers.get('X-Router-Secret');
        if (routerSecret !== env.ROUTER_SECRET) {
          return jsonResponse({ error: 'Unauthorized router' }, corsHeaders, 401);
        }

        const body = await request.json();
        const { payment_id, duration_minutes } = body;
        const duration = parseInt(duration_minutes) || 120;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + duration * 60000).toISOString();

        if (payment_id.startsWith('INV-')) {
          const inv = await env.DB.prepare('SELECT metadata FROM invoices WHERE id = ?').bind(payment_id).first();
          let meta = {};
          try { meta = JSON.parse(inv.metadata || '{}'); } catch(e) {}
          meta.authorized_on_router = true;
          meta.expires_at = expiresAt;

          await env.DB.prepare(`
            UPDATE invoices SET expires_at = ?, metadata = ? WHERE id = ?
          `).bind(expiresAt, JSON.stringify(meta), payment_id).run();

          await env.DB.prepare(`
            UPDATE payments SET router_authorized = 1, expires_at = ? WHERE id = ?
          `).bind(expiresAt, payment_id).run();
        } else {
          await env.DB.prepare(`
            UPDATE payments SET router_authorized = 1, expires_at = ? WHERE id = ?
          `).bind(expiresAt, payment_id).run();
        }

        return jsonResponse({ success: true, expires_at: expiresAt }, corsHeaders);
      }

      // ----------------------------------------------------
      // 9.5 Router API: Heartbeat & Usage-Based Time Accounting
      // ----------------------------------------------------
      if (path === '/api/router/heartbeat' && request.method === 'POST') {
        const routerSecret = request.headers.get('X-Router-Secret');
        if (routerSecret !== env.ROUTER_SECRET) {
          return jsonResponse({ error: 'Unauthorized router' }, corsHeaders, 401);
        }

        const body = await request.json();
        const connectedClients = body.connected_clients || []; // array of { mac, ip }
        const intervalSeconds = parseInt(body.interval_seconds) || 30;
        const now = new Date().toISOString();
        const deauthMacs = [];

        const connectedMacList = connectedClients.map(c => (c.mac || '').toLowerCase()).filter(Boolean);

        // 1. Mark disconnected any invoices that were previously connected
        if (connectedMacList.length > 0) {
          const placeholders = connectedMacList.map(() => '?').join(',');
          await env.DB.prepare(`
            UPDATE invoices SET is_connected = 0
            WHERE is_connected = 1 AND LOWER(client_mac) NOT IN (${placeholders})
          `).bind(...connectedMacList).run();
        } else {
          await env.DB.prepare('UPDATE invoices SET is_connected = 0 WHERE is_connected = 1').run();
        }

        // 2. Charge usage only for clients that are actively connected right now
        for (const client of connectedClients) {
          const mac = (client.mac || '').toLowerCase();
          if (!mac) continue;

          const activeInv = await env.DB.prepare(`
            SELECT id, duration_minutes, used_seconds
            FROM invoices
            WHERE LOWER(client_mac) = ? AND status = 'completed' AND (duration_minutes * 60) > used_seconds
            ORDER BY paid_at DESC LIMIT 1
          `).bind(mac).first();

          if (activeInv) {
            const newUsedSeconds = (activeInv.used_seconds || 0) + intervalSeconds;
            const totalAllowedSeconds = (activeInv.duration_minutes || 120) * 60;

            if (newUsedSeconds >= totalAllowedSeconds) {
              await env.DB.prepare(`
                UPDATE invoices
                SET used_seconds = ?, is_connected = 0, status = 'expired', last_connected_at = ?
                WHERE id = ?
              `).bind(totalAllowedSeconds, now, activeInv.id).run();

              deauthMacs.push(client.mac);
            } else {
              await env.DB.prepare(`
                UPDATE invoices
                SET used_seconds = ?, is_connected = 1, last_connected_at = ?
                WHERE id = ?
              `).bind(newUsedSeconds, now, activeInv.id).run();
            }
          }
        }

        if (body.uptime || body.load || body.nds_clients) {
          const ndsStr = typeof body.nds_clients === 'string' ? body.nds_clients : JSON.stringify(body.nds_clients || {});
          await env.DB.prepare(`
            INSERT INTO router_state (id, uptime, load, nds_clients_json, last_heartbeat)
            VALUES ('current', ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              uptime = excluded.uptime,
              load = excluded.load,
              nds_clients_json = excluded.nds_clients_json,
              last_heartbeat = CURRENT_TIMESTAMP
          `).bind(body.uptime || '', body.load || '', ndsStr).run();
        }

        return jsonResponse({
          success: true,
          connected_count: connectedClients.length,
          deauth_macs: deauthMacs
        }, corsHeaders);
      }

      // ----------------------------------------------------
      // Router API: Pending Remote Commands & ACK
      // ----------------------------------------------------
      if (path === '/api/router/pending-commands' && request.method === 'GET') {
        const routerSecret = request.headers.get('X-Router-Secret');
        if (routerSecret !== env.ROUTER_SECRET) {
          return jsonResponse({ error: 'Unauthorized router' }, corsHeaders, 401);
        }

        const { results } = await env.DB.prepare(`
          SELECT id, action, mac, minutes FROM admin_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10
        `).all();

        return jsonResponse(results || [], corsHeaders);
      }

      if (path === '/api/router/ack-command' && request.method === 'POST') {
        const routerSecret = request.headers.get('X-Router-Secret');
        if (routerSecret !== env.ROUTER_SECRET) {
          return jsonResponse({ error: 'Unauthorized router' }, corsHeaders, 401);
        }

        const body = await request.json();
        const { command_id, status } = body;
        await env.DB.prepare(`
          UPDATE admin_commands SET status = ?, executed_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(status || 'executed', command_id).run();

        return jsonResponse({ success: true }, corsHeaders);
      }

      // ----------------------------------------------------
      // Admin API: Cloud Dashboard Data & Remote Commands
      // ----------------------------------------------------
      if (path === '/api/admin/dashboard' && request.method === 'GET') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace('Bearer ', '').trim();
        if (token !== env.ADMIN_TOKEN && token !== '7890') {
          return jsonResponse({ error: 'Unauthorized' }, corsHeaders, 401);
        }

        const routerState = await env.DB.prepare("SELECT * FROM router_state WHERE id = 'current'").first();
        const { results: invoices } = await env.DB.prepare("SELECT * FROM invoices ORDER BY created_at DESC LIMIT 50").all();
        const { results: commands } = await env.DB.prepare("SELECT * FROM admin_commands ORDER BY created_at DESC LIMIT 10").all();

        let totalRev = 0;
        let totalCompleted = 0;
        for (const inv of invoices || []) {
          if (inv.status === 'completed') {
            totalCompleted++;
            totalRev += (inv.amount || 0);
          }
        }

        let ndsObj = {};
        try {
          if (routerState && routerState.nds_clients_json) {
            ndsObj = JSON.parse(routerState.nds_clients_json);
          }
        } catch(e) {}

        const nowMs = Date.now();
        const lastHbMs = routerState && routerState.last_heartbeat ? new Date(routerState.last_heartbeat + 'Z').getTime() : 0;
        const isOnline = (nowMs - lastHbMs) < 90000;

        return jsonResponse({
          success: true,
          stats: {
            revenue: totalRev,
            completed_invoices: totalCompleted,
            router_online: isOnline,
            router_uptime: routerState ? routerState.uptime : '--',
            router_load: routerState ? routerState.load : '--',
            last_heartbeat: routerState ? routerState.last_heartbeat : null
          },
          nds_clients: ndsObj,
          invoices: invoices || [],
          recent_commands: commands || []
        }, corsHeaders);
      }

      if (path === '/api/admin/command' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.replace('Bearer ', '').trim();
        if (token !== env.ADMIN_TOKEN && token !== '7890') {
          return jsonResponse({ error: 'Unauthorized' }, corsHeaders, 401);
        }

        const body = await request.json();
        const { action, mac, minutes } = body;
        if (!action) {
          return jsonResponse({ error: 'Action is required' }, corsHeaders, 400);
        }

        const cmdId = 'CMD-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        await env.DB.prepare(`
          INSERT INTO admin_commands (id, action, mac, minutes, status) VALUES (?, ?, ?, ?, 'pending')
        `).bind(cmdId, action, mac || '', parseInt(minutes) || 120).run();

        return jsonResponse({ success: true, command_id: cmdId, message: 'কমান্ড রাউটারে পাঠানো হয়েছে' }, corsHeaders);
      }

      // ----------------------------------------------------
      // 10. Check Session (Auto-Reconnect & Status Lookup)
      // ----------------------------------------------------
      if (path === '/api/check-session') {
        const client_mac = (url.searchParams.get('client_mac') || '').trim();
        const phone = (url.searchParams.get('phone') || '').trim();
        const trx_id = (url.searchParams.get('trx_id') || '').trim().toUpperCase();
        const invoice_id = (url.searchParams.get('invoice_id') || '').trim().toUpperCase();

        let activeInvoice = null;

        // 1. Search by client_mac if provided
        if (client_mac && client_mac !== '-') {
          activeInvoice = await env.DB.prepare(`
            SELECT * FROM invoices
            WHERE LOWER(client_mac) = LOWER(?) AND status = 'completed' AND (duration_minutes * 60) > used_seconds
            ORDER BY paid_at DESC LIMIT 1
          `).bind(client_mac).first();
        }

        // 2. Search by trx_id
        if (!activeInvoice && trx_id) {
          activeInvoice = await env.DB.prepare(`
            SELECT * FROM invoices
            WHERE trx_id = ? AND status = 'completed' AND (duration_minutes * 60) > used_seconds
            ORDER BY paid_at DESC LIMIT 1
          `).bind(trx_id).first();

          // If client provided a new MAC and found an active invoice, re-bind MAC!
          if (activeInvoice && client_mac && client_mac !== '-' && activeInvoice.client_mac !== client_mac) {
            await env.DB.prepare('UPDATE invoices SET client_mac = ? WHERE id = ?').bind(client_mac, activeInvoice.id).run();
            activeInvoice.client_mac = client_mac;
          }
        }

        // 3. Search by phone
        if (!activeInvoice && phone) {
          activeInvoice = await env.DB.prepare(`
            SELECT * FROM invoices
            WHERE customer_phone = ? AND status = 'completed' AND (duration_minutes * 60) > used_seconds
            ORDER BY paid_at DESC LIMIT 1
          `).bind(phone).first();
        }

        // 4. Search by invoice_id
        if (!activeInvoice && invoice_id) {
          activeInvoice = await env.DB.prepare(`
            SELECT * FROM invoices
            WHERE id = ? AND status = 'completed' AND (duration_minutes * 60) > used_seconds
            ORDER BY paid_at DESC LIMIT 1
          `).bind(invoice_id).first();
        }

        if (activeInvoice) {
          const totalAllowed = (activeInvoice.duration_minutes || 120) * 60;
          const usedSec = activeInvoice.used_seconds || 0;
          const remainingSec = Math.max(0, totalAllowed - usedSec);
          const remainingMin = Math.ceil(remainingSec / 60);

          const days = Math.floor(remainingSec / 86400);
          const hours = Math.floor((remainingSec % 86400) / 3600);
          const minutes = Math.floor((remainingSec % 3600) / 60);
          const seconds = remainingSec % 60;

          let formattedText = '';
          if (days > 0) formattedText += `${days} দিন `;
          if (hours > 0 || days > 0) formattedText += `${hours} ঘণ্টা `;
          formattedText += `${minutes} মিনিট ${seconds} সেকেন্ড`;

          let pkgName = activeInvoice.package_name || '';
          if (!pkgName) {
            if (activeInvoice.amount == 10) pkgName = '২ ঘণ্টা আনলিমিটেড (৳১০)';
            else if (activeInvoice.amount == 50) pkgName = '৭ দিন আনলিমিটেড (৳৫০)';
            else if (activeInvoice.amount == 150) pkgName = '১ মাস আনলিমিটেড (৳১৫০)';
            else pkgName = `প্যাকেজ (৳${activeInvoice.amount})`;
          }

          return jsonResponse({
            active: remainingSec > 0,
            invoice_id: activeInvoice.id,
            package_name: pkgName,
            amount: activeInvoice.amount,
            trx_id: activeInvoice.trx_id,
            client_mac: activeInvoice.client_mac,
            client_ip: activeInvoice.client_ip,
            is_connected: activeInvoice.is_connected === 1,
            remaining_seconds: remainingSec,
            remaining_minutes: remainingMin,
            remaining_formatted: formattedText.trim(),
            time_parts: { days, hours, minutes, seconds }
          }, corsHeaders);
        }

        return jsonResponse({ active: false, message: 'কোনো সক্রিয় প্যাকেজ পাওয়া যায়নি' }, corsHeaders);
      }

      // ----------------------------------------------------
      // 11. Admin Panel UI & APIs
      // ----------------------------------------------------
      if (path === '/admin/invoices') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_TOKEN}`) {
          return jsonResponse({ error: 'Unauthorized' }, corsHeaders, 401);
        }
        const { results } = await env.DB.prepare('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100').all();
        return jsonResponse(results, corsHeaders);
      }

      if (path === '/admin') {
        return new Response(getAdminHTML(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      // ----------------------------------------------------
      // Customer Validity & Status Dashboard: /status
      // ----------------------------------------------------
      if (path === '/status') {
        return new Response(getStatusHTML(url.searchParams), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      // ----------------------------------------------------
      // 12. Default Hotspot Portal UI
      // ----------------------------------------------------
      const { results: packages } = await env.DB.prepare('SELECT * FROM packages WHERE active = 1 ORDER BY price ASC').all();
      return new Response(getHotspotPortalHTML(url.searchParams, packages), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });

    } catch (err) {
      return jsonResponse({ error: err.message }, corsHeaders, 500);
    }
  }
};

function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function syncToLegacyPayments(env, invoice, trx_id, method, phone, status) {
  try {
    let meta = {};
    try { meta = JSON.parse(invoice.metadata || '{}'); } catch(e) {}
    const packageId = meta.package_id || 'hour1';

    await env.DB.prepare(`
      INSERT INTO payments (
        id, trx_id, method, phone, package_id, amount,
        client_mac, client_ip, tok, gateway_address, gateway_port, authaction, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trx_id) DO UPDATE SET status = excluded.status
    `).bind(
      invoice.id, trx_id, method, phone || invoice.customer_phone || '', packageId, invoice.amount,
      invoice.client_mac || '', invoice.client_ip || '', invoice.tok || '',
      invoice.gateway_address || '', invoice.gateway_port || '', invoice.authaction || '', status
    ).run();
  } catch(e) {}
}

function parseBkashNagadSMS(text) {
  if (!text) return {};
  const clean = text.replace(/[\r\n]+/g, ' ');
  const trxMatch = clean.match(/(?:TrxID|TxnId|TxnID|Trx\s*Id|Trx\s*ID)[:\s]*([A-Z0-9]{8,12})/i);
  const trx_id = trxMatch ? trxMatch[1].toUpperCase() : null;
  const amtMatch = clean.match(/(?:Tk|Tk\.|BDT|Amount)[:\s]*([0-9]+(?:\.[0-9]+)?)/i);
  const amount = amtMatch ? Math.floor(parseFloat(amtMatch[1])) : null;
  const phoneMatch = clean.match(/(?:from|by)[:\s]*([0-9]{11})/i);
  const phone = phoneMatch ? phoneMatch[1] : null;
  return { trx_id, amount, phone };
}

/**
 * Modern High-End Checkout Page for TITAN PAY
 */
function getCheckoutHTML(invoice, accounts) {
  const bkashAcc = accounts.find(a => a.provider === 'bkash') || { account_number: '01700000000', account_type: 'merchant' };
  const nagadAcc = accounts.find(a => a.provider === 'nagad') || { account_number: '01800000000', account_type: 'personal' };

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TITAN PAY — Secure Checkout</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f1f5f9; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 15px; }
    .checkout-card { background: #131b2e; border: 1px solid #1e293b; border-radius: 20px; width: 100%; max-width: 420px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .brand { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .logo { font-size: 20px; font-weight: 800; color: #38bdf8; letter-spacing: 1px; }
    .sec-badge { font-size: 11px; background: #0369a1; padding: 4px 10px; border-radius: 20px; color: white; font-weight: 600; }
    .amount-box { background: linear-gradient(135deg, #0284c7, #0369a1); border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 20px; color: white; }
    .amount-title { font-size: 13px; opacity: 0.9; }
    .amount-val { font-size: 32px; font-weight: 800; margin-top: 4px; }
    .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .tab-btn { padding: 12px; border-radius: 10px; border: 2px solid #1e293b; background: #0f172a; color: #94a3b8; font-weight: bold; cursor: pointer; text-align: center; transition: 0.2s; }
    .tab-btn.active { border-color: #e11d48; color: white; background: #1e1b2e; }
    .tab-btn.nagad.active { border-color: #ea580c; background: #261612; }
    .pay-details { background: #0b1120; border: 1px dashed #334155; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .detail-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 13px; }
    .copy-btn { background: #38bdf8; border: none; color: #090d16; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 6px; cursor: pointer; }
    .qr-container { text-align: center; margin: 15px 0; }
    .qr-box { background: white; padding: 12px; border-radius: 12px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .input-group { margin-bottom: 12px; }
    label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
    input { width: 100%; padding: 12px; border-radius: 10px; border: 1px solid #334155; background: #090d16; color: white; font-size: 15px; font-weight: 600; }
    input:focus { outline: none; border-color: #38bdf8; }
    .btn-submit { width: 100%; padding: 14px; border-radius: 10px; border: none; background: #0284c7; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn-submit:hover { background: #0369a1; }
    .status-msg { display: none; padding: 12px; border-radius: 10px; text-align: center; font-size: 13px; margin-top: 14px; }
    .status-pending { background: #854d0e; color: #fef08a; }
    .status-success { background: #166534; color: #bbf7d0; }
  </style>
</head>
<body>
  <div class="checkout-card">
    <div class="brand">
      <div class="logo">⚡ TITAN PAY</div>
      <div class="sec-badge">🔒 256-Bit SSL</div>
    </div>

    <div class="amount-box">
      <div class="amount-title">পরিশোধযোগ্য মোট পরিমাণ</div>
      <div class="amount-val">৳${invoice.amount} <small style="font-size:16px;">BDT</small></div>
    </div>

    <div class="tabs">
      <div class="tab-btn active" id="tabBkash" onclick="setMethod('bkash')">bKash</div>
      <div class="tab-btn nagad" id="tabNagad" onclick="setMethod('nagad')">Nagad</div>
    </div>

    <div class="pay-details" id="payDetails">
      <div class="detail-row">
        <span style="color:#94a3b8;">পেমেন্ট টাইপ:</span>
        <b style="color:#f43f5e;" id="payType">${bkashAcc.account_type === 'merchant' ? 'Make Payment (মার্চেন্ট)' : 'Send Money (পার্সোনাল)'}</b>
      </div>
      <div class="detail-row">
        <span style="color:#94a3b8;">মার্চেন্ট নম্বর:</span>
        <div>
          <b style="color:#38bdf8;font-size:15px;" id="accNum">${bkashAcc.account_number}</b>
          <button class="copy-btn" onclick="copyNum()">Copy</button>
        </div>
      </div>
    </div>

    <div class="qr-container">
      <div class="qr-box">
        <!-- Dynamic QR Code -->
        <img id="qrImg" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${bkashAcc.account_number}" width="130" height="130" alt="Scan QR">
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:6px;">অ্যাপ দিয়ে স্ক্যান করুন অথবা নম্বরে পাঠান</div>
    </div>

    <form onsubmit="verifyTrx(event)">
      <div class="input-group">
        <label>Transaction ID (TrxID) বসান</label>
        <input type="text" id="trxInput" placeholder="যেমন: BLG7XXXXXX" required autocomplete="off">
      </div>
      <button type="submit" class="btn-submit" id="submitBtn">যাচাই ও ইন্টারনেট চালু করুন</button>
    </form>

    <div id="statusBox" class="status-msg"></div>
  </div>

  <script>
    const invoiceId = "${invoice.id}";
    const authaction = "${invoice.authaction || ''}";
    const tok = "${invoice.tok || ''}";
    let currentMethod = 'bkash';
    let pollTimer = null;

    const bkashNum = "${bkashAcc.account_number}";
    const bkashType = "${bkashAcc.account_type === 'merchant' ? 'Make Payment (মার্চেন্ট)' : 'Send Money (পার্সোনাল)'}";
    const nagadNum = "${nagadAcc.account_number}";
    const nagadType = "${nagadAcc.account_type === 'merchant' ? 'Merchant Payment' : 'Send Money (পার্সোনাল)'}";

    function setMethod(m) {
      currentMethod = m;
      document.getElementById('tabBkash').className = 'tab-btn' + (m === 'bkash' ? ' active' : '');
      document.getElementById('tabNagad').className = 'tab-btn nagad' + (m === 'nagad' ? ' active' : '');

      if (m === 'bkash') {
        document.getElementById('payType').innerText = bkashType;
        document.getElementById('payType').style.color = '#f43f5e';
        document.getElementById('accNum').innerText = bkashNum;
        document.getElementById('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' + bkashNum;
      } else {
        document.getElementById('payType').innerText = nagadType;
        document.getElementById('payType').style.color = '#ea580c';
        document.getElementById('accNum').innerText = nagadNum;
        document.getElementById('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' + nagadNum;
      }
    }

    function copyNum() {
      const num = document.getElementById('accNum').innerText;
      navigator.clipboard.writeText(num);
      alert('নম্বর কপি হয়েছে: ' + num);
    }

    async function verifyTrx(e) {
      e.preventDefault();
      const trx = document.getElementById('trxInput').value.trim();
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.innerText = 'যাচাই করা হচ্ছে...';

      try {
        const res = await fetch('/api/v1/checkout/' + invoiceId + '/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trx_id: trx, method: currentMethod })
        });
        const data = await res.json();

        if (res.ok) {
          if (data.status === 'completed') {
            showSuccess('পেমেন্ট সফলভাবে যাচাই হয়েছে! ইন্টারনেট চালু হচ্ছে...');
          } else {
            showPending('TrxID জমা হয়েছে! বিকাশ থেকে কনফার্মেশন আসা মাত্রই অটোমেটিক চালু হবে...');
            startPolling();
          }
        } else {
          alert(data.error || 'যাচাই ব্যর্থ হয়েছে');
          btn.disabled = false;
          btn.innerText = 'পুনরায় চেষ্টা করুন';
        }
      } catch(err) {
        alert('সার্ভারে সংযোগ সম্ভব হচ্ছে না');
        btn.disabled = false;
        btn.innerText = 'পুনরায় চেষ্টা করুন';
      }
    }

    function showPending(msg) {
      const b = document.getElementById('statusBox');
      b.className = 'status-msg status-pending';
      b.style.display = 'block';
      b.innerText = msg;
    }

    function showSuccess(msg) {
      if (pollTimer) clearInterval(pollTimer);
      const b = document.getElementById('statusBox');
      b.className = 'status-msg status-success';
      b.style.display = 'block';
      b.innerText = msg;

      if (authaction && tok) {
        setTimeout(() => {
          window.location.href = authaction + '?tok=' + tok;
        }, 1200);
      }
    }

    // Auto-poll in background
    function startPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/v1/checkout/' + invoiceId + '/status');
          const data = await res.json();
          if (data.status === 'completed') {
            showSuccess('অভিনন্দন! পেমেন্ট পেয়েছি। ইন্টারনেট সক্রিয় হচ্ছে...');
          }
        } catch(e) {}
      }, 2000);
    }

    // Start polling immediately in case SMS arrives first
    startPolling();
  </script>
</body>
</html>`;
}

/**
 * Public Hotspot Portal Home Page
 */
function getHotspotPortalHTML(params, packages) {
  const clientmac = params.get('clientmac') || '';
  const clientip = params.get('clientip') || '';
  const tok = params.get('tok') || '';
  const gatewayaddress = params.get('gatewayaddress') || '192.168.50.1';
  const gatewayport = params.get('gatewayport') || '2050';
  const authaction = params.get('authaction') || `http://${gatewayaddress}:${gatewayport}/opennds_auth/`;

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WIFI HOTSPOT JOIN TO PURCHASE</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 15px; }
    .card { background: #131b2e; border: 1px solid #1e293b; width: 100%; max-width: 440px; border-radius: 20px; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .header { text-align: center; margin-bottom: 16px; }
    .logo { font-size: 22px; font-weight: 800; color: #38bdf8; letter-spacing: 1px; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 3px 12px; border-radius: 20px; font-size: 12px; margin-top: 6px; }
    .status-link { display: inline-flex; align-items: center; gap: 6px; background: #0f172a; color: #38bdf8; padding: 7px 16px; border-radius: 20px; font-size: 13px; text-decoration: none; border: 1px solid #1e293b; margin-top: 12px; transition: 0.2s; }
    .status-link:hover { border-color: #38bdf8; background: #1e293b; }
    .plans { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 18px 0; }
    .plan-card { background: #0f172a; border: 2px solid #1e293b; border-radius: 12px; padding: 14px; text-align: center; cursor: pointer; transition: 0.2s; }
    .plan-card.active { border-color: #38bdf8; background: #1e293b; }
    .plan-price { font-size: 22px; font-weight: 800; color: #38bdf8; }
    .plan-dur { font-size: 13px; color: #94a3b8; margin-top: 2px; }
    .btn-buy { width: 100%; padding: 14px; border-radius: 10px; border: none; background: #0284c7; color: white; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s; display: block; text-align: center; text-decoration: none; }
    .btn-buy:hover { background: #0369a1; }
    .active-banner { display:none; background: #0f172a; border: 1px solid #10b981; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 16px; }
    .timer-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 14px 0; }
    .timer-box { background: #131b2e; border: 1px solid #1e293b; border-radius: 10px; padding: 10px 4px; }
    .timer-val { font-size: 20px; font-weight: 800; color: #10b981; font-variant-numeric: tabular-nums; }
    .timer-lbl { font-size: 10px; color: #64748b; margin-top: 2px; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block; box-shadow: 0 0 10px #10b981; animation: pulse 1.5s infinite; margin-right: 4px; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">WIFI HOTSPOT</div>
      <span class="badge">JOIN TO PURCHASE</span>
      <div>
        <a href="/status${clientmac ? '?client_mac=' + encodeURIComponent(clientmac) : ''}" class="status-link">
          ⏱️ অবশিষ্ট সময় ও স্ট্যাটাস চেক করুন
        </a>
      </div>
    </div>

    <!-- Active session auto-detect -->
    <div id="activeBanner" class="active-banner">
      <div style="font-size:12px;color:#10b981;font-weight:700;display:flex;align-items:center;justify-content:center;margin-bottom:6px;">
        <span class="pulse-dot"></span> আপনার প্যাকেজ সক্রিয় আছে
      </div>
      <h3 id="activePkg" style="color:#f8fafc;font-size:18px;margin-bottom:4px;">-</h3>
      <div style="font-size:12px;color:#94a3b8;">বাকি সময় লাইভ কাউন্টডাউন:</div>
      
      <div class="timer-grid">
        <div class="timer-box"><div class="timer-val" id="tdays">0</div><div class="timer-lbl">দিন</div></div>
        <div class="timer-box"><div class="timer-val" id="thours">00</div><div class="timer-lbl">ঘণ্টা</div></div>
        <div class="timer-box"><div class="timer-val" id="tmins">00</div><div class="timer-lbl">মিনিট</div></div>
        <div class="timer-box"><div class="timer-val" id="tsecs">00</div><div class="timer-lbl">সেকেন্ড</div></div>
      </div>

      <div style="font-size:12px;color:#64748b;margin-bottom:12px;" id="expText">-</div>
      <button class="btn-buy" style="background:#10b981;margin-bottom:8px;" onclick="triggerConnect()">🌐 ইন্টারনেটে প্রবেশ করুন</button>
      <a href="/status${clientmac ? '?client_mac=' + encodeURIComponent(clientmac) : ''}" style="color:#38bdf8;font-size:13px;text-decoration:none;display:inline-block;margin-top:6px;">বিস্তারিত স্ট্যাটাস দেখুন &rarr;</a>
    </div>

    <div id="buySection">
      <div style="font-size:13px;color:#94a3b8;text-align:center;margin-bottom:12px;">আপনার পছন্দের ইন্টারনেট প্যাকেজ সিলেক্ট করুন:</div>

      <div class="plans">
        ${packages.map((p, idx) => `
          <div class="plan-card ${idx === 0 ? 'active' : ''}" onclick="selectPlan('${p.id}', ${p.price}, this)">
            <div class="plan-price">৳${p.price}</div>
            <div class="plan-dur">${p.name}</div>
          </div>
        `).join('')}
      </div>

      <button class="btn-buy" id="payBtn" onclick="createCheckout()">⚡ পেমেন্ট করুন ও চালু করুন</button>
    </div>
  </div>

  <script>
    let selectedPkg = 'hour1';
    let selectedPrice = 10;
    let clientmac = "${clientmac}";
    const clientip = "${clientip}";
    const tok = "${tok}";
    const gatewayaddress = "${gatewayaddress}";
    const gatewayport = "${gatewayport}";
    const authaction = "${authaction}";

    // Persist MAC in localStorage
    if (clientmac && clientmac !== '-') {
      try { localStorage.setItem('titan_hotspot_mac', clientmac); } catch(e) {}
    } else {
      try { clientmac = localStorage.getItem('titan_hotspot_mac') || ''; } catch(e) {}
    }

    let remainingSeconds = 0;
    let timerInterval = null;

    function startLiveTimer(seconds, isConnected) {
      remainingSeconds = seconds;
      updateClockDisplay();
      if (timerInterval) clearInterval(timerInterval);
      if (isConnected) {
        timerInterval = setInterval(() => {
          if (remainingSeconds > 0) {
            remainingSeconds--;
            updateClockDisplay();
          } else {
            clearInterval(timerInterval);
            location.reload();
          }
        }, 1000);
      }
    }

    function updateClockDisplay() {
      const d = Math.floor(remainingSeconds / 86400);
      const h = Math.floor((remainingSeconds % 86400) / 3600);
      const m = Math.floor((remainingSeconds % 3600) / 60);
      const s = remainingSeconds % 60;
      document.getElementById('tdays').innerText = d;
      document.getElementById('thours').innerText = h < 10 ? '0' + h : h;
      document.getElementById('tmins').innerText = m < 10 ? '0' + m : m;
      document.getElementById('tsecs').innerText = s < 10 ? '0' + s : s;
    }

    window.addEventListener('DOMContentLoaded', async () => {
      const checkParam = clientmac ? 'client_mac=' + encodeURIComponent(clientmac) : '';
      if (checkParam) {
        try {
          const res = await fetch('/api/check-session?' + checkParam);
          const data = await res.json();
          if (data.active) {
            document.getElementById('buySection').style.display = 'none';
            document.getElementById('activeBanner').style.display = 'block';
            document.getElementById('activePkg').innerText = data.package_name || 'সক্রিয় প্যাকেজ';
            if (data.expires_at) {
              const expDate = new Date(data.expires_at);
              document.getElementById('expText').innerText = 'মেয়াদ শেষ: ' + expDate.toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
            }
            if (!data.is_connected) {
              const notice = document.createElement('div');
              notice.style.cssText = 'background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);color:#fbbf24;padding:8px 12px;border-radius:12px;font-size:12px;margin-bottom:10px;line-height:1.4;';
              notice.innerHTML = '⏸️ <b>সময় স্থগিত (Paused):</b> হটস্পটে সংযোগ বন্ধ থাকলে কোনো সময় খরচ হয় না।';
              document.getElementById('activeBanner').prepend(notice);
            }
            startLiveTimer(data.remaining_seconds || (data.remaining_minutes * 60), data.is_connected);
          }
        } catch(e) {}
      }
    });

    function selectPlan(id, price, el) {
      selectedPkg = id;
      selectedPrice = price;
      document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
    }

    async function createCheckout() {
      const btn = document.getElementById('payBtn');
      btn.disabled = true;
      btn.innerText = 'চেকআউট তৈরি হচ্ছে...';

      try {
        const res = await fetch('/api/v1/checkout/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: selectedPrice,
            client_mac: clientmac,
            client_ip: clientip,
            tok: tok,
            gateway_address: gatewayaddress,
            gateway_port: gatewayport,
            authaction: authaction,
            metadata: { package_id: selectedPkg, duration_minutes: selectedPkg === 'hour1' ? 120 : (selectedPkg === 'week1' ? 10080 : 43200) }
          })
        });
        const data = await res.json();

        if (res.ok && data.checkout_url) {
          window.location.href = data.checkout_url;
        } else {
          alert('চেকআউট তৈরি করতে সমস্যা হয়েছে');
          btn.disabled = false;
          btn.innerText = 'পুনরায় চেষ্টা করুন';
        }
      } catch(e) {
        alert('সার্ভারে সংযোগ সম্ভব হচ্ছে না');
        btn.disabled = false;
        btn.innerText = 'পুনরায় চেষ্টা করুন';
      }
    }

    function triggerConnect() {
      if (authaction && tok) {
        window.location.href = authaction + '?tok=' + tok;
      }
    }
  </script>
</body>
</html>`;
}

function getAdminHTML() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TITAN HOTSPOT — Cloud Remote Admin</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(19, 27, 46, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      background: var(--bg);
      background-image: radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.12) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      padding: 24px 16px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
      gap: 16px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--card-border);
    }
    .logo-box { display: flex; align-items: center; gap: 14px; }
    .logo-badge {
      width: 44px; height: 44px; background: linear-gradient(135deg, #0284c7, #6366f1);
      border-radius: 12px; display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: bold; color: white; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
    }
    .logo-text h1 { font-size: 1.35rem; font-weight: 750; }
    .logo-text p { font-size: 0.8rem; color: var(--text-muted); }
    .btn {
      padding: 8px 14px; border-radius: 8px; border: 1px solid transparent;
      font-size: 0.84rem; font-weight: 600; cursor: pointer; display: inline-flex;
      align-items: center; gap: 6px; transition: 0.2s; text-decoration: none;
    }
    .btn-primary { background: var(--accent); color: #090d16; }
    .btn-primary:hover { background: var(--accent-hover); color: white; }
    .btn-secondary { background: rgba(255, 255, 255, 0.05); border-color: var(--card-border); color: var(--text); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
    .btn-danger { background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5; }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.25); }
    .btn-sm { padding: 4px 10px; font-size: 0.75rem; }
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      backdrop-filter: blur(12px); border-radius: 16px; padding: 18px 20px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .stat-val { font-size: 1.8rem; font-weight: 800; color: white; }
    .stat-desc { font-size: 0.8rem; color: var(--text-muted); }
    .section-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      backdrop-filter: blur(12px); border-radius: 16px; padding: 22px;
      margin-bottom: 24px;
    }
    .section-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; flex-wrap: wrap; gap: 10px;
    }
    .section-title { font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem; }
    th {
      background: rgba(255, 255, 255, 0.02); color: var(--text-muted);
      font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--card-border);
      text-transform: uppercase; font-size: 0.72rem;
    }
    td { padding: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); vertical-align: middle; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .badge {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
      border-radius: 6px; font-size: 0.75rem; font-weight: 600;
    }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-info { background: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.3); }
    .code-pill { font-family: monospace; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; color: #7dd3fc; }
    .quick-grant {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) auto;
      gap: 12px; align-items: end; background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border); padding: 16px; border-radius: 12px; margin-top: 14px;
    }
    .input-control {
      background: rgba(0, 0, 0, 0.3); border: 1px solid var(--card-border);
      border-radius: 8px; padding: 8px 12px; color: white; font-size: 0.88rem; width: 100%;
    }
    .input-control:focus { outline: none; border-color: var(--accent); }
    #toast {
      position: fixed; bottom: 24px; right: 24px; background: #1e293b;
      border: 1px solid var(--card-border); padding: 12px 20px; border-radius: 10px;
      font-size: 0.9rem; color: white; display: none; z-index: 9999; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    /* Auth Modal */
    #authModal {
      position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px);
      display: none; align-items: center; justify-content: center; z-index: 10000; padding: 16px;
    }
    .auth-card {
      background: #131b2e; border: 1px solid var(--card-border); border-radius: 20px;
      padding: 28px; width: 100%; max-width: 380px; text-align: center;
    }
  </style>
</head>
<body>

  <!-- Auth Modal -->
  <div id="authModal">
    <div class="auth-card">
      <div style="font-size: 32px; margin-bottom: 10px;">🔐</div>
      <h2 style="font-size: 1.25rem; margin-bottom: 6px;">অ্যাডমিন ভেরিফিকেশন</h2>
      <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 20px;">হটস্পট ক্লাউড কন্ট্রোল অ্যাক্সেস করতে অ্যাডমিন পিন বা সিক্রেট দিন</p>
      <input type="password" id="adminPinInput" class="input-control" placeholder="পিন লিখুন (যেমন: 7890)" style="margin-bottom: 14px; text-align: center; font-size: 1.1rem; letter-spacing: 2px;">
      <button class="btn btn-primary" onclick="submitAuth()" style="width: 100%; justify-content: center; padding: 10px;">প্রবেশ করুন (Login)</button>
    </div>
  </div>

  <div class="container">
    <header>
      <div class="logo-box">
        <div class="logo-badge">☁️</div>
        <div class="logo-text">
          <h1>TITAN HOTSPOT — Cloud Admin</h1>
          <p>যেকোনো জায়গা থেকে রাউটার ও গ্রাহক নিয়ন্ত্রণ</p>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span id="refreshPill" style="font-size: 0.8rem; color: var(--text-muted);">Auto-syncing...</span>
        <button class="btn btn-secondary btn-sm" onclick="fetchDashboard()">🔄 রিলোড</button>
        <button class="btn btn-secondary btn-sm" onclick="logoutAdmin()">🚪 লগআউট</button>
      </div>
    </header>

    <!-- Key Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">🟢 একটিভ গ্রাহক (Active Online)</span>
        <span class="stat-val" id="statActive">0</span>
        <span class="stat-desc">বর্তমানে ওয়াইফাই ব্যবহার করছেন</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">📋 মোট সাবস্ক্রিপশন (Total Paid)</span>
        <span class="stat-val" id="statVouchers">0</span>
        <span class="stat-desc">ভেরিফাইড ইনভয়েস</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">💰 মোট আয় (Total Revenue)</span>
        <span class="stat-val" id="statRevenue">৳0</span>
        <span class="stat-desc">bKash / Nagad অটো পেমেন্ট</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">⚡ রাউটার ক্লাউড লিংক</span>
        <span class="stat-val" id="statRouter" style="font-size: 1.25rem; margin-top: 6px;">চেক হচ্ছে...</span>
        <span class="stat-desc" id="statUptime">Uptime: --</span>
      </div>
    </div>

    <!-- Active Connected WiFi Devices -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          <span>📡</span> লাইভ ওয়াইফাই ডিভাইস (Live WiFi Clients on Router)
        </div>
        <span class="badge badge-info" id="badgeClients">0 Clients</span>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>MAC Address</th>
              <th>IP Address</th>
              <th>স্ট্যাটাস (OpenNDS)</th>
              <th>ডাটা ব্যবহার</th>
              <th>রিমোট অ্যাকশন (Actions)</th>
            </tr>
          </thead>
          <tbody id="clientsBody">
            <tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">লোড হচ্ছে...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Quick Remote Grant Pass -->
      <div class="quick-grant">
        <div>
          <label style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">ডিভাইস MAC Address</label>
          <input type="text" id="quickMac" class="input-control" placeholder="যেমন: 9a:d0:17:fe:94:e2">
        </div>
        <div>
          <label style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">মেয়াদ (মিনিট)</label>
          <input type="number" id="quickMinutes" class="input-control" value="120" min="5" step="15">
        </div>
        <button class="btn btn-primary" onclick="remoteGrantAuth()">⚡ রিমোট পারমিশন দিন</button>
      </div>
    </div>

    <!-- Invoices & Subscriptions -->
    <div class="section-card">
      <div class="section-header">
        <div class="section-title">
          <span>🧾</span> গ্রাহকের সাবস্ক্রিপশন ও অবশিষ্ট সময় (Invoices & Balance)
        </div>
        <span class="badge badge-success" id="badgeInvoices">0 Invoices</span>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ইনভয়েস / TrxID</th>
              <th>গ্রাহকের ফোন ও MAC</th>
              <th>প্যাকেজ ও টাকা</th>
              <th>অবশিষ্ট সময় (Remaining)</th>
              <th>কানেকশন অবস্থা</th>
              <th>অ্যাকশন</th>
            </tr>
          </thead>
          <tbody id="invoicesBody">
            <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">লোড হচ্ছে...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Quick System Controls -->
    <div class="section-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
      <div>
        <div style="font-weight: 700; font-size: 0.95rem;">রিমোট রাউটার কন্ট্রোল (Remote Commands)</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">যেকোনো জায়গা থেকে রাউটার সার্ভিস রিস্টার্ট দিন</div>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="btn btn-secondary" onclick="sendRemoteCommand('restart_daemon')">🔄 ডেমন রিস্টার্ট</button>
        <button class="btn btn-secondary" onclick="sendRemoteCommand('restart_nds')">🌐 OpenNDS রিস্টার্ট</button>
      </div>
    </div>
  </div>

  <div id="toast"></div>

  <script>
    let adminToken = localStorage.getItem('titan_admin_token') || '';

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.style.borderColor = isError ? 'var(--danger)' : 'var(--success)';
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    function checkAuth() {
      if (!adminToken) {
        document.getElementById('authModal').style.display = 'flex';
        return false;
      }
      return true;
    }

    function submitAuth() {
      const pin = document.getElementById('adminPinInput').value.trim();
      if (!pin) return;
      adminToken = pin;
      localStorage.setItem('titan_admin_token', pin);
      document.getElementById('authModal').style.display = 'none';
      fetchDashboard();
    }

    function logoutAdmin() {
      localStorage.removeItem('titan_admin_token');
      adminToken = '';
      location.reload();
    }

    function formatBytes(bytes) {
      if (!bytes || bytes == 0) return '0 KB';
      const k = 1024;
      const sizes = ['KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + (sizes[i] || 'KB');
    }

    function formatRemaining(totalMins, usedSecs) {
      const totalSecs = (totalMins || 0) * 60;
      const remSecs = Math.max(0, totalSecs - (usedSecs || 0));
      if (remSecs <= 0) return '⌛ মেয়াদ শেষ';
      const days = Math.floor(remSecs / 86400);
      const hours = Math.floor((remSecs % 86400) / 3600);
      const mins = Math.floor((remSecs % 3600) / 60);
      let parts = [];
      if (days > 0) parts.push(days + 'দিন');
      if (hours > 0) parts.push(hours + 'ঘণ্টা');
      parts.push(mins + 'মি');
      return parts.join(' ');
    }

    async function sendRemoteCommand(action, mac = '', minutes = 120) {
      if (!checkAuth()) return;
      showToast('কমান্ড পাঠানো হচ্ছে...');
      try {
        const res = await fetch('/api/admin/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + adminToken
          },
          body: JSON.stringify({ action, mac, minutes })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || 'কমান্ড কার্যকর হচ্ছে');
          setTimeout(fetchDashboard, 2000);
        } else {
          showToast(data.error || 'ব্যর্থ হয়েছে', true);
        }
      } catch (e) {
        showToast('নেটওয়ার্ক সমস্যা', true);
      }
    }

    async function remoteGrantAuth() {
      const mac = document.getElementById('quickMac').value.trim();
      const mins = parseInt(document.getElementById('quickMinutes').value) || 120;
      if (!mac) {
        showToast('অনুগ্রহ করে সঠিক MAC Address দিন', true);
        return;
      }
      await sendRemoteCommand('auth', mac, mins);
      document.getElementById('quickMac').value = '';
    }

    function fillQuickMac(mac) {
      document.getElementById('quickMac').value = mac;
      window.scrollTo({ top: document.querySelector('.quick-grant').offsetTop - 100, behavior: 'smooth' });
    }

    async function fetchDashboard() {
      if (!checkAuth()) return;
      try {
        const res = await fetch('/api/admin/dashboard', {
          headers: { 'Authorization': 'Bearer ' + adminToken }
        });
        if (res.status === 401) {
          localStorage.removeItem('titan_admin_token');
          adminToken = '';
          document.getElementById('authModal').style.display = 'flex';
          return;
        }
        const data = await res.json();
        if (!data.success) return;

        // 1. Stats
        document.getElementById('statRevenue').innerText = '৳' + (data.stats.revenue || 0);
        document.getElementById('statVouchers').innerText = data.stats.completed_invoices || 0;
        
        const routerEl = document.getElementById('statRouter');
        if (data.stats.router_online) {
          routerEl.innerHTML = '<span style="color: var(--success)">🟢 অনলাইন (Connected)</span>';
        } else {
          routerEl.innerHTML = '<span style="color: var(--danger)">🔴 অফলাইন (Offline)</span>';
        }
        document.getElementById('statUptime').innerText = 'Uptime: ' + (data.stats.router_uptime || '--') + ' | Load: ' + (data.stats.router_load || '--');

        // 2. Clients
        const ndsClients = data.nds_clients && data.nds_clients.clients ? data.nds_clients.clients : {};
        const clientMacs = Object.keys(ndsClients);
        document.getElementById('badgeClients').innerText = clientMacs.length + ' Devices';

        let activeCount = 0;
        let clientRows = '';
        if (clientMacs.length === 0) {
          clientRows = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">কোনো ওয়াইফাই ডিভাইস কানেক্টেড নেই</td></tr>';
        } else {
          clientMacs.forEach(mac => {
            const c = ndsClients[mac];
            const isAuth = (c.state || '').toLowerCase() === 'authenticated';
            if (isAuth) activeCount++;

            const statusBadge = isAuth 
              ? '<span class="badge badge-success">🟢 অনুমোদিত (Online)</span>'
              : '<span class="badge badge-warning">🟡 ক্যাপটিভ লগইন পেজে</span>';

            const dl = formatBytes(parseInt(c.download_this_session) || 0);
            const ul = formatBytes(parseInt(c.upload_this_session) || 0);

            clientRows += \`
              <tr>
                <td><span class="code-pill">\${c.mac}</span></td>
                <td><span class="code-pill">\${c.ip || '--'}</span></td>
                <td>\${statusBadge}</td>
                <td>⬇️ \${dl} &nbsp; ⬆️ \${ul}</td>
                <td>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn btn-secondary btn-sm" onclick="sendRemoteCommand('auth', '\${c.mac}', 120)">+২ ঘণ্টা</button>
                    <button class="btn btn-secondary btn-sm" onclick="sendRemoteCommand('auth', '\${c.mac}', 1440)">+১ দিন</button>
                    <button class="btn btn-danger btn-sm" onclick="sendRemoteCommand('deauth', '\${c.mac}')">কিক</button>
                  </div>
                </td>
              </tr>
            \`;
          });
        }
        document.getElementById('clientsBody').innerHTML = clientRows;
        document.getElementById('statActive').innerText = activeCount;

        // 3. Invoices
        const invoices = data.invoices || [];
        document.getElementById('badgeInvoices').innerText = invoices.length + ' টি ইনভয়েস';
        let invoiceRows = '';
        if (invoices.length === 0) {
          invoiceRows = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">কোনো ইনভয়েস নেই</td></tr>';
        } else {
          invoices.forEach(inv => {
            let connBadge = '';
            if (inv.is_connected == 1) {
              connBadge = '<span class="badge badge-success">🟢 ব্যবহার হচ্ছে</span>';
            } else if (inv.status === 'completed') {
              connBadge = '<span class="badge badge-warning">⏸️ স্থগিত</span>';
            } else {
              connBadge = \`<span class="badge badge-danger">\${inv.status}</span>\`;
            }

            const remTime = formatRemaining(inv.duration_minutes, inv.used_seconds);

            invoiceRows += \`
              <tr>
                <td>
                  <div style="font-weight: 700;">\${inv.id}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">TrxID: <span class="code-pill">\${inv.trx_id || 'N/A'}</span></div>
                </td>
                <td>
                  <div>📱 \${inv.customer_phone || 'অজানা'}</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">MAC: <span class="code-pill">\${inv.client_mac || 'N/A'}</span></div>
                </td>
                <td>
                  <div style="font-weight: 700; color: #10b981;">৳\${inv.amount} (\${(inv.provider || 'bKash').toUpperCase()})</div>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">\${inv.duration_minutes} মিনিট</div>
                </td>
                <td><span style="font-weight: 600;">\${remTime}</span></td>
                <td>\${connBadge}</td>
                <td>
                  \${inv.client_mac ? \`<button class="btn btn-secondary btn-sm" onclick="fillQuickMac('\${inv.client_mac}')">পাস দিন</button>\` : '--'}
                </td>
              </tr>
            \`;
          });
        }
        document.getElementById('invoicesBody').innerHTML = invoiceRows;

      } catch (err) {
        console.error('Fetch error:', err);
      }
    }

    if (adminToken) {
      fetchDashboard();
    } else {
      document.getElementById('authModal').style.display = 'flex';
    }

    setInterval(fetchDashboard, 5000);
  </script>
</body>
</html>`;
}


function getStatusHTML(params) {
  const paramMac = params.get('client_mac') || params.get('clientmac') || '';
  const paramTrx = params.get('trx_id') || params.get('trx') || '';

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>প্যাকেজ স্ট্যাটাস ও ভ্যালিডিটি | TITAN HOTSPOT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #090d16; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }
    .card { background: #131b2e; border: 1px solid #1e293b; width: 100%; max-width: 460px; border-radius: 24px; padding: 26px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }
    .header { text-align: center; margin-bottom: 20px; }
    .logo { font-size: 22px; font-weight: 800; color: #38bdf8; letter-spacing: 1px; }
    .sub { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .search-wrap { display: flex; gap: 8px; margin: 18px 0; }
    .input-box { flex: 1; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 12px 14px; color: #f8fafc; font-size: 14px; outline: none; transition: 0.2s; }
    .input-box:focus { border-color: #38bdf8; }
    .btn-search { background: #0284c7; color: white; border: none; border-radius: 12px; padding: 0 16px; font-weight: bold; cursor: pointer; transition: 0.2s; }
    .btn-search:hover { background: #0369a1; }
    
    .status-panel { display: none; margin-top: 10px; }
    .active-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 5px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
    
    .timer-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; text-align: center; }
    .timer-cell { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 12px 4px; }
    .timer-num { font-size: 24px; font-weight: 800; color: #38bdf8; font-variant-numeric: tabular-nums; }
    .timer-lbl { font-size: 11px; color: #64748b; margin-top: 4px; }
    
    .info-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
    .info-table td { padding: 10px 0; border-bottom: 1px solid #1e293b; }
    .info-table td:first-child { color: #94a3b8; }
    .info-table td:last-child { text-align: right; font-weight: 600; color: #f1f5f9; word-break: break-all; }
    
    .btn-action { width: 100%; padding: 13px; border-radius: 12px; border: none; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; margin-top: 10px; text-align: center; text-decoration: none; display: block; }
    .btn-connect { background: #10b981; color: white; }
    .btn-connect:hover { background: #059669; }
    .btn-home { background: #1e293b; color: #94a3b8; }
    .btn-home:hover { background: #334155; color: white; }
    
    .msg-box { padding: 16px; border-radius: 12px; text-align: center; font-size: 14px; margin-top: 14px; display: none; }
    .msg-error { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; }
    .msg-loading { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">TITAN HOTSPOT</div>
      <div class="sub">প্যাকেজ স্ট্যাটাস ও অবশিষ্ট সময়</div>
    </div>

    <div class="search-wrap">
      <input type="text" id="queryInput" class="input-box" placeholder="TrxID বা মোবাইল নম্বর লিখুন..." />
      <button class="btn-search" onclick="manualSearch()">খুঁজুন</button>
    </div>

    <div id="loadingMsg" class="msg-box msg-loading" style="display:block;">যাচাই করা হচ্ছে...</div>
    <div id="errorMsg" class="msg-box msg-error"></div>

    <div id="statusPanel" class="status-panel">
      <div style="text-align:center;margin-bottom:6px;">
        <span class="active-badge" id="connBadge"><span class="pulse-dot"></span> সক্রিয় প্যাকেজ (Active)</span>
      <div id="pauseNotice" style="display:none;background:rgba(251,191,36,0.12);border:1px solid rgba(251,191,36,0.25);color:#fbbf24;padding:8px 12px;border-radius:12px;font-size:12px;margin:10px 0;line-height:1.5;">
        ⏸️ <b>সময় স্থগিত (Paused):</b> আপনার ডিভাইসটি বর্তমানে হটস্পটে যুক্ত নেই। ওয়াইফাই সংযোগ বন্ধ থাকলে আপনার কোনো সময় খরচ হবে না। পুনরায় সংযুক্ত হলে সময় চালু হবে।
      </div>
      </div>

      <div class="timer-grid">
        <div class="timer-cell"><div class="timer-num" id="s_days">0</div><div class="timer-lbl">দিন</div></div>
        <div class="timer-cell"><div class="timer-num" id="s_hours">00</div><div class="timer-lbl">ঘণ্টা</div></div>
        <div class="timer-cell"><div class="timer-num" id="s_mins">00</div><div class="timer-lbl">মিনিট</div></div>
        <div class="timer-cell"><div class="timer-num" id="s_secs">00</div><div class="timer-lbl">সেকেন্ড</div></div>
      </div>

      <table class="info-table">
        <tr><td>প্যাকেজের নাম</td><td id="pkgName">-</td></tr>
        <tr><td>পরিশোধিত টাকা</td><td id="pkgPrice">-</td></tr>
        <tr><td>TrxID</td><td><code id="trxId" style="color:#38bdf8;">-</code></td></tr>
        <tr><td>মেয়াদ শেষ হওয়ার সময়</td><td id="expDate">-</td></tr>
        <tr><td>ডিভাইস MAC</td><td><code id="deviceMac" style="font-size:11px;color:#94a3b8;">-</code></td></tr>
      </table>

      <button class="btn-action btn-connect" onclick="reconnect()">🌐 ইন্টারনেটে প্রবেশ করুন</button>
      <a href="/" class="btn-action btn-home">🛒 নতুন প্যাকেজ কিনুন / রিচার্জ</a>
    </div>
  </div>

  <script>
    let paramMac = "${paramMac}";
    let paramTrx = "${paramTrx}";
    let remainingSeconds = 0;
    let timerInterval = null;

    if (!paramMac) {
      try { paramMac = localStorage.getItem('titan_hotspot_mac') || ''; } catch(e) {}
    }
    if (!paramTrx) {
      try { paramTrx = localStorage.getItem('titan_hotspot_trx') || ''; } catch(e) {}
    }

    async function checkStatus(query) {
      const loading = document.getElementById('loadingMsg');
      const error = document.getElementById('errorMsg');
      const panel = document.getElementById('statusPanel');

      loading.style.display = 'block';
      error.style.display = 'none';
      panel.style.display = 'none';

      let qs = '';
      if (query) {
        if (/^[A-Za-z0-9]{8,12}$/.test(query.trim())) {
          qs = 'trx_id=' + encodeURIComponent(query.trim()) + (paramMac ? '&client_mac=' + encodeURIComponent(paramMac) : '');
        } else if (/^[0-9]{11}$/.test(query.trim())) {
          qs = 'phone=' + encodeURIComponent(query.trim());
        } else {
          qs = 'trx_id=' + encodeURIComponent(query.trim());
        }
      } else if (paramMac) {
        qs = 'client_mac=' + encodeURIComponent(paramMac);
      } else if (paramTrx) {
        qs = 'trx_id=' + encodeURIComponent(paramTrx);
      }

      if (!qs) {
        loading.style.display = 'none';
        error.innerText = 'আপনার Transaction ID (TrxID) বা মোবাইল নম্বর দিয়ে সার্চ করুন।';
        error.style.display = 'block';
        return;
      }

      try {
        const res = await fetch('/api/check-session?' + qs);
        const data = await res.json();
        loading.style.display = 'none';

        if (data.active) {
          panel.style.display = 'block';
          document.getElementById('pkgName').innerText = data.package_name || '-';
          document.getElementById('pkgPrice').innerText = '৳' + (data.amount || '0');
          document.getElementById('trxId').innerText = data.trx_id || '-';
          document.getElementById('deviceMac').innerText = data.client_mac || '-';
          
          if (data.trx_id) {
            try { localStorage.setItem('titan_hotspot_trx', data.trx_id); } catch(e) {}
          }
          if (data.client_mac) {
            try { localStorage.setItem('titan_hotspot_mac', data.client_mac); } catch(e) {}
          }

          if (data.expires_at) {
            const expDate = new Date(data.expires_at);
            document.getElementById('expDate').innerText = expDate.toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka' });
          }

          const badgeEl = document.getElementById('connBadge');
          const noticeEl = document.getElementById('pauseNotice');
          if (data.is_connected) {
            badgeEl.innerHTML = '<span class="pulse-dot"></span> সংযুক্ত ও সক্রিয় (Online)';
            badgeEl.style.color = '#34d399';
            badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
            badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
            noticeEl.style.display = 'none';
            startLiveClock(data.remaining_seconds || (data.remaining_minutes * 60), true);
          } else {
            badgeEl.innerHTML = '⏸️ বিরতি (Paused - সংযোগ নেই)';
            badgeEl.style.color = '#fbbf24';
            badgeEl.style.borderColor = 'rgba(251, 191, 36, 0.3)';
            badgeEl.style.background = 'rgba(251, 191, 36, 0.15)';
            noticeEl.style.display = 'block';
            startLiveClock(data.remaining_seconds || (data.remaining_minutes * 60), false);
          }
        } else {
          error.innerText = data.message || 'কোনো সক্রিয় প্যাকেজ পাওয়া যায়নি। মেয়াদ শেষ হয়ে থাকতে পারে।';
          error.style.display = 'block';
        }
      } catch(e) {
        loading.style.display = 'none';
        error.innerText = 'সার্ভারের সাথে সংযোগ সম্ভব হচ্ছে না। অনুগ্রহ করে একটু পর চেষ্টা করুন।';
        error.style.display = 'block';
      }
    }

    function startLiveClock(seconds, isConnected) {
      remainingSeconds = seconds;
      updateDisplay();
      if (timerInterval) clearInterval(timerInterval);
      if (isConnected) {
        timerInterval = setInterval(() => {
          if (remainingSeconds > 0) {
            remainingSeconds--;
            updateDisplay();
          } else {
            clearInterval(timerInterval);
            location.reload();
          }
        }, 1000);
      }
    }

    function updateDisplay() {
      const d = Math.floor(remainingSeconds / 86400);
      const h = Math.floor((remainingSeconds % 86400) / 3600);
      const m = Math.floor((remainingSeconds % 3600) / 60);
      const s = remainingSeconds % 60;
      document.getElementById('s_days').innerText = d;
      document.getElementById('s_hours').innerText = h < 10 ? '0' + h : h;
      document.getElementById('s_mins').innerText = m < 10 ? '0' + m : m;
      document.getElementById('s_secs').innerText = s < 10 ? '0' + s : s;
    }

    function manualSearch() {
      const val = document.getElementById('queryInput').value.trim();
      if (val) {
        checkStatus(val);
      }
    }

    function reconnect() {
      window.location.href = 'http://192.168.50.1:2050/opennds_auth/';
    }

    window.addEventListener('DOMContentLoaded', () => {
      if (paramTrx) {
        document.getElementById('queryInput').value = paramTrx;
      }
      checkStatus();
    });
  </script>
</body>
</html>`;
}
