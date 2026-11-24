package com.quarc.translate;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Text handed to the app by other apps. JS name: IncomingText.
 *
 *  - "Share → Quarc Translate" (ACTION_SEND, text/plain) from a browser, a chat, a mail app...
 *  - "Translate" in the text-selection menu of any app (ACTION_PROCESS_TEXT).
 *
 * The text is kept here until the web side asks for it (takePending), and the web side is also told
 * ("incoming") when something arrives while the app is already running. It is idempotent on purpose:
 * the web side asks once at start-up and again on every "incoming", so it does not matter whether the
 * intent or the page was first.
 */
@CapacitorPlugin(name = "IncomingText")
public class IncomingTextPlugin extends Plugin {

    // Marks an intent this plugin has already dealt with (the launch intent can be looked at twice).
    private static final String HANDLED = "com.quarc.translate.INCOMING_TEXT_HANDLED";

    private String pending; // guarded by this

    @Override
    public void load() {
        // The intent that started the app: not every Capacitor version also hands it to handleOnNewIntent.
        if (getActivity() != null) consume(getActivity().getIntent(), false);
    }

    /** Every later intent (the activity is singleTask, so a share while the app is open arrives here). */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        consume(intent, true);
    }

    /** The text that arrived and has not been collected yet: { text: string | null }. */
    @PluginMethod
    public void takePending(PluginCall call) {
        String text;
        synchronized (this) {
            text = pending;
            pending = null;
        }
        JSObject result = new JSObject();
        result.put("text", text);
        call.resolve(result);
    }

    private void consume(Intent intent, boolean notify) {
        if (intent == null) return;
        // Brought back from the recent-apps list: that is the intent which started the task long ago.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        if (intent.getBooleanExtra(HANDLED, false)) return;

        String text = textOf(intent);
        if (text == null) return;

        intent.putExtra(HANDLED, true);
        synchronized (this) {
            pending = text;
        }
        // Retained until the web side is listening (the page may still be starting up).
        if (notify) notifyListeners("incoming", new JSObject(), true);
    }

    private static String textOf(Intent intent) {
        String action = intent.getAction();
        CharSequence value = null;
        if (Intent.ACTION_SEND.equals(action)) {
            value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            value = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        }
        if (value == null) return null;
        String text = value.toString();
        return text.trim().isEmpty() ? null : text;
    }
}
