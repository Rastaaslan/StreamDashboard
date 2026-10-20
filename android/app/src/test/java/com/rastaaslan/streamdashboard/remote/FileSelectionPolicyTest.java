package com.rastaaslan.streamdashboard.remote;

import static org.junit.Assert.*;
import org.junit.Test;

public class FileSelectionPolicyTest {
  private final String app="com.rastaaslan.streamdashboard.remote.next";
  @Test public void allowsDocumentProviders(){
    assertTrue(FileSelectionPolicy.accepts("content://com.android.providers.media.documents/document/audio%3A42",app));
    assertTrue(FileSelectionPolicy.accepts("content://com.android.externalstorage.documents/document/primary%3ADownload%2Fsound.mp3",app));
  }
  @Test public void rejectsUnselectedFilesAndPrivateExports(){
    for(String value:new String[]{"file:///data/data/secret","https://example.test/file.mp3","data:audio/wav;base64,AAAA","content://","content://user@files/a","content://files:123/a","content://files/a#fragment","content://"+app+".fileprovider/shared/private.png"})assertFalse(value,FileSelectionPolicy.accepts(value,app));
    assertFalse(FileSelectionPolicy.accepts(null,app));
  }
}
