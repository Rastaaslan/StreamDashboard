package com.rastaaslan.streamdashboard.remote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Explicit mutable installer result PendingIntent targets this non-exported
 * receiver. Only metadata for the exact durable session ID is accepted. */
public final class UpdateResultReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    if (intent != null && (context.getPackageName() + ".UPDATE_RESULT").equals(intent.getAction()))
      NativeUpdateManager.result(context, intent);
  }
}
