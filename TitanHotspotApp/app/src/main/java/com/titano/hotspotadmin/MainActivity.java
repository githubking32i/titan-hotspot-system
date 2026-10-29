package com.titano.hotspotadmin;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ImageButton;
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
    private MaterialButton btnTabClients, btnTabInvoices;
    private SwipeRefreshLayout swipeRefresh;
    private RecyclerView rvList;
    private ExtendedFloatingActionButton fabQuickAuth;
    private ImageButton btnRefresh, btnLogout;

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
        swipeRefresh = findViewById(R.id.swipeRefresh);
        rvList = findViewById(R.id.rvList);
        fabQuickAuth = findViewById(R.id.fabQuickAuth);
        btnRefresh = findViewById(R.id.btnRefresh);
        btnLogout = findViewById(R.id.btnLogout);

        rvList.setLayoutManager(new LinearLayoutManager(this));
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
        });

        invoiceAdapter = new InvoiceAdapter(mac -> showQuickAuthDialog(mac));
        rvList.setAdapter(clientAdapter);
    }

    private void setupListeners() {
        btnTabClients.setOnClickListener(v -> {
            isClientsTab = true;
            btnTabClients.setBackgroundColor(0xFF38BDF8);
            btnTabClients.setTextColor(0xFF090D16);
            btnTabInvoices.setBackgroundColor(0xFF1E293B);
            btnTabInvoices.setTextColor(0xFFF8FAFC);
            rvList.setAdapter(clientAdapter);
            updateEmptyView();
        });

        btnTabInvoices.setOnClickListener(v -> {
            isClientsTab = false;
            btnTabInvoices.setBackgroundColor(0xFF38BDF8);
            btnTabInvoices.setTextColor(0xFF090D16);
            btnTabClients.setBackgroundColor(0xFF1E293B);
            btnTabClients.setTextColor(0xFFF8FAFC);
            rvList.setAdapter(invoiceAdapter);
            updateEmptyView();
        });

        swipeRefresh.setOnRefreshListener(this::loadData);
        btnRefresh.setOnClickListener(v -> loadData());

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
    protected void onDestroy() {
        super.onDestroy();
        if (autoSyncRunnable != null) {
            autoSyncHandler.removeCallbacks(autoSyncRunnable);
        }
    }
}
