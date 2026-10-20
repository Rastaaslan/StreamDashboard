package com.rastaaslan.streamdashboard.remote;

import org.junit.Test;
import static org.junit.Assert.*;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Status;
import java.util.concurrent.*;

public class GoogleAuthorizationAdapterTest {
  @Test public void sdkErrorsExposeOnlyNumericStatus() {
    ApiException sdk = new ApiException(new Status(10, "private SDK detail"));
    GoogleAuthorizationFlow.AuthException error = GoogleAuthorizationAdapter.diagnostic(sdk);
    assertEquals("GOOGLE_API_10", error.code);
    assertEquals("GOOGLE_API_10", error.getMessage());
    assertEquals("GOOGLE_API_10", GoogleAuthorizationAdapter.diagnostic(new ExecutionException(sdk)).code);
    assertEquals("TIMEOUT", GoogleAuthorizationAdapter.diagnostic(new TimeoutException()).code);
    assertEquals("AUTH", GoogleAuthorizationAdapter.diagnostic(new Exception("private detail")).code);
  }
}
