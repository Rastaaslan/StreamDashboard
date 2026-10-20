package com.rastaaslan.streamdashboard.remote;

import java.net.URI;
import java.util.Locale;

/** Browser destinations already offered by the dashboard. External pages never
 * inherit the WebView's native credential/provider bridges. */
final class ExternalNavigationPolicy {
  static boolean accepts(String value){
    if(value==null||value.length()>8000)return false;
    try{
      URI uri=new URI(value);
      if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getRawUserInfo()!=null||(uri.getPort()!=-1&&uri.getPort()!=443))return false;
      // URI treats underscores in a Twitch channel's streaming.lv hostname as
      // a registry authority. The exact fallback pattern still rejects ports,
      // userinfo, encoded host characters and unrelated domains.
      String host=uri.getHost();
      if(host!=null){
        host=host.toLowerCase(Locale.ROOT);
        if(host.equals("twitch.tv")||host.endsWith(".twitch.tv"))return true;
        if(host.equals("youtube.com")||host.equals("www.youtube.com")||host.equals("studio.youtube.com"))return true;
      }else host=uri.getRawAuthority();
      if(host==null)return false;host=host.toLowerCase(Locale.ROOT);
      return host.matches("[a-z0-9_]{1,25}\\.streaming\\.lv")
        &&(uri.getRawPath()==null||uri.getRawPath().isEmpty()||uri.getRawPath().equals("/"))
        &&"commands".equals(uri.getRawQuery())&&uri.getRawFragment()==null;
    }catch(Exception error){return false;}
  }
}
