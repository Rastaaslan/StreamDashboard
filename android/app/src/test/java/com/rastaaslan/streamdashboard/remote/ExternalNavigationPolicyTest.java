package com.rastaaslan.streamdashboard.remote;

import static org.junit.Assert.*;
import org.junit.Test;

public class ExternalNavigationPolicyTest {
  @Test public void allowsExistingLiveAndCatalogLinks(){
    for(String value:new String[]{"https://www.twitch.tv/activate","https://twitch.tv/example/dashboard","https://www.youtube.com/watch?v=abcdefghijk","https://youtube.com/live_chat?v=abcdefghijk&is_popout=1","https://studio.youtube.com/","https://studio.youtube.com/video/abcdefghijk/livestreaming","https://test_channel.streaming.lv/?commands"})assertTrue(value,ExternalNavigationPolicy.accepts(value));
  }
  @Test public void rejectsBroaderNavigationAndCredentials(){
    for(String value:new String[]{"http://youtube.com/watch?v=abcdefghijk","https://user:secret@youtube.com/","https://youtube.com:8443/","https://youtube.com.example.test/","https://example.youtube.com/","https://youtube.com@evil.test/","https://notstreaming.lv/?commands","https://nested.channel.streaming.lv/?commands","https://user@channel.streaming.lv/?commands","https://channel.streaming.lv/admin","https://channel.streaming.lv/?commands&token=private","file:///tmp/private","javascript:alert(1)","https:youtube.com/","https://test_channel.streaming.lv:999/?commands","https://user@@sub.twitch.tv/","https://encoded%2e.twitch.tv/"})assertFalse(value,ExternalNavigationPolicy.accepts(value));
    assertFalse(ExternalNavigationPolicy.accepts(null));
  }
}
