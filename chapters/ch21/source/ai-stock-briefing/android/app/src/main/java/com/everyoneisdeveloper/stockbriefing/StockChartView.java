package com.everyoneisdeveloper.stockbriefing;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

public final class StockChartView extends View {
    private static final int UP = Color.rgb(198, 40, 40);
    private static final int DOWN = Color.rgb(18, 86, 196);
    private static final int FLAT = Color.rgb(95, 107, 128);

    private final Paint candlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint volumePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint guidePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private Bar[] bars = new Bar[0];
    private int visibleTradingDays = 66;

    public StockChartView(Context context) {
        this(context, null);
    }

    public StockChartView(Context context, AttributeSet attrs) {
        super(context, attrs);
        candlePaint.setStrokeWidth(dp(1));
        guidePaint.setColor(Color.rgb(227, 232, 240));
        guidePaint.setStrokeWidth(dp(1));
        labelPaint.setColor(Color.rgb(95, 107, 128));
        labelPaint.setTextSize(dp(11));
        setContentDescription("3개월 일봉 캔들차트와 거래량");
    }

    public void setBars(JSONArray source) throws JSONException {
        bars = new Bar[source.length()];
        for (int i = 0; i < source.length(); i++) {
            JSONObject value = source.getJSONObject(i);
            bars[i] = new Bar(
                    value.getString("date"),
                    (float) value.getDouble("open"),
                    (float) value.getDouble("high"),
                    (float) value.getDouble("low"),
                    (float) value.getDouble("close"),
                    (float) value.getDouble("volume")
            );
        }
        updateAccessibility();
        invalidate();
    }

    public void setVisibleTradingDays(int days) {
        visibleTradingDays = days;
        updateAccessibility();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        float inset = dp(12);
        float labelHeight = dp(24);
        float chartBottom = height - labelHeight;
        float priceHeight = chartBottom * 0.72f;
        float volumeTop = chartBottom * 0.78f;
        for (int i = 1; i <= 3; i++) {
            float y = priceHeight * i / 4f;
            canvas.drawLine(inset, y, width - inset, y, guidePaint);
        }
        int count = visibleCount();
        if (count == 0) return;
        int start = bars.length - count;

        float min = bars[start].low;
        float max = bars[start].high;
        float maxVolume = Math.max(1, bars[start].volume);
        for (int i = start; i < bars.length; i++) {
            min = Math.min(min, bars[i].low);
            max = Math.max(max, bars[i].high);
            maxVolume = Math.max(maxVolume, bars[i].volume);
        }
        float range = Math.max(1f, max - min);
        float usableWidth = width - inset * 2;
        float step = usableWidth / count;
        float candleWidth = Math.max(dp(1), Math.min(step * 0.68f, dp(9)));
        for (int visibleIndex = 0; visibleIndex < count; visibleIndex++) {
            Bar bar = bars[start + visibleIndex];
            int color = bar.close > bar.open ? UP : bar.close < bar.open ? DOWN : FLAT;
            candlePaint.setColor(color);
            float x = inset + step * (visibleIndex + 0.5f);
            float highY = priceHeight * (max - bar.high) / range;
            float lowY = priceHeight * (max - bar.low) / range;
            float openY = priceHeight * (max - bar.open) / range;
            float closeY = priceHeight * (max - bar.close) / range;
            canvas.drawLine(x, highY, x, lowY, candlePaint);
            float top = Math.min(openY, closeY);
            float bodyHeight = Math.max(dp(1.5f), Math.abs(closeY - openY));
            canvas.drawRect(x - candleWidth / 2, top, x + candleWidth / 2, top + bodyHeight, candlePaint);

            volumePaint.setColor(withAlpha(color, 85));
            float volumeHeight = (chartBottom - volumeTop) * bar.volume / maxVolume;
            canvas.drawRect(x - candleWidth / 2, chartBottom - volumeHeight,
                    x + candleWidth / 2, chartBottom, volumePaint);
        }
        canvas.drawText(formatDate(bars[start].date), inset, height - dp(4), labelPaint);
        String volumeLabel = "거래량";
        canvas.drawText(volumeLabel, (width - labelPaint.measureText(volumeLabel)) / 2, height - dp(4), labelPaint);
        String endDate = formatDate(bars[bars.length - 1].date);
        canvas.drawText(endDate, width - inset - labelPaint.measureText(endDate), height - dp(4), labelPaint);
    }

    private int visibleCount() {
        if (visibleTradingDays <= 0) return bars.length;
        return Math.min(visibleTradingDays, bars.length);
    }

    private void updateAccessibility() {
        int count = visibleCount();
        String period = visibleTradingDays == 22 ? "1개월" : visibleTradingDays == 66 ? "3개월" : "1년";
        setContentDescription(period + " 일봉 캔들차트와 거래량, 거래일 " + count + "일");
    }

    private static int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    private static String formatDate(String value) {
        if (value == null || value.length() != 8) return value == null ? "" : value;
        return String.format(Locale.KOREA, "%s.%s.%s",
                value.substring(0, 4), value.substring(4, 6), value.substring(6, 8));
    }

    private static final class Bar {
        final String date;
        final float open;
        final float high;
        final float low;
        final float close;
        final float volume;

        Bar(String date, float open, float high, float low, float close, float volume) {
            this.date = date;
            this.open = open;
            this.high = high;
            this.low = low;
            this.close = close;
            this.volume = volume;
        }
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }
}
