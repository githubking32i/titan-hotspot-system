package com.titano.hotspotadmin;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.checkbox.MaterialCheckBox;
import com.google.android.material.textfield.TextInputEditText;

public class LoginActivity extends AppCompatActivity {

    private TextInputEditText etPin;
    private TextInputEditText etServerUrl;
    private MaterialCheckBox cbRemember;
    private MaterialButton btnLogin;
    private ProgressBar pbLoading;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        prefs = getSharedPreferences("titan_admin_prefs", MODE_PRIVATE);
        String savedToken = prefs.getString("admin_token", "");
        String savedUrl = prefs.getString("server_url", "https://titan-hotspot.titano.workers.dev");
        boolean remember = prefs.getBoolean("remember", true);

        etPin = findViewById(R.id.etPin);
        etServerUrl = findViewById(R.id.etServerUrl);
        cbRemember = findViewById(R.id.cbRemember);
        btnLogin = findViewById(R.id.btnLogin);
        pbLoading = findViewById(R.id.pbLoading);

        cbRemember.setChecked(remember);
        if (savedUrl != null && !savedUrl.isEmpty()) {
            etServerUrl.setText(savedUrl);
            ApiClient.setBaseUrl(savedUrl);
        }

        if (remember && !savedToken.isEmpty()) {
            etPin.setText(savedToken);
            verifyAndEnter(savedToken);
        }

        btnLogin.setOnClickListener(v -> {
            String url = etServerUrl.getText() != null ? etServerUrl.getText().toString().trim() : "";
            String pin = etPin.getText() != null ? etPin.getText().toString().trim() : "";
            if (pin.isEmpty()) {
                Toast.makeText(this, "অনুগ্রহ করে পিন লিখুন", Toast.LENGTH_SHORT).show();
                return;
            }
            if (!url.isEmpty()) {
                ApiClient.setBaseUrl(url);
            }
            verifyAndEnter(pin);
        });
    }

    private void verifyAndEnter(String token) {
        btnLogin.setEnabled(false);
        pbLoading.setVisibility(View.VISIBLE);

        String currentUrl = etServerUrl.getText() != null ? etServerUrl.getText().toString().trim() : "";
        ApiClient.setBaseUrl(currentUrl);

        ApiClient.fetchDashboard(token, new ApiClient.ApiCallback<Models.DashboardResponse>() {
            @Override
            public void onSuccess(Models.DashboardResponse result) {
                btnLogin.setEnabled(true);
                pbLoading.setVisibility(View.GONE);

                if (cbRemember.isChecked()) {
                    prefs.edit()
                            .putString("admin_token", token)
                            .putString("server_url", currentUrl)
                            .putBoolean("remember", true)
                            .apply();
                } else {
                    prefs.edit().clear().apply();
                }

                Intent intent = new Intent(LoginActivity.this, MainActivity.class);
                intent.putExtra("token", token);
                startActivity(intent);
                finish();
            }

            @Override
            public void onError(String error) {
                btnLogin.setEnabled(true);
                pbLoading.setVisibility(View.GONE);
                Toast.makeText(LoginActivity.this, "লগইন ব্যর্থ: " + error, Toast.LENGTH_LONG).show();
            }
        });
    }
}
