package com.titano.hotspotadmin;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageButton;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton;
import com.google.android.material.textfield.TextInputEditText;

public class MainActivity extends AppCompatActivity {

    private String adminToken = "";
    private TextView tvRouterStatus, tvStatActive, tvStatRevenue, tvStatVouchers, tvEmpty;
    private MaterialButton btnTabClients, btnTabInvoices, btnTabWebAdmin;
    private MaterialButton btnQuickVoucher, btnQuickVip, btnQuickSpeed, btnQuickService;
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView rvList;
    private ExtendedFloatingActionButton fabQuickAuth;
    private ImageButton btnRefresh, btnLogout;

    // Full Web Admin elements
    private View layoutWebAdmin;
    private WebView webViewAdmin;
    private ProgressBar pbWebLoading;
    private TextView tvWebUrl;
    private MaterialButton btnWebRouter, btnWebCloud;
    private ImageButton btnWebReload;
    private boolean isWebTab = false;

    private ClientAdapter clientAdapter;
    private InvoiceAdapter invoiceAdapter;
    private boolean isClientsTab = true;

    private final Handler autoSyncHandler = new Handler(Looper.getMainLooper());
    private Runnable autoSyncRunnable;

    private Models.DashboardResponse lastResponse;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Android 15 & 16 Edge-to-edge support
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (v, insets) -> {
            int statusBar = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            int navBar = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            v.setPadding(0, statusBar, 0, navBar);
            return insets;
        });

        adminToken = getIntent().getStringExtra("token");
        if (adminToken == null || adminToken.isEmpty()) {
            SharedPreferences prefs = getSharedPreferences("titan_admin_prefs", MODE_PRIVATE);
            adminToken = prefs.getString("admin_token", "7890");
        }

        initViews();
        setupAdapters();
        setupWebView();
        setupListeners();

        loadData();
        setupAutoSync();
    }

    private void initViews() {
        tvRouterStatus = findViewById(R.id.tvRouterStatus);
        tvStatActive = findViewById(R.id.tvStatActive);
        tvStatRevenue = findViewById(R.id.tvStatRevenue);
        tvStatVouchers = findViewById(R.id.tvStatVouchers);
        tvEmpty = findViewById(R.id.tvEmpty);

        btnTabClients = findViewById(R.id.btnTabClients);
        btnTabInvoices = findViewById(R.id.btnTabInvoices);
        btnTabWebAdmin = findViewById(R.id.btnTabWebAdmin);

        btnQuickVoucher = findViewById(R.id.btnQuickVoucher);
        btnQuickVip = findViewById(R.id.btnQuickVip);
        btnQuickSpeed = findViewById(R.id.btnQuickSpeed);
        btnQuickService = findViewById(R.id.btnQuickService);

        swipeRefresh = findViewById(R.id.swipeRefresh);
        rvList = findViewById(R.id.rvList);
        fabQuickAuth = findViewById(R.id.fabQuickAuth);
        btnRefresh = findViewById(R.id.btnRefresh);
        btnLogout = findViewById(R.id.btnLogout);

        layoutWebAdmin = findViewById(R.id.layoutWebAdmin);
        webViewAdmin = findViewById(R.id.webViewAdmin);
        pbWebLoading = findViewById(R.id.pbWebLoading);
        tvWebUrl = findViewById(R.id.tvWebUrl);
        btnWebRouter = findViewById(R.id.btnWebRouter);
        btnWebCloud = findViewById(R.id.btnWebCloud);
        btnWebReload = findViewById(R.id.btnWebReload);

        rvList.setLayoutManager(new LinearLayoutManager(this));
    }

    private void setupWebView() {
        WebSettings ws = webViewAdmin.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webViewAdmin.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pbWebLoading.setVisibility(View.VISIBLE);
                if (url != null) {
                    tvWebUrl.setText(url.replace("http://", "").replace("https://", ""));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pbWebLoading.setVisibility(View.GONE);
                if (url != null) {
                    tvWebUrl.setText(url.replace("http://", "").replace("https://", ""));
                }
            }
        });

        webViewAdmin.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                pbWebLoading.setProgress(newProgress);
                if (newProgress >= 100) {
                    pbWebLoading.setVisibility(View.GONE);
                }
            }
        });

        btnWebRouter.setOnClickListener(v -> loadRouterWeb());
        btnWebCloud.setOnClickListener(v -> loadCloudWeb());
        btnWebReload.setOnClickListener(v -> webViewAdmin.reload());
    }

    private void loadRouterWeb() {
        btnWebRouter.setBackgroundColor(0xFF38BDF8);
        btnWebRouter.setTextColor(0xFF090D16);
        btnWebCloud.setBackgroundColor(0xFF1E293B);
        btnWebCloud.setTextColor(0xFFF8FAFC);

        String routerUrl = "http://192.168.50.1:2080/hotspot.html";
        if (ApiClient.baseUrl.contains("192.168.") || ApiClient.baseUrl.contains(".local")) {
            routerUrl = ApiClient.baseUrl + "/hotspot.html";
        }
        webViewAdmin.loadUrl(routerUrl);
    }

    private void loadCloudWeb() {
        btnWebCloud.setBackgroundColor(0xFF38BDF8);
        btnWebCloud.setTextColor(0xFF090D16);
        btnWebRouter.setBackgroundColor(0xFF1E293B);
        btnWebRouter.setTextColor(0xFFF8FAFC);

        String cloudUrl = "https://titan-hotspot.titano.workers.dev/admin";
        if (!ApiClient.baseUrl.contains("192.168.") && !ApiClient.baseUrl.contains(".local")) {
            cloudUrl = ApiClient.baseUrl + "/admin";
        }
        webViewAdmin.loadUrl(cloudUrl);
    }

    private void setupAdapters() {
        clientAdapter = new ClientAdapter(new ClientAdapter.OnClientActionListener() {
            @Override
            public void onAuth(String mac, int minutes) {
                sendRemoteCommand("auth", mac, minutes);
            }

            @Override
            public void onKick(String mac) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("ডিভাইস ডিসকানেক্ট")
                        .setMessage("আপনি কি নিশ্চিতভাবে " + mac + " কে কিক করতে চান?")
                        .setPositiveButton("হ্যাঁ, কিক করুন", (d, w) -> sendRemoteCommand("deauth", mac, 0))
                        .setNegativeButton("বাতিল", null)
                        .show();
            }

            @Override
            public void onSpeed(String mac) {
                showSpeedDialog(mac);
            }

            @Override
            public void onRename(String mac, String currentName) {
                showRenameDialog(mac, currentName);
            }
        });

        invoiceAdapter = new InvoiceAdapter(mac -> showQuickAuthDialog(mac));
        rvList.setAdapter(clientAdapter);
    }

    private void setupListeners() {
        btnQuickVoucher.setOnClickListener(v -> showVoucherDialog());
        btnQuickVip.setOnClickListener(v -> showVipDialog());
        btnQuickSpeed.setOnClickListener(v -> showSpeedDialog(""));
        btnQuickService.setOnClickListener(v -> showServiceDialog());

        btnTabClients.setOnClickListener(v -> {
            isWebTab = false;
            isClientsTab = true;
            btnTabClients.setBackgroundColor(0xFF38BDF8);
            btnTabClients.setTextColor(0xFF090D16);
            btnTabInvoices.setBackgroundColor(0xFF1E293B);
            btnTabInvoices.setTextColor(0xFFF8FAFC);
            btnTabWebAdmin.setBackgroundColor(0xFF1E293B);
            btnTabWebAdmin.setTextColor(0xFFF8FAFC);

            layoutWebAdmin.setVisibility(View.GONE);
            swipeRefresh.setVisibility(View.VISIBLE);
            fabQuickAuth.setVisibility(View.VISIBLE);
            rvList.setAdapter(clientAdapter);
            updateEmptyView();
        });

        btnTabInvoices.setOnClickListener(v -> {
            isWebTab = false;
            isClientsTab = false;
            btnTabInvoices.setBackgroundColor(0xFF38BDF8);
            btnTabInvoices.setTextColor(0xFF090D16);
            btnTabClients.setBackgroundColor(0xFF1E293B);
            btnTabClients.setTextColor(0xFFF8FAFC);
            btnTabWebAdmin.setBackgroundColor(0xFF1E293B);
            btnTabWebAdmin.setTextColor(0xFFF8FAFC);

            layoutWebAdmin.setVisibility(View.GONE);
            swipeRefresh.setVisibility(View.VISIBLE);
            fabQuickAuth.setVisibility(View.VISIBLE);
            rvList.setAdapter(invoiceAdapter);
            updateEmptyView();
        });

        btnTabWebAdmin.setOnClickListener(v -> {
            isWebTab = true;
            btnTabWebAdmin.setBackgroundColor(0xFF38BDF8);
            btnTabWebAdmin.setTextColor(0xFF090D16);
            btnTabClients.setBackgroundColor(0xFF1E293B);
            btnTabClients.setTextColor(0xFFF8FAFC);
            btnTabInvoices.setBackgroundColor(0xFF1E293B);
            btnTabInvoices.setTextColor(0xFFF8FAFC);

            swipeRefresh.setVisibility(View.GONE);
            tvEmpty.setVisibility(View.GONE);
            fabQuickAuth.setVisibility(View.GONE);
            layoutWebAdmin.setVisibility(View.VISIBLE);

            if (webViewAdmin.getUrl() == null || webViewAdmin.getUrl().isEmpty()) {
                loadRouterWeb();
            }
        });

        swipeRefresh.setOnRefreshListener(this::loadData);
        btnRefresh.setOnClickListener(v -> {
            if (isWebTab) {
                webViewAdmin.reload();
            } else {
                loadData();
            }
        });

        btnLogout.setOnClickListener(v -> {
            new AlertDialog.Builder(this)
                    .setTitle("লগআউট")
                    .setMessage("আপনি কি অ্যাডমিন প্যানেল থেকে লগআউট করতে চান?")
                    .setPositiveButton("লগআউট", (d, w) -> {
                        getSharedPreferences("titan_admin_prefs", MODE_PRIVATE).edit().clear().apply();
                        startActivity(new Intent(this, LoginActivity.class));
                        finish();
                    })
                    .setNegativeButton("না", null)
                    .show();
        });

        fabQuickAuth.setOnClickListener(v -> showQuickAuthDialog(""));
    }

    private void loadData() {
        swipeRefresh.setRefreshing(true);
        ApiClient.fetchDashboard(adminToken, new ApiClient.ApiCallback<Models.DashboardResponse>() {
            @Override
            public void onSuccess(Models.DashboardResponse result) {
                swipeRefresh.setRefreshing(false);
                lastResponse = result;
                bindDashboard(result);
            }

            @Override
            public void onError(String error) {
                swipeRefresh.setRefreshing(false);
                Toast.makeText(MainActivity.this, error, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void bindDashboard(Models.DashboardResponse res) {
        tvStatRevenue.setText("৳" + res.stats.revenue);
        tvStatVouchers.setText(String.valueOf(res.stats.completed_invoices));

        int activeOnline = 0;
        for (Models.ClientInfo c : res.clients) {
            if ("authenticated".equalsIgnoreCase(c.state)) activeOnline++;
        }
        tvStatActive.setText(String.valueOf(activeOnline));

        if (res.stats.router_online) {
            tvRouterStatus.setText("🟢 রাউটার অনলাইন | Up: " + res.stats.router_uptime);
            tvRouterStatus.setTextColor(0xFF10B981);
        } else {
            tvRouterStatus.setText("🔴 রাউটার অফলাইন");
            tvRouterStatus.setTextColor(0xFFEF4444);
        }

        clientAdapter.updateList(res.clients);
        invoiceAdapter.updateList(res.invoices);
        updateEmptyView();
    }

    private void updateEmptyView() {
        if (lastResponse == null) {
            tvEmpty.setVisibility(View.GONE);
            return;
        }
        if (isClientsTab) {
            tvEmpty.setVisibility(lastResponse.clients.isEmpty() ? View.VISIBLE : View.GONE);
            tvEmpty.setText("কোনো ওয়াইফাই ডিভাইস কানেক্টেড নেই");
        } else {
            tvEmpty.setVisibility(lastResponse.invoices.isEmpty() ? View.VISIBLE : View.GONE);
            tvEmpty.setText("কোনো ইনভয়েস পাওয়া যায়নি");
        }
    }

    private void sendRemoteCommand(String action, String mac, int minutes) {
        sendRemoteCommand(action, mac, minutes, 0, 0);
    }

    private void sendRemoteCommand(String action, String mac, int minutes, int downRate, int upRate) {
        Toast.makeText(this, "কমান্ড পাঠানো হচ্ছে...", Toast.LENGTH_SHORT).show();
        ApiClient.sendCommand(adminToken, action, mac, minutes, downRate, upRate, new ApiClient.ApiCallback<String>() {
            @Override
            public void onSuccess(String result) {
                Toast.makeText(MainActivity.this, result, Toast.LENGTH_SHORT).show();
                loadData();
            }

            @Override
            public void onError(String error) {
                Toast.makeText(MainActivity.this, "ব্যর্থ: " + error, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void showVoucherDialog() {
        String[] packages = {"২ ঘণ্টা (৳১০)", "১ দিন (৳২৫)", "৭ দিন (৳৫০)", "৩০ দিন (৳১৫০)", "৩ মিনিটের ট্রায়াল"};
        int[] minutes = {120, 1440, 10080, 43200, 3};
        final int[] selectedIndex = {0};

        new AlertDialog.Builder(this)
                .setTitle("🎫 নতুন ভাউচার তৈরি করুন")
                .setSingleChoiceItems(packages, 0, (d, which) -> selectedIndex[0] = which)
                .setPositiveButton("জেনারেট করুন", (d, which) -> {
                    int chosenMins = minutes[selectedIndex[0]];
                    Toast.makeText(this, "ভাউচার তৈরি করা হচ্ছে...", Toast.LENGTH_SHORT).show();
                    ApiClient.sendCommand(adminToken, "generate_vouchers", "", chosenMins, 5120, 2048, new ApiClient.ApiCallback<String>() {
                        @Override
                        public void onSuccess(String result) {
                            new AlertDialog.Builder(MainActivity.this)
                                    .setTitle("ভাউচার সফল!")
                                    .setMessage(result + "\n\nগ্রাহক ভাউচার কোড দিয়ে হটস্পটে লগইন করতে পারবে।")
                                    .setPositiveButton("ঠিক আছে", null)
                                    .show();
                            loadData();
                        }

                        @Override
                        public void onError(String error) {
                            Toast.makeText(MainActivity.this, "ব্যর্থ: " + error, Toast.LENGTH_LONG).show();
                        }
                    });
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void showSpeedDialog(String defaultMac) {
        android.widget.EditText etMacInput = new android.widget.EditText(this);
        etMacInput.setHint("ডিভাইস MAC এড্রেস");
        etMacInput.setText(defaultMac != null ? defaultMac : "");
        etMacInput.setTextColor(0xFFF8FAFC);
        etMacInput.setHintTextColor(0xFF64748B);
        etMacInput.setPadding(40, 30, 40, 30);

        String[] speedOptions = {"🚀 নো লিমিট (ফুল স্পিড)", "⚡ 10 Mbps (Fast)", "⚡ 5 Mbps (Standard)", "⚡ 2 Mbps (Basic)", "⚡ 1 Mbps (Saver)"};
        int[] downRates = {0, 10240, 5120, 2048, 1024};
        int[] upRates = {0, 5120, 2048, 1024, 512};
        final int[] selectedSpeed = {2};

        android.widget.LinearLayout container = new android.widget.LinearLayout(this);
        container.setOrientation(android.widget.LinearLayout.VERTICAL);
        container.setPadding(40, 10, 40, 10);
        container.addView(etMacInput);

        new AlertDialog.Builder(this)
                .setTitle("⚡ স্পিড লিমিট নির্ধারণ করুন")
                .setView(container)
                .setSingleChoiceItems(speedOptions, 2, (dialog, which) -> selectedSpeed[0] = which)
                .setPositiveButton("স্পিড সেট করুন", (dialog, which) -> {
                    String mac = etMacInput.getText().toString().trim();
                    if (mac.isEmpty()) {
                        Toast.makeText(this, "সঠিক MAC এড্রেস দিন", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    int down = downRates[selectedSpeed[0]];
                    int up = upRates[selectedSpeed[0]];
                    sendRemoteCommand("set_bandwidth", mac, 0, down, up);
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void showVipDialog() {
        android.widget.EditText input = new android.widget.EditText(this);
        input.setHint("e.g. fe:0a:e4:5a:a5:45");
        input.setTextColor(0xFFF8FAFC);
        input.setHintTextColor(0xFF64748B);
        input.setPadding(40, 30, 40, 30);

        new AlertDialog.Builder(this)
                .setTitle("⭐ ভিআইপি এক্সেস দিন")
                .setMessage("কোনো ভাউচার বা লগইন ছাড়া ১ মাস ফুল স্পিড ইন্টারনেট সক্রিয় থাকবে।")
                .setView(input)
                .setPositiveButton("ভিআইপি করুন", (d, w) -> {
                    String mac = input.getText().toString().trim();
                    if (!mac.isEmpty()) {
                        sendRemoteCommand("auth", mac, 43200);
                    }
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void showServiceDialog() {
        String[] services = {"🔄 OpenNDS পোর্টাল রিস্টার্ট", "🧹 পুরাতন ভাউচার ডাটাবেজ ক্লিন", "⚙️ হটস্পট ব্যাকএন্ড রিস্টার্ট"};
        new AlertDialog.Builder(this)
                .setTitle("🛠️ রাউটার সার্ভিস ও ডেমন কন্ট্রোল")
                .setItems(services, (dialog, which) -> {
                    if (which == 0) {
                        sendRemoteCommand("restart_nds", "", 0);
                    } else if (which == 1) {
                        sendRemoteCommand("clear_used_vouchers", "", 0);
                    } else if (which == 2) {
                        sendRemoteCommand("restart_daemon", "", 0);
                    }
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void showRenameDialog(String mac, String currentName) {
        android.widget.EditText input = new android.widget.EditText(this);
        input.setText(currentName != null ? currentName : "");
        input.setHint("ডিভাইসের নাম (যেমন: রহিমের ফোন)");
        input.setTextColor(0xFFF8FAFC);
        input.setHintTextColor(0xFF64748B);
        input.setPadding(40, 30, 40, 30);

        new AlertDialog.Builder(this)
                .setTitle("✏️ ডিভাইসের নাম পরিবর্তন")
                .setMessage("MAC: " + mac)
                .setView(input)
                .setPositiveButton("সংরক্ষণ", (d, w) -> {
                    String newName = input.getText().toString().trim();
                    if (!newName.isEmpty()) {
                        ApiClient.sendCommandWithExtras(adminToken, "set_device_name", mac, 0, 0, 0, newName, new ApiClient.ApiCallback<String>() {
                            @Override
                            public void onSuccess(String result) {
                                Toast.makeText(MainActivity.this, result, Toast.LENGTH_SHORT).show();
                                loadData();
                            }

                            @Override
                            public void onError(String error) {
                                Toast.makeText(MainActivity.this, "ব্যর্থ: " + error, Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void showQuickAuthDialog(String defaultMac) {
        View dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_quick_auth, null);
        TextInputEditText etMac = dialogView.findViewById(R.id.etDialogMac);
        TextInputEditText etMins = dialogView.findViewById(R.id.etDialogMinutes);

        if (defaultMac != null && !defaultMac.isEmpty()) {
            etMac.setText(defaultMac);
        }

        dialogView.findViewById(R.id.btnPreset2h).setOnClickListener(v -> etMins.setText("120"));
        dialogView.findViewById(R.id.btnPreset1d).setOnClickListener(v -> etMins.setText("1440"));
        dialogView.findViewById(R.id.btnPreset7d).setOnClickListener(v -> etMins.setText("10080"));

        new AlertDialog.Builder(this)
                .setView(dialogView)
                .setPositiveButton("অনুমোদন দিন", (dialog, which) -> {
                    String mac = etMac.getText() != null ? etMac.getText().toString().trim() : "";
                    String minsStr = etMins.getText() != null ? etMins.getText().toString().trim() : "120";
                    if (mac.isEmpty()) {
                        Toast.makeText(this, "সঠিক MAC এড্রেস দিন", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    int minutes = 120;
                    try { minutes = Integer.parseInt(minsStr); } catch (Exception ignored) {}
                    sendRemoteCommand("auth", mac, minutes);
                })
                .setNegativeButton("বাতিল", null)
                .show();
    }

    private void setupAutoSync() {
        autoSyncRunnable = new Runnable() {
            @Override
            public void run() {
                loadData();
                autoSyncHandler.postDelayed(this, 12000);
            }
        };
        autoSyncHandler.postDelayed(autoSyncRunnable, 12000);
    }

    @Override
    public void onBackPressed() {
        if (isWebTab && webViewAdmin != null && webViewAdmin.canGoBack()) {
            webViewAdmin.goBack();
        } else if (isWebTab) {
            btnTabClients.performClick();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (autoSyncRunnable != null) {
            autoSyncHandler.removeCallbacks(autoSyncRunnable);
        }
    }
}
