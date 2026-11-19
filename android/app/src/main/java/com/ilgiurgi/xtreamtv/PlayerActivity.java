package com.ilgiurgi.xtreamtv;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Riproduzione a schermo intero con ExoPlayer (Media3): MPEG-TS, HLS, MP4, MKV.
 * Con più elementi mostra i pulsanti precedente/successivo (zapping, episodi) e passa da solo
 * all'elemento successivo a fine riproduzione. Alla chiusura restituisce elemento e posizione.
 * Le dirette ricevono invece un solo canale per volta: il cambio canale è sempre una scelta dell'utente,
 * mai un passaggio automatico di ExoPlayer al "successivo" della playlist.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {

    static final String EXTRA_ITEMS = "items";
    static final String EXTRA_INDEX = "index";
    static final String EXTRA_START_MS = "startMs";
    static final String EXTRA_LIVE = "live";
    static final String EXTRA_SWIPE = "swipe";
    static final String EXTRA_USER_AGENT = "userAgent";
    static final String RESULT_POSITION_MS = "positionMs";
    static final String RESULT_DURATION_MS = "durationMs";
    static final String RESULT_ERROR = "error";

    private static final int MAX_LIVE_RETRIES = 3;
    // Attese crescenti tra un tentativo e l'altro: riaprire subito lascia ancora aperta la connessione di prima
    // e il provider (limite di 1-2 connessioni) risponde 403 o blocca l'IP.
    private static final long[] RETRY_DELAYS_MS = {2000, 4000, 8000};
    // Dopo un 403/429 si riprova una sola volta, e dopo una pausa lunga.
    private static final long LIMIT_PAUSE_MS = 6000;
    // Cambio canale: pausa dopo aver chiuso il flusso; scorrendo in fretta si apre solo l'ultimo canale scelto.
    private static final long SWITCH_GAP_MS = 1500;
    // Tetto di aperture di stream nella finestra (come OpenLimit nell'app TV): oltre, si aspetta.
    private static final int OPEN_LIMIT = 6;
    private static final long OPEN_WINDOW_MS = 30000;
    private static final ArrayDeque<Long> recentOpens = new ArrayDeque<>();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private PlayerView playerView;
    private TextView titleView;
    private boolean live;
    private int liveRetries;
    private int lastHttpStatus;
    private String lastError;
    private GestureDetector swipeDetector;
    private List<MediaItem> allItems;
    private int liveIndex;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Intent intent = getIntent();
        live = intent.getBooleanExtra(EXTRA_LIVE, false);
        List<MediaItem> items = parseItems(intent.getStringExtra(EXTRA_ITEMS));
        int index = Math.max(0, Math.min(items.size() - 1, intent.getIntExtra(EXTRA_INDEX, 0)));
        long startMs = intent.getLongExtra(EXTRA_START_MS, 0);
        allItems = items;
        liveIndex = index;

        buildLayout();
        hideSystemBars();

        // Molti server Xtream reindirizzano da https a http: va permesso esplicitamente.
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000);
        String ua = intent.getStringExtra(EXTRA_USER_AGENT);
        if ("vlc".equals(ua)) http.setUserAgent("VLC/3.0.20 LibVLC/3.0.20");
        else if ("smarters".equals(ua)) http.setUserAgent("IPTVSmartersPro");
        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(http))
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(MediaItem mediaItem, int reason) {
                liveRetries = 0;
                updateTitle();
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    liveRetries = 0;
                    lastHttpStatus = 0;
                }
                if (state == Player.STATE_ENDED) {
                    if (live) retryLive();
                    else finishWithResult();
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                lastError = error.getErrorCodeName();
                lastHttpStatus = 0;
                // Se il provider ha risposto (403, 404, 884...), il codice HTTP dice più del nome generico dell'errore.
                Throwable cause = error.getCause();
                if (cause instanceof androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                    lastHttpStatus = ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                    lastError += " HTTP " + lastHttpStatus;
                }
                boolean limited = lastHttpStatus == 403 || lastHttpStatus == 429;
                // 403/429 e 404 non passano da soli: un solo nuovo tentativo, poi ci si ferma.
                if (live && liveRetries < (limited || lastHttpStatus == 404 ? 1 : MAX_LIVE_RETRIES)) {
                    // Le dirette IPTV cadono spesso per qualche secondo: si riprova da soli.
                    retryLive();
                } else {
                    Toast.makeText(PlayerActivity.this,
                            "Impossibile riprodurre (" + lastError + ")", Toast.LENGTH_LONG).show();
                }
            }
        });

        playerView.setPlayer(live ? new LivePlayer(player) : player);
        playerView.setShowFastForwardButton(!live);
        playerView.setShowRewindButton(!live);
        playerView.setShowNextButton(items.size() > 1);
        playerView.setShowPreviousButton(items.size() > 1);
        playerView.setControllerVisibilityListener(
                (PlayerView.ControllerVisibilityListener) visibility -> titleView.setVisibility(visibility));

        if (live) recentOpens.addLast(SystemClock.elapsedRealtime());
        if (live) player.setMediaItem(items.get(index));
        else player.setMediaItems(items, index, startMs);
        player.prepare();
        player.setPlayWhenReady(true);
        updateTitle();

        // Dirette: scorrendo col dito a sinistra/destra si passa al canale successivo/precedente
        // (solo se attivato nelle Impostazioni dell'app).
        if (intent.getBooleanExtra(EXTRA_SWIPE, false)) installSwipe();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishWithResult();
            }
        });
    }

    /** Riapre lo stesso canale dopo una pausa (errore o chiusura da parte del server). */
    private void retryLive() {
        boolean limited = lastHttpStatus == 403 || lastHttpStatus == 429;
        long delay = limited ? LIMIT_PAUSE_MS : RETRY_DELAYS_MS[Math.min(liveRetries, RETRY_DELAYS_MS.length - 1)];
        liveRetries++;
        if (player != null) player.stop(); // la connessione si chiude prima di aspettare
        scheduleOpen(delay, () -> {
            player.seekToDefaultPosition();
            player.prepare();
            player.setPlayWhenReady(true);
        });
    }

    /** Millisecondi da aspettare prima di poter aprire un altro stream senza superare il tetto (0 = subito). */
    private static long openLimitWait() {
        long now = SystemClock.elapsedRealtime();
        while (!recentOpens.isEmpty() && now - recentOpens.peekFirst() >= OPEN_WINDOW_MS) recentOpens.pollFirst();
        return recentOpens.size() < OPEN_LIMIT ? 0 : recentOpens.peekFirst() + OPEN_WINDOW_MS - now;
    }

    /**
     * Apre uno stream dopo `delayMs` (o più tardi, se si supera il tetto di aperture). Una nuova richiesta annulla
     * quella in attesa: con lo zapping veloce parte solo l'ultima.
     */
    private void scheduleOpen(long delayMs, Runnable open) {
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            if (player == null) return;
            long wait = openLimitWait();
            if (wait > 0) {
                scheduleOpen(wait, open);
                return;
            }
            recentOpens.addLast(SystemClock.elapsedRealtime());
            open.run();
        }, delayMs);
    }

    /** Pulsanti precedente/successivo del lettore = canale vicino nella lista (che ExoPlayer non conosce). */
    private class LivePlayer extends ForwardingPlayer {
        LivePlayer(Player wrapped) {
            super(wrapped);
        }

        @Override
        public Player.Commands getAvailableCommands() {
            return super.getAvailableCommands().buildUpon()
                    .addAll(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_PREVIOUS,
                            Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                    .build();
        }

        @Override
        public boolean isCommandAvailable(int command) {
            return getAvailableCommands().contains(command);
        }

        @Override
        public boolean hasNextMediaItem() {
            return allItems.size() > 1;
        }

        @Override
        public boolean hasPreviousMediaItem() {
            return allItems.size() > 1;
        }

        @Override
        public void seekToNext() {
            zap(1);
        }

        @Override
        public void seekToNextMediaItem() {
            zap(1);
        }

        @Override
        public void seekToPrevious() {
            zap(-1);
        }

        @Override
        public void seekToPreviousMediaItem() {
            zap(-1);
        }
    }

    private void installSwipe() {
        final float minDistance = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 80, getResources().getDisplayMetrics());
        swipeDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onFling(MotionEvent start, MotionEvent end, float velocityX, float velocityY) {
                if (!live || start == null || player == null || allItems.size() < 2) return false;
                float dx = end.getX() - start.getX();
                float dy = end.getY() - start.getY();
                if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * 2) return false;
                zap(dx < 0 ? 1 : -1);
                return true;
            }
        });
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        // Il gesto si osserva prima del PlayerView (che riceve comunque il tocco per i suoi controlli).
        if (swipeDetector != null) swipeDetector.onTouchEvent(event);
        return super.dispatchTouchEvent(event);
    }

    /** Canale successivo (+1) o precedente (-1), ricominciando dall'altro capo della lista. */
    private void zap(int delta) {
        if (player == null) return;
        int count = allItems.size();
        liveIndex = (liveIndex + delta + count) % count;
        liveRetries = 0;
        lastHttpStatus = 0;
        player.stop(); // chiude il flusso attuale; il nuovo si apre dopo la pausa (SWITCH_GAP_MS)
        final MediaItem next = allItems.get(liveIndex);
        titleView.setText(next.mediaMetadata.title == null ? "" : next.mediaMetadata.title);
        scheduleOpen(SWITCH_GAP_MS, () -> {
            player.setMediaItem(next);
            player.prepare();
            player.setPlayWhenReady(true);
        });
        playerView.showController();
    }

    private List<MediaItem> parseItems(String json) {
        List<MediaItem> items = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json == null ? "[]" : json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                items.add(new MediaItem.Builder()
                        .setUri(item.getString("url"))
                        .setMediaMetadata(new MediaMetadata.Builder().setTitle(item.optString("title", "")).build())
                        .build());
            }
        } catch (JSONException e) {
            lastError = "Playlist non valida";
        }
        return items;
    }

    private void buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        playerView = new PlayerView(this);
        root.addView(playerView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        titleView = new TextView(this);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        titleView.setShadowLayer(6, 0, 2, Color.BLACK);
        int padding = Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 20, getResources().getDisplayMetrics()));
        titleView.setPadding(padding, padding, padding, padding);
        root.addView(titleView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP));

        setContentView(root);
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void updateTitle() {
        MediaItem item = player == null ? null : player.getCurrentMediaItem();
        CharSequence title = item == null ? null : item.mediaMetadata.title;
        titleView.setText(title == null ? "" : title);
        titleView.setVisibility(playerView.isControllerFullyVisible() ? View.VISIBLE : View.GONE);
    }

    private void finishWithResult() {
        Intent data = new Intent();
        if (player != null) {
            long duration = player.getDuration();
            data.putExtra(EXTRA_INDEX, live ? liveIndex : player.getCurrentMediaItemIndex());
            data.putExtra(RESULT_POSITION_MS, Math.max(0, player.getCurrentPosition()));
            data.putExtra(RESULT_DURATION_MS, duration == C.TIME_UNSET ? 0 : Math.max(0, duration));
        }
        data.putExtra(RESULT_ERROR, lastError);
        setResult(RESULT_OK, data);
        finish();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player == null) return;
        if (live) {
            // Una diretta in sottofondo tiene aperta la connessione col provider (limite di 1-2): si chiude e si torna all'app.
            finishWithResult();
        } else {
            player.pause();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
