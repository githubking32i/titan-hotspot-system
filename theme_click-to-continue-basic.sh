#!/bin/sh
title="TITAN HOTSPOT Portal"

generate_splash_sequence() {
    portal_url="https://titan-hotspot.titano.workers.dev/?clientmac=${clientmac}&clientip=${clientip}&gatewayaddress=${gatewayaddress}&gatewayport=${gatewayport}&tok=${tok}&authaction=${authaction}"

    echo "<!DOCTYPE html>
<html lang=\"bn\">
<head>
  <meta charset=\"UTF-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\">
  <title>TITAN HOTSPOT - ইন্টারনেট লগইন</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #090d16;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 16px;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 24px 20px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(2, 132, 199, 0.15);
      border: 1px solid rgba(2, 132, 199, 0.4);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 8px;
    }
    .title {
      font-size: 1.35rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 12px;
      color: #94a3b8;
    }
    .section-box {
      background: #131b2e;
      border: 1px solid #23324d;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #38bdf8;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    input[type=\"text\"] {
      flex: 1;
      background: #0b1120;
      border: 1.5px solid #334155;
      border-radius: 10px;
      padding: 11px 12px;
      color: #fff;
      font-family: monospace;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      outline: none;
    }
    input[type=\"text\"]:focus {
      border-color: #0284c7;
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.3);
    }
    .btn {
      border: none;
      border-radius: 10px;
      padding: 12px 18px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #0284c7;
      color: #ffffff;
    }
    .btn-primary:active {
      background: #0369a1;
      transform: scale(0.98);
    }
    .btn-success {
      width: 100%;
      background: rgba(16, 185, 129, 0.15);
      border: 1.5px solid rgba(16, 185, 129, 0.4);
      color: #6ee7b7;
      margin-bottom: 14px;
    }
    .btn-success:active {
      background: rgba(16, 185, 129, 0.3);
    }
    .btn-cloud {
      width: 100%;
      background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
      color: #fff;
      text-decoration: none;
      padding: 13px;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.3);
    }
    .btn-cloud:active {
      transform: scale(0.98);
    }
    .meta-info {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 14px;
    }
    .meta-info span {
      color: #94a3b8;
      font-family: monospace;
    }
  </style>
</head>
<body>

  <div class=\"card\">
    <div class=\"header\">
      <div class=\"logo-badge\">⚡ TITAN WI-FI 6 HOTSPOT</div>
      <div class=\"title\">ইন্টারনেট সাইন-ইন পোর্টাল</div>
      <div class=\"subtitle\">কানেক্ট করতে ভাউচার কোড দিন বা অনলাইনে কিনুন</div>
    </div>

    <!-- Section 1: Physical Voucher Code Entry -->
    <div class=\"section-box\" style=\"border-color: #0284c7;\">
      <div class=\"section-title\">🎫 দোকান থেকে কেনা ভাউচার পিন দিন</div>
      <div class=\"input-row\">
        <input type=\"text\" id=\"vCode\" placeholder=\"TITAN-XXXX\" maxlength=\"12\" autocomplete=\"off\" autocorrect=\"off\" autocapitalize=\"characters\">
        <button class=\"btn btn-primary\" id=\"vBtn\" onclick=\"redeemVoucher()\">প্রবেশ</button>
      </div>
      <div style=\"font-size: 11px; color: #94a3b8; margin-top: 8px;\">কাগজের স্ক্র্যাচ কার্ডের পিন কোডটি এখানে লিখুন।</div>
    </div>

    <!-- Section 2: 3-Minute Free Trial -->
    <button class=\"btn btn-success\" id=\"trialBtn\" onclick=\"claimFreeTrial()\">
      🎁 ৩ মিনিট ফ্রি ট্রায়াল নিন (Free Trial)
    </button>

    <!-- Section 3: Online Payment via bKash / Nagad -->
    <a href=\"${portal_url}\" class=\"btn btn-cloud\">
      ⚡ বিকাশ / নগদ দিয়ে অনলাইনে প্যাকেজ কিনুন ➔
    </a>

    <div class=\"meta-info\">
      ডিভাইস MAC: <span>${clientmac}</span> • IP: <span>${clientip}</span>
    </div>
  </div>

  <script>
    async function redeemVoucher() {
      const code = (document.getElementById('vCode').value || '').trim().toUpperCase();
      if (!code) {
        alert('অনুগ্রহ করে সঠিক ভাউচার কোড লিখুন');
        return;
      }
      const btn = document.getElementById('vBtn');
      btn.innerText = 'যাচাই হচ্ছে...';
      btn.disabled = true;

      try {
        const res = await fetch('/cgi-bin/hotspot-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'redeem_voucher', mac: '${clientmac}', voucher_code: code })
        });
        const d = await res.json();
        alert(d.message || 'ভাউচার প্রসেস হয়েছে');
        if (d.success) {
          window.location.href = '${authaction}?tok=${tok}&redir=http://google.com';
        } else {
          btn.innerText = 'প্রবেশ';
          btn.disabled = false;
        }
      } catch (e) {
        alert('রাউটারের সাথে সংযোগ সমস্যা: ' + e);
        btn.innerText = 'প্রবেশ';
        btn.disabled = false;
      }
    }

    async function claimFreeTrial() {
      const btn = document.getElementById('trialBtn');
      btn.innerText = 'ফ্রি ট্রায়াল চালু হচ্ছে...';
      btn.disabled = true;

      try {
        const res = await fetch('/cgi-bin/hotspot-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'claim_trial', mac: '${clientmac}' })
        });
        const d = await res.json();
        alert(d.message || 'ফ্রি ট্রায়াল প্রসেস হয়েছে');
        if (d.success) {
          window.location.href = '${authaction}?tok=${tok}&redir=http://google.com';
        } else {
          btn.innerText = '🎁 ১০ মিনিট ফ্রি ট্রায়াল নিন (Free Trial)';
          btn.disabled = false;
        }
      } catch (e) {
        alert('সংযোগ সমস্যা: ' + e);
        btn.innerText = '🎁 ৩ মিনিট ফ্রি ট্রায়াল নিন (Free Trial)';
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>"
}

header() {
    return 0
}

footer() {
    return 0
}
