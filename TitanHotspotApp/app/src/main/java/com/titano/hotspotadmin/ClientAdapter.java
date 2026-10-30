package com.titano.hotspotadmin;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.google.android.material.button.MaterialButton;

import java.util.ArrayList;
import java.util.List;

public class ClientAdapter extends RecyclerView.Adapter<ClientAdapter.ViewHolder> {

    public interface OnClientActionListener {
        void onAuth(String mac, int minutes);
        void onKick(String mac);
        void onSpeed(String mac);
        void onRename(String mac, String currentName);
    }

    private List<Models.ClientInfo> list = new ArrayList<>();
    private final OnClientActionListener listener;

    public ClientAdapter(OnClientActionListener listener) {
        this.listener = listener;
    }

    public void updateList(List<Models.ClientInfo> newList) {
        this.list = newList != null ? newList : new ArrayList<>();
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_client, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder h, int position) {
        Models.ClientInfo item = list.get(position);
        String dName = (item.name != null && !item.name.isEmpty()) ? item.name : "স্মার্টফোন / ডিভাইস";
        h.tvDeviceName.setText(dName);
        h.tvMac.setText(item.mac);
        h.tvIp.setText("IP: " + (item.ip.isEmpty() ? "--" : item.ip));

        boolean isAuth = "authenticated".equalsIgnoreCase(item.state);
        if (isAuth) {
            h.tvStatusBadge.setText("🟢 অনুমোদিত • " + item.getSpeedFormatted());
            h.tvStatusBadge.setTextColor(0xFF10B981);
            h.tvStatusBadge.setBackgroundColor(0xFF163A29);
        } else {
            h.tvStatusBadge.setText("🟡 ক্যাপটিভ পেজে");
            h.tvStatusBadge.setTextColor(0xFFF59E0B);
            h.tvStatusBadge.setBackgroundColor(0xFF382A13);
        }

        h.tvTraffic.setText(item.getTrafficFormatted());

        h.btnAuth2h.setOnClickListener(v -> {
            if (listener != null) listener.onAuth(item.mac, 120);
        });

        h.btnSpeed.setOnClickListener(v -> {
            if (listener != null) listener.onSpeed(item.mac);
        });

        h.btnRename.setOnClickListener(v -> {
            if (listener != null) listener.onRename(item.mac, item.name);
        });

        h.btnKick.setOnClickListener(v -> {
            if (listener != null) listener.onKick(item.mac);
        });
    }

    @Override
    public int getItemCount() {
        return list.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvDeviceName, tvMac, tvIp, tvStatusBadge, tvTraffic;
        MaterialButton btnAuth2h, btnKick, btnSpeed, btnRename;

        public ViewHolder(@NonNull View v) {
            super(v);
            tvDeviceName = v.findViewById(R.id.tvDeviceName);
            tvMac = v.findViewById(R.id.tvMac);
            tvIp = v.findViewById(R.id.tvIp);
            tvStatusBadge = v.findViewById(R.id.tvStatusBadge);
            tvTraffic = v.findViewById(R.id.tvTraffic);
            btnAuth2h = v.findViewById(R.id.btnAuth2h);
            btnKick = v.findViewById(R.id.btnKick);
            btnSpeed = v.findViewById(R.id.btnSpeed);
            btnRename = v.findViewById(R.id.btnRename);
        }
    }
}
