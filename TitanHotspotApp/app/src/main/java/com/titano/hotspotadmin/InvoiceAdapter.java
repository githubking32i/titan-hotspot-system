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

public class InvoiceAdapter extends RecyclerView.Adapter<InvoiceAdapter.ViewHolder> {

    public interface OnInvoiceActionListener {
        void onGrantPass(String mac);
    }

    private List<Models.InvoiceInfo> list = new ArrayList<>();
    private final OnInvoiceActionListener listener;

    public InvoiceAdapter(OnInvoiceActionListener listener) {
        this.listener = listener;
    }

    public void updateList(List<Models.InvoiceInfo> newList) {
        this.list = newList != null ? newList : new ArrayList<>();
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_invoice, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder h, int position) {
        Models.InvoiceInfo item = list.get(position);
        h.tvInvoiceId.setText(item.id);
        h.tvTrxId.setText("TrxID: " + (item.trx_id.isEmpty() ? "N/A" : item.trx_id));
        h.tvAmount.setText("৳" + item.amount + " (" + item.provider.toUpperCase() + ")");

        h.tvCustomer.setText("📱 " + (item.customer_phone.isEmpty() ? "অজানা গ্রাহক" : item.customer_phone));
        h.tvMacInfo.setText("MAC: " + (item.client_mac.isEmpty() ? "N/A" : item.client_mac));

        h.tvRemainingTime.setText(item.getRemainingFormatted());

        if (item.is_connected == 1) {
            h.tvConnectionState.setText("🟢 লাইভ ব্যবহার হচ্ছে");
            h.tvConnectionState.setTextColor(0xFF10B981);
        } else if ("completed".equalsIgnoreCase(item.status)) {
            h.tvConnectionState.setText("⏸️ সময় স্থগিত (Paused)");
            h.tvConnectionState.setTextColor(0xFFF59E0B);
        } else {
            h.tvConnectionState.setText("🔴 " + item.status);
            h.tvConnectionState.setTextColor(0xFFEF4444);
        }

        if (item.client_mac.isEmpty()) {
            h.btnQuickGrant.setVisibility(View.GONE);
        } else {
            h.btnQuickGrant.setVisibility(View.VISIBLE);
            h.btnQuickGrant.setOnClickListener(v -> {
                if (listener != null) listener.onGrantPass(item.client_mac);
            });
        }
    }

    @Override
    public int getItemCount() {
        return list.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView tvInvoiceId, tvTrxId, tvAmount, tvCustomer, tvMacInfo, tvRemainingTime, tvConnectionState;
        MaterialButton btnQuickGrant;

        public ViewHolder(@NonNull View v) {
            super(v);
            tvInvoiceId = v.findViewById(R.id.tvInvoiceId);
            tvTrxId = v.findViewById(R.id.tvTrxId);
            tvAmount = v.findViewById(R.id.tvAmount);
            tvCustomer = v.findViewById(R.id.tvCustomer);
            tvMacInfo = v.findViewById(R.id.tvMacInfo);
            tvRemainingTime = v.findViewById(R.id.tvRemainingTime);
            tvConnectionState = v.findViewById(R.id.tvConnectionState);
            btnQuickGrant = v.findViewById(R.id.btnQuickGrant);
        }
    }
}
