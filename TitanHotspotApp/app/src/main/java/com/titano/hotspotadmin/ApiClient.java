package com.titano.hotspotadmin;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class ApiClient {

    public static String baseUrl = "https://titan-hotspot.titano.workers.dev";

    public static void setBaseUrl(String url) {
        if (url != null && !url.trim().isEmpty()) {
            String u = url.trim();
            if (!u.startsWith("http://") && !u.startsWith("https://")) {
                if (u.startsWith("192.168.") || u.startsWith("10.") || u.startsWith("172.")) {
                    u = "http://" + u;
                } else {
                    u = "https://" + u;
                }
            }
            if (u.endsWith("/")) {
                u = u.substring(0, u.length() - 1);
            }
            baseUrl = u;
        }
    }

    private static final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .build();

    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    public interface ApiCallback<T> {
        void onSuccess(T result);
        void onError(String error);
    }

    public static void fetchDashboard(String token, ApiCallback<Models.DashboardResponse> callback) {
        boolean isLocal = baseUrl.contains("192.168.") || baseUrl.contains(".local");
        String targetUrl = isLocal ? (baseUrl + "/cgi-bin/hotspot-api") : (baseUrl + "/api/admin/dashboard");

        Request.Builder reqBuilder = new Request.Builder().url(targetUrl).get();
        if (!isLocal && token != null && !token.isEmpty()) {
            reqBuilder.header("Authorization", "Bearer " + token);
        }

        client.newCall(reqBuilder.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> callback.onError("সার্ভারে সংযোগ করা যাচ্ছে না: " + e.getMessage()));
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.code() == 401) {
                    mainHandler.post(() -> callback.onError("অননুমোদিত পিন বা সিক্রেট"));
                    return;
                }
                if (!response.isSuccessful()) {
                    mainHandler.post(() -> callback.onError("সার্ভার ত্রুটি: " + response.code()));
                    return;
                }

                try {
                    String bodyStr = response.body().string();
                    JSONObject json = new JSONObject(bodyStr);
                    Models.DashboardResponse res = new Models.DashboardResponse();
                    res.success = json.optBoolean("success", true);

                    if (json.has("stats")) {
                        JSONObject s = json.getJSONObject("stats");
                        res.stats.revenue = s.optInt("revenue", 0);
                        res.stats.completed_invoices = s.optInt("completed_invoices", 0);
                        res.stats.router_online = s.optBoolean("router_online", false);
                        res.stats.router_uptime = s.optString("router_uptime", "--");
                        res.stats.router_load = s.optString("router_load", "--");
                        res.stats.last_heartbeat = s.optString("last_heartbeat", "");
                    } else if (isLocal || json.has("uptime")) {
                        res.stats.router_online = json.optBoolean("daemon_running", true);
                        res.stats.router_uptime = json.optString("uptime", "--");
                        res.stats.router_load = json.optString("load", "--");
                    }

                    JSONObject dhcpMap = json.optJSONObject("dhcp_map");

                    if (json.has("nds_clients")) {
                        JSONObject nds = json.optJSONObject("nds_clients");
                        if (nds != null && nds.has("clients")) {
                            JSONObject clientsObj = nds.getJSONObject("clients");
                            Iterator<String> keys = clientsObj.keys();
                            while (keys.hasNext()) {
                                String mac = keys.next();
                                JSONObject cObj = clientsObj.getJSONObject(mac);
                                Models.ClientInfo ci = new Models.ClientInfo();
                                ci.mac = cObj.optString("mac", mac);
                                ci.ip = cObj.optString("ip", "");
                                ci.state = cObj.optString("state", "");
                                ci.download_bytes = cObj.optLong("download_this_session", 0);
                                ci.upload_bytes = cObj.optLong("upload_this_session", 0);
                                ci.down_rate_limit = cObj.optString("download_rate_limit_threshold", "");
                                ci.up_rate_limit = cObj.optString("upload_rate_limit_threshold", "");

                                if (dhcpMap != null) {
                                    JSONObject dInfo = dhcpMap.optJSONObject(mac.toLowerCase());
                                    if (dInfo != null) {
                                        ci.name = dInfo.optString("hostname", "");
                                    }
                                }
                                if (ci.name == null || ci.name.isEmpty()) {
                                    ci.name = "authenticated".equalsIgnoreCase(ci.state) ? "স্মার্টফোন / ডিভাইস" : "নতুন সংযোগ";
                                }
                                res.clients.add(ci);
                            }
                        }
                    }

                    if (json.has("wifi_stations")) {
                        JSONArray stList = json.optJSONArray("wifi_stations");
                        if (stList != null) {
                            for (int i = 0; i < stList.length(); i++) {
                                JSONObject st = stList.optJSONObject(i);
                                if (st != null) {
                                    String smac = st.optString("mac", "").toLowerCase();
                                    boolean alreadyExists = false;
                                    for (Models.ClientInfo existing : res.clients) {
                                        if (existing.mac.equalsIgnoreCase(smac)) {
                                            alreadyExists = true;
                                            break;
                                        }
                                    }
                                    if (!alreadyExists && !smac.isEmpty()) {
                                        Models.ClientInfo ci = new Models.ClientInfo();
                                        ci.mac = smac;
                                        ci.state = "Preauthenticated";
                                        if (dhcpMap != null) {
                                            JSONObject dInfo = dhcpMap.optJSONObject(smac);
                                            if (dInfo != null) {
                                                ci.ip = dInfo.optString("ip", "");
                                                ci.name = dInfo.optString("hostname", "");
                                            }
                                        }
                                        if (ci.name == null || ci.name.isEmpty()) {
                                            ci.name = "নতুন সংযোগ (Wi-Fi)";
                                        }
                                        res.clients.add(ci);
                                    }
                                }
                            }
                        }
                    }

                    if (json.has("invoices")) {
                        JSONArray invs = json.optJSONArray("invoices");
                        if (invs != null) {
                            for (int i = 0; i < invs.length(); i++) {
                                JSONObject io = invs.getJSONObject(i);
                                Models.InvoiceInfo inv = new Models.InvoiceInfo();
                                inv.id = io.optString("id", "");
                                inv.trx_id = io.optString("trx_id", "");
                                inv.customer_phone = io.optString("customer_phone", "");
                                inv.client_mac = io.optString("client_mac", "");
                                inv.amount = io.optInt("amount", 0);
                                inv.provider = io.optString("provider", "bkash");
                                inv.status = io.optString("status", "");
                                inv.duration_minutes = io.optInt("duration_minutes", 120);
                                inv.used_seconds = io.optInt("used_seconds", 0);
                                inv.is_connected = io.optInt("is_connected", 0);
                                res.invoices.add(inv);
                            }
                        }
                    }

                    mainHandler.post(() -> callback.onSuccess(res));
                } catch (Exception e) {
                    mainHandler.post(() -> callback.onError("ডাটা পার্সিং ত্রুটি: " + e.getMessage()));
                }
            }
        });
    }

    public static void sendCommand(String token, String action, String mac, int minutes, ApiCallback<String> callback) {
        sendCommand(token, action, mac, minutes, 0, 0, callback);
    }

    public static void sendCommand(String token, String action, String mac, int minutes, int downRate, int upRate, ApiCallback<String> callback) {
        try {
            boolean isLocal = baseUrl.contains("192.168.") || baseUrl.contains(".local");
            String targetUrl = isLocal ? (baseUrl + "/cgi-bin/hotspot-api") : (baseUrl + "/api/admin/command");

            JSONObject body = new JSONObject();
            body.put("action", action);
            body.put("mac", mac != null ? mac.trim() : "");
            body.put("minutes", minutes);
            body.put("download_rate", downRate);
            body.put("upload_rate", upRate);

            Request.Builder reqBuilder = new Request.Builder()
                    .url(targetUrl)
                    .post(RequestBody.create(body.toString(), JSON));

            if (!isLocal && token != null && !token.isEmpty()) {
                reqBuilder.header("Authorization", "Bearer " + token);
            }

            client.newCall(reqBuilder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    mainHandler.post(() -> callback.onError("কমান্ড পাঠানো ব্যর্থ: " + e.getMessage()));
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    try {
                        String bodyStr = response.body().string();
                        JSONObject res = new JSONObject(bodyStr);
                        if (res.optBoolean("success", false)) {
                            String msg = res.optString("message", "কমান্ড সফলভাবে কার্যকর হয়েছে");
                            mainHandler.post(() -> callback.onSuccess(msg));
                        } else {
                            String err = res.optString("error", res.optString("message", "ব্যর্থ হয়েছে"));
                            mainHandler.post(() -> callback.onError(err));
                        }
                    } catch (Exception e) {
                        mainHandler.post(() -> callback.onError("ত্রুটি: " + e.getMessage()));
                    }
                }
            });
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
}
