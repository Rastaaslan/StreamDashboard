package com.rastaaslan.streamdashboard.remote;

import java.net.URI;

/** Only public channel/video identifiers enter the bridge-free viewer activity. */
final class ViewerTargets {
  final String twitch,youtube,source;
  ViewerTargets(String channel,String video,String selected) {
    twitch=channel==null?"":channel;youtube=video==null?"":video;source="youtube".equals(selected)?"youtube":"twitch";
    if((!twitch.isEmpty()&&!twitch.matches("[A-Za-z0-9_]{1,25}"))||(!youtube.isEmpty()&&!youtube.matches("[A-Za-z0-9_-]{11}")))throw new IllegalArgumentException("Chaîne ou diffusion invalide");
  }
  String external(String kind){return "twitch".equals(kind)?twitch.isEmpty()?"https://www.twitch.tv/":"https://www.twitch.tv/"+twitch:youtube.isEmpty()?"https://www.youtube.com/":"https://www.youtube.com/watch?v="+youtube;}
  static boolean embedded(String raw) {
    try {URI uri=URI.create(raw);String host=uri.getHost();return "https".equals(uri.getScheme())&&uri.getUserInfo()==null&&uri.getPort()==-1&&host!=null&&(host.equals("www.twitch.tv")||host.equals("player.twitch.tv")||host.equals("id.twitch.tv")||host.equals("www.youtube.com")||host.equals("appassets.androidplatform.net"));}catch(Exception error){return false;}
  }
  String video(){return "youtube".equals(source)?youtube.isEmpty()?"":"https://www.youtube.com/embed/"+youtube+"?autoplay=1&mute=1":twitch.isEmpty()?"":"https://player.twitch.tv/?channel="+twitch+"&parent=appassets.androidplatform.net&autoplay=true&muted=true";}
  String twitchChat(){return twitch.isEmpty()?"":"https://www.twitch.tv/embed/"+twitch+"/chat?parent=appassets.androidplatform.net&darkpopout";}
  String youtubeChat(){return youtube.isEmpty()?"":"https://www.youtube.com/live_chat?v="+youtube+"&embed_domain=appassets.androidplatform.net";}
}
