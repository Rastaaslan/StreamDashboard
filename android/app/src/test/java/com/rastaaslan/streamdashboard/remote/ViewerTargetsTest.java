package com.rastaaslan.streamdashboard.remote;
import org.junit.Test;
import static org.junit.Assert.*;
public class ViewerTargetsTest {
 @Test public void validatesIdentifiersBeforeBuildingPlatformFrames(){
  ViewerTargets value=new ViewerTargets("my_channel","abcdefghijk","youtube");
  assertTrue(value.video().contains("/embed/abcdefghijk"));assertTrue(value.twitchChat().contains("/my_channel/chat"));assertTrue(value.youtubeChat().contains("v=abcdefghijk"));
  assertThrows(IllegalArgumentException.class,()->new ViewerTargets("a\" onload=\"x","","twitch"));
  assertThrows(IllegalArgumentException.class,()->new ViewerTargets("","https://bad","youtube"));
 }
 @Test public void keepsProviderPagesHttpsAndOutsideTheNativeController(){
  assertTrue(ViewerTargets.embedded("https://www.twitch.tv/login"));assertTrue(ViewerTargets.embedded("https://www.youtube.com/live_chat?v=abcdefghijk"));
  for(String value:new String[]{"http://www.twitch.tv/login","file:///private","https://www.twitch.tv.evil.example","https://user@www.twitch.tv/","https://accounts.google.com/"})assertFalse(ViewerTargets.embedded(value));
 }
}
