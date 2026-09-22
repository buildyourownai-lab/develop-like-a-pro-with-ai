package com.everyoneisdeveloper.stockbriefing;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PRIMARY = Color.rgb(28, 72, 184);
    private static final int DARK = Color.rgb(16, 25, 43);
    private static final int MUTED = Color.rgb(95, 107, 128);
    private static final int SURFACE = Color.rgb(244, 246, 250);
    private static final int BORDER = Color.rgb(227, 232, 240);
    private static final int CONTROL = Color.rgb(238, 242, 253);
    private static final int UP = Color.rgb(198, 40, 40);
    private static final int DOWN = Color.rgb(18, 86, 196);

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private LinearLayout content;
    private ProgressBar progress;
    private TextView status;
    private EditText searchInput;
    private String selectedCode;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(SURFACE);
        getWindow().setNavigationBarColor(SURFACE);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(buildScreen());
        loadMarket();
    }

    @Override
    protected void onDestroy() {
        network.shutdownNow();
        super.onDestroy();
    }

    private View buildScreen() {
        LinearLayout root = column();
        root.setBackgroundColor(SURFACE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });

        TextView appBar = text("국내 주식 한눈에", 27, DARK, true);
        appBar.setGravity(Gravity.CENTER_VERTICAL);
        appBar.setPadding(dp(20), dp(24), dp(20), dp(16));
        appBar.setBackgroundColor(SURFACE);
        root.addView(appBar, matchWrap());

        LinearLayout searchRow = new LinearLayout(this);
        searchRow.setOrientation(LinearLayout.HORIZONTAL);
        searchRow.setPadding(dp(16), dp(14), dp(16), dp(8));
        searchInput = new EditText(this);
        searchInput.setHint("종목명 또는 종목코드");
        searchInput.setSingleLine(true);
        searchInput.setInputType(InputType.TYPE_CLASS_TEXT);
        searchInput.setContentDescription("종목 검색어");
        searchInput.setTextSize(17);
        searchInput.setPadding(dp(16), 0, dp(16), 0);
        searchInput.setBackground(roundedBackground(Color.WHITE, 14, BORDER, 1));
        searchRow.addView(searchInput, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button search = button("검색");
        search.setContentDescription("종목 검색");
        search.setOnClickListener(view -> search(searchInput.getText().toString()));
        LinearLayout.LayoutParams searchButton = new LinearLayout.LayoutParams(dp(82), dp(52));
        searchButton.setMarginStart(dp(8));
        searchRow.addView(search, searchButton);
        root.addView(searchRow, matchWrap());

        progress = new ProgressBar(this);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(32), dp(32));
        progressParams.gravity = Gravity.CENTER_HORIZONTAL;
        root.addView(progress, progressParams);

        status = text("데이터를 불러오는 중입니다.", 14, MUTED, false);
        status.setPadding(dp(20), dp(10), dp(20), dp(8));
        status.setContentDescription("앱 상태");
        status.setVisibility(View.GONE);
        root.addView(status, matchWrap());

        ScrollView scroll = new ScrollView(this);
        content = column();
        content.setPadding(dp(16), dp(4), dp(16), dp(32));
        scroll.addView(content, matchWrap());
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        return root;
    }

    private void loadMarket() {
        request("/api/mobile/market", "GET", json -> {
            content.removeAllViews();
            JSONObject market = json.getJSONObject("market");
            addNote("주식시세 기준일 " + formatDate(market.getString("priceBaseDate")));

            JSONArray indices = market.getJSONArray("indices");
            addIndexCards(indices);

            addMarketHeading("상승률 상위", true);
            addMovers(market.getJSONArray("gainers"));
            addMarketHeading("하락률 상위", false);
            addMovers(market.getJSONArray("losers"));
            addNote("금융위원회 공식 주식 데이터 · 종목을 누르면 상세 화면으로 이동합니다.");
        });
    }

    private void search(String rawQuery) {
        searchInput.clearFocus();
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        keyboard.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
        String query = rawQuery.trim();
        if (query.isEmpty()) {
            showError("종목명 또는 종목코드를 입력해 주세요.");
            return;
        }
        selectedCode = null;
        content.removeAllViews();
        request("/api/mobile/stocks/search?q=" + Uri.encode(query), "GET", json -> {
            content.removeAllViews();
            JSONArray hits = json.getJSONArray("hits");
            if (hits.length() == 1) {
                loadStock(hits.getJSONObject(0).getString("code"));
                return;
            }
            addHeading("‘" + json.getString("query") + "’ 검색 결과 " + hits.length() + "건");
            addNote("상장종목 기준일 " + formatDate(json.optString("baseDate")));
            if (hits.length() == 0) {
                addCard("일치하는 종목이 없습니다", "종목명 전체나 여섯 자리 종목코드로 다시 시도해 주세요.");
            }
            for (int i = 0; i < hits.length(); i++) {
                JSONObject hit = hits.getJSONObject(i);
                String code = hit.getString("code");
                addActionCard(hit.getString("name") + " · " + code,
                        hit.getString("corpName") + " · " + hit.getString("market"), () -> loadStock(code));
            }
        });
    }

    private void addMovers(JSONArray movers) throws JSONException {
        int visible = Math.min(5, movers.length());
        for (int i = 0; i < visible; i++) {
            JSONObject quote = movers.getJSONObject(i);
            String code = quote.getString("code");
            double changeRate = quote.getDouble("changeRate");
            addChangeCard(quote.getString("name") + " · " + code,
                    number(quote.getDouble("close")) + "원 · " + signedRate(changeRate), changeRate,
                    () -> loadStock(code));
        }
    }

    private void addIndexCards(JSONArray indices) throws JSONException {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        int visible = Math.min(2, indices.length());
        for (int i = 0; i < visible; i++) {
            JSONObject index = indices.getJSONObject(i);
            double changeRate = index.getDouble("changeRate");
            LinearLayout card = indexCard(index.getString("name"),
                    number(index.getDouble("close")),
                    signedIndexChange(index.getDouble("diff")), signedRate(changeRate),
                    tradeValue(index.getDouble("tradeValue")),
                    changeRate);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            if (i > 0) params.setMarginStart(dp(10));
            row.addView(card, params);
        }
        LinearLayout.LayoutParams rowParams = matchWrap();
        rowParams.setMargins(0, 0, 0, dp(6));
        content.addView(row, rowParams);
    }

    private void loadStock(String code) {
        selectedCode = code;
        request("/api/mobile/stocks/" + code, "GET", json -> {
            content.removeAllViews();
            JSONObject quote = json.getJSONObject("quote");
            addBackButton();
            addHeading(quote.getString("name") + "  " + quote.getString("code"));
            addQuoteCard(quote);
            addCard("가격과 거래",
                    "시가 " + number(quote.getDouble("open")) + "원  ·  고가 " + number(quote.getDouble("high"))
                            + "원\n저가 " + number(quote.getDouble("low")) + "원  ·  거래량 "
                            + number(quote.getDouble("volume")) + "주");

            JSONArray bars = json.getJSONArray("bars");
            addHeading("최근 1년 주가 흐름");
            if (bars.length() > 0) {
                addNote(formatDate(bars.getJSONObject(0).getString("date")) + " ~ "
                        + formatDate(bars.getJSONObject(bars.length() - 1).getString("date"))
                        + " · 제공 거래일 " + bars.length() + "일");
                StockChartView chart = new StockChartView(this);
                chart.setBars(bars);
                addChartControls(chart);
                content.addView(chart, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300)));
            }

            addHeading("이 회사 관련 공시");
            JSONObject filings = json.getJSONObject("filings");
            String filingState = filings.getString("state");
            if ("ready".equals(filingState)) {
                addNote("최근 1년 접수 공시 " + filings.getInt("totalCount") + "건 · DART 원문이 최종 근거입니다.");
                JSONArray recent = filings.getJSONArray("recent");
                for (int i = 0; i < recent.length(); i++) addFiling(recent.getJSONObject(i));
            } else if ("error".equals(filingState)) {
                addCard("공시를 불러오지 못했습니다", "가격 자료는 그대로 확인할 수 있습니다.");
            } else {
                addNote("연결된 공시가 없습니다.");
            }

            addHeading("AI가 근거 안에서 브리핑합니다");
            Button briefing = button("AI 브리핑 만들기");
            briefing.setContentDescription("AI 브리핑 만들기");
            briefing.setOnClickListener(view -> loadBriefing());
            content.addView(briefing, matchWrap());
            addNote("매수·매도 추천이나 미래 가격 예측이 아닙니다. 숫자와 공시는 출처에서 다시 확인합니다.");
        });
    }

    private void loadBriefing() {
        if (selectedCode == null) return;
        request("/api/stocks/" + selectedCode + "/briefing", "POST", json -> {
            JSONObject briefing = json.getJSONObject("briefing");
            addHeading("AI 브리핑");
            addCard(briefing.getString("headline"), briefingItems(briefing));
            JSONObject packet = json.getJSONObject("packet");
            JSONArray references = packet.getJSONArray("references");
            addNote("근거 출처 " + references.length() + "개 · 현재 자료로 알 수 없는 것은 브리핑의 한계에서 확인합니다.");
        });
    }

    private String briefingItems(JSONObject briefing) throws JSONException {
        StringBuilder result = new StringBuilder();
        String[] groups = {"highlights", "marketContext", "priceContext", "filingContext", "unknowns"};
        for (String group : groups) {
            JSONArray items = briefing.getJSONArray(group);
            for (int i = 0; i < items.length(); i++) {
                if (result.length() > 0) result.append("\n\n");
                result.append("• ").append(items.getJSONObject(i).getString("text"));
            }
        }
        return result.toString();
    }

    private void addFiling(JSONObject filing) throws JSONException {
        String url = filing.getString("documentUrl");
        addActionCard(formatDate(filing.getString("receiptDate")) + " · " + filing.getString("reportName"),
                "제출인 " + filing.getString("filerName") + " · DART 원문 열기",
                () -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
    }

    private void addBackButton() {
        Button back = button("← 시장 화면");
        styleSecondaryButton(back);
        back.setOnClickListener(view -> loadMarket());
        content.addView(back, matchWrap());
    }

    private void request(String path, String method, JsonConsumer onSuccess) {
        progress.setVisibility(View.VISIBLE);
        status.setText("데이터를 불러오는 중입니다.");
        status.setTextColor(MUTED);
        status.setVisibility(View.VISIBLE);
        network.execute(() -> {
            try {
                JSONObject response = http(path, method);
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    status.setVisibility(View.GONE);
                    try {
                        onSuccess.accept(response);
                        content.requestLayout();
                        content.invalidate();
                    } catch (JSONException exception) {
                        showError("서버 응답 형식을 확인하지 못했습니다.");
                    }
                });
            } catch (ApiException exception) {
                runOnUiThread(() -> {
                    progress.setVisibility(View.GONE);
                    showError(exception.getMessage());
                });
            }
        });
    }

    private JSONObject http(String path, String method) throws ApiException {
        HttpURLConnection connection = null;
        try {
            String base = getString(R.string.api_base_url).replaceAll("/$", "");
            connection = (HttpURLConnection) new URL(base + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("Accept", "application/json");
            if ("POST".equals(method)) {
                connection.setDoOutput(true);
                connection.getOutputStream().write(new byte[0]);
            }
            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSONObject body = new JSONObject(readAll(stream));
            if (statusCode >= 400) {
                throw new ApiException(body.optString("error", "서버 요청이 실패했습니다."));
            }
            return body;
        } catch (IOException | JSONException exception) {
            throw new ApiException("서버에 연결하지 못했습니다. 네트워크와 서버 주소를 확인해 주세요.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws IOException {
        if (stream == null) return "{}";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void addHeading(String value) {
        TextView heading = text(value, 22, DARK, true);
        heading.setPadding(0, dp(22), 0, dp(10));
        content.addView(heading, matchWrap());
    }

    private void addNote(String value) {
        TextView note = text(value, 13, MUTED, false);
        note.setPadding(dp(2), dp(3), dp(2), dp(10));
        content.addView(note, matchWrap());
    }

    private void addCard(String title, String detail) {
        addActionCard(title, detail, null);
    }

    private void addQuoteCard(JSONObject quote) throws JSONException {
        LinearLayout card = cardContainer();
        card.addView(text(number(quote.getDouble("close")) + "원", 25, DARK, true), matchWrap());
        double changeRate = quote.getDouble("changeRate");
        TextView change = text(signedNumber(quote.getDouble("diff")) + " · " + signedRate(changeRate),
                17, marketColor(changeRate), true);
        change.setPadding(0, dp(6), 0, 0);
        card.addView(change, matchWrap());
        TextView date = text("기준일 " + formatDate(quote.getString("baseDate")), 13, MUTED, false);
        date.setPadding(0, dp(5), 0, 0);
        card.addView(date, matchWrap());
        addCardToContent(card);
    }

    private void addChangeCard(String title, String detail, double changeRate, Runnable action) {
        LinearLayout card = changeCard(title, detail, changeRate, action);
        addCardToContent(card);
    }

    private LinearLayout changeCard(String title, String detail, double changeRate, Runnable action) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.HORIZONTAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        styleCard(card);
        TextView titleView = text(title, 16, DARK, true);
        titleView.setSingleLine(true);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.addView(titleView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        TextView detailView = text(detail, 14, marketColor(changeRate), true);
        detailView.setGravity(Gravity.END);
        detailView.setPadding(dp(10), 0, 0, 0);
        card.addView(detailView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        makeActionable(card, title, detail, action);
        return card;
    }

    private LinearLayout indexCard(String name, String close, String change, String rate,
                                   String tradeValue, double changeRate) {
        LinearLayout card = cardContainer();
        card.addView(text(name, 14, MUTED, true), matchWrap());
        LinearLayout valueRow = new LinearLayout(this);
        valueRow.setOrientation(LinearLayout.HORIZONTAL);
        valueRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView closeView = text(close, 23, DARK, true);
        closeView.setPadding(0, dp(6), 0, 0);
        valueRow.addView(closeView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout changeColumn = column();
        changeColumn.setGravity(Gravity.END);
        changeColumn.addView(text(change, 14, marketColor(changeRate), true), matchWrap());
        changeColumn.addView(text("(" + rate + ")", 12, marketColor(changeRate), true), matchWrap());
        valueRow.addView(changeColumn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        card.addView(valueRow, matchWrap());
        TextView tradeView = text("거래대금 " + tradeValue, 12, MUTED, false);
        tradeView.setPadding(0, dp(5), 0, 0);
        card.addView(tradeView, matchWrap());
        return card;
    }

    private void addActionCard(String title, String detail, Runnable action) {
        LinearLayout card = cardContainer();
        TextView titleView = text(title, 17, DARK, true);
        TextView detailView = text(detail, 14, MUTED, false);
        detailView.setPadding(0, dp(6), 0, 0);
        card.addView(titleView, matchWrap());
        card.addView(detailView, matchWrap());
        makeActionable(card, title, detail, action);
        addCardToContent(card);
    }

    private LinearLayout cardContainer() {
        LinearLayout card = column();
        styleCard(card);
        return card;
    }

    private void styleCard(LinearLayout card) {
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        card.setBackground(roundedBackground(Color.WHITE, 14, BORDER, 1));
        card.setElevation(dp(1));
        card.setClipToOutline(true);
    }

    private void makeActionable(LinearLayout card, String title, String detail, Runnable action) {
        if (action == null) return;
        card.setClickable(true);
        card.setFocusable(true);
        card.setContentDescription(title + ", " + detail);
        card.setOnClickListener(view -> action.run());
    }

    private void addCardToContent(LinearLayout card) {
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, 0, 0, dp(10));
        content.addView(card, params);
    }

    private void addChartControls(StockChartView chart) {
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setPadding(0, 0, 0, dp(8));
        String[] labels = {"1개월", "3개월", "1년"};
        int[] days = {22, 66, 0};
        Button[] periodButtons = new Button[labels.length];
        for (int i = 0; i < labels.length; i++) {
            Button period = button(labels[i]);
            periodButtons[i] = period;
            stylePeriodButton(period, i == 1);
            int tradingDays = days[i];
            int selectedIndex = i;
            period.setContentDescription(labels[i] + " 차트 보기");
            period.setOnClickListener(view -> {
                chart.setVisibleTradingDays(tradingDays);
                for (int index = 0; index < periodButtons.length; index++) {
                    stylePeriodButton(periodButtons[index], index == selectedIndex);
                }
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(46), 1);
            if (i > 0) params.setMarginStart(dp(6));
            controls.addView(period, params);
        }
        content.addView(controls, matchWrap());
        addNote("상승 빨강 · 하락 파랑 · 일봉 캔들 · 거래량");
    }

    private void addMarketHeading(String label, boolean rising) {
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.setPadding(0, dp(22), 0, dp(10));

        TextView badge = text(rising ? "▲" : "▼", 13, rising ? UP : DOWN, true);
        badge.setGravity(Gravity.CENTER);
        badge.setBackground(roundedBackground(
                rising ? Color.rgb(253, 238, 238) : Color.rgb(236, 242, 253),
                10, Color.TRANSPARENT, 0));
        heading.addView(badge, new LinearLayout.LayoutParams(dp(34), dp(34)));

        TextView title = text(label, 22, DARK, true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.setMarginStart(dp(10));
        heading.addView(title, titleParams);
        content.addView(heading, matchWrap());
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(16);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(roundedBackground(PRIMARY, 14, Color.TRANSPARENT, 0));
        button.setStateListAnimator(null);
        button.setAllCaps(false);
        return button;
    }

    private void stylePeriodButton(Button button, boolean selected) {
        button.setTextColor(selected ? Color.WHITE : DARK);
        button.setBackground(roundedBackground(selected ? PRIMARY : CONTROL, 12, Color.TRANSPARENT, 0));
    }

    private void styleSecondaryButton(Button button) {
        button.setTextColor(DARK);
        button.setBackground(roundedBackground(CONTROL, 14, Color.TRANSPARENT, 0));
    }

    private GradientDrawable roundedBackground(int color, int radius, int strokeColor, int strokeWidth) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(radius));
        if (strokeWidth > 0) background.setStroke(dp(strokeWidth), strokeColor);
        return background;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        view.setLineSpacing(0, 1.15f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private LinearLayout column() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void showError(String message) {
        status.setText(message);
        status.setTextColor(Color.rgb(165, 41, 41));
        status.setVisibility(View.VISIBLE);
    }

    private String number(double value) {
        return NumberFormat.getNumberInstance(Locale.KOREA).format(Math.round(value));
    }

    private String signedNumber(double value) {
        return (value > 0 ? "+" : "") + number(value);
    }

    private String signedIndexChange(double value) {
        NumberFormat formatter = NumberFormat.getNumberInstance(Locale.KOREA);
        formatter.setMaximumFractionDigits(3);
        return (value > 0 ? "+" : "") + formatter.format(value);
    }

    private String signedRate(double value) {
        return String.format(Locale.KOREA, "%+.2f%%", value);
    }

    private String tradeValue(double value) {
        long eok = Math.round(value / 100_000_000d);
        long jo = eok / 10_000;
        long remainder = eok % 10_000;
        if (jo == 0) return number(remainder) + "억원";
        return number(jo) + "조 " + number(remainder) + "억원";
    }

    private int marketColor(double value) {
        if (value > 0) return UP;
        if (value < 0) return DOWN;
        return MUTED;
    }

    private String formatDate(String value) {
        if (value == null || value.length() != 8) return value;
        return value.substring(0, 4) + "." + value.substring(4, 6) + "." + value.substring(6, 8);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @FunctionalInterface
    private interface JsonConsumer {
        void accept(JSONObject json) throws JSONException;
    }

    private static final class ApiException extends Exception {
        ApiException(String message) {
            super(message);
        }
    }
}
