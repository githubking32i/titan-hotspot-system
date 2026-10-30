package com.titano.hotspotadmin;

import java.util.ArrayList;
import java.util.List;

public class Models {

    public static class Stats {
        public int revenue = 0;
        public int completed_invoices = 0;
        public boolean router_online = false;
        public String router_uptime = "--";
        public String router_load = "--";
        public String last_heartbeat = "";
    }

    public static class ClientInfo {
        public String name = "";
        public String mac = "";
        public String ip = "";
        public String state = "";
        public long download_bytes = 0;
        public long upload_bytes = 0;
        public String down_rate_limit = "";
        public String up_rate_limit = "";

        public String getSpeedFormatted() {
            if (down_rate_limit == null || down_rate_limit.isEmpty() || "null".equals(down_rate_limit) || "0".equals(down_rate_limit)) {
                return "🚀 ফুল স্পিড";
            }
            try {
                int kb = Integer.parseInt(down_rate_limit);
                double mb = kb / 1024.0;
                return String.format("⚡ %.0f Mbps", mb);
            } catch(Exception e) {
                return "⚡ " + down_rate_limit + "k";
            }
        }

        public String getTrafficFormatted() {
            return "⬇️ " + formatBytes(download_bytes) + "  •  ⬆️ " + formatBytes(upload_bytes);
        }

        private String formatBytes(long bytes) {
            if (bytes <= 0) return "0 KB";
            double kb = bytes / 1024.0;
            double mb = kb / 1024.0;
            double gb = mb / 1024.0;
            if (gb >= 1.0) return String.format("%.2f GB", gb);
            if (mb >= 1.0) return String.format("%.2f MB", mb);
            return String.format("%.0f KB", kb);
        }
    }

    public static class InvoiceInfo {
        public String id = "";
        public String trx_id = "";
        public String customer_phone = "";
        public String client_mac = "";
        public int amount = 0;
        public String provider = "bkash";
        public String status = "";
        public int duration_minutes = 120;
        public int used_seconds = 0;
        public int is_connected = 0;

        public String getRemainingFormatted() {
            long totalSecs = duration_minutes * 60L;
            long remSecs = Math.max(0, totalSecs - used_seconds);
            if (remSecs <= 0) return "⌛ মেয়াদ শেষ";
            long days = remSecs / 86400;
            long hours = (remSecs % 86400) / 3600;
            long mins = (remSecs % 3600) / 60;
            StringBuilder sb = new StringBuilder();
            if (days > 0) sb.append(days).append("দিন ");
            if (hours > 0) sb.append(hours).append("ঘণ্টা ");
            sb.append(mins).append("মি");
            return sb.toString().trim();
        }
    }

    public static class DashboardResponse {
        public boolean success = false;
        public Stats stats = new Stats();
        public List<ClientInfo> clients = new ArrayList<>();
        public List<InvoiceInfo> invoices = new ArrayList<>();
    }
}
