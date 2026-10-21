package com.rastaaslan.streamdashboard.remote;

import org.json.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** Fixed provider operations. No caller-controlled URL, credential or ingestion key. */
final class CloudPlatforms {
  interface Transport { JSONObject request(String provider,String method,String path,JSONObject body) throws Exception; }
  private final Transport transport;
  CloudPlatforms(Transport transport){this.transport=transport;}
  private JSONObject yt(String method,String path,JSONObject body)throws Exception{return transport.request("youtube",method,path,body);}
  private JSONObject tw(String method,String path,JSONObject body)throws Exception{return transport.request("twitch",method,path,body);}
  private static String enc(String value)throws java.io.UnsupportedEncodingException{return URLEncoder.encode(value,"UTF-8");}
  private static String id(JSONObject input,String key)throws Exception{String value=input.optString(key);if(!value.matches("[A-Za-z0-9_-]{1,120}"))throw new IllegalArgumentException("Identifiant invalide : "+key);return value;}
  private static JSONArray array(JSONObject value,String key){JSONArray a=value.optJSONArray(key);return a==null?new JSONArray():a;}
  private static JSONObject result(JSONArray items)throws Exception{return new JSONObject().put("ok",true).put("items",items);}
  private JSONArray list(String resource,String query)throws Exception{
    JSONArray all=new JSONArray();Set<String> seen=new HashSet<>();String cursor="";
    for(int page=0;page<40;page++){
      JSONObject response=yt("GET",resource+"?"+query+"&maxResults=50"+(cursor.isEmpty()?"":"&pageToken="+enc(cursor)),null);
      JSONArray items=array(response,"items");for(int i=0;i<items.length();i++)all.put(items.getJSONObject(i));
      cursor=response.optString("nextPageToken");if(cursor.isEmpty())return all;
      if(!seen.add(cursor))throw new IllegalStateException("Pagination YouTube incohérente.");
    }
    throw new IllegalStateException("Catalogue trop volumineux ; aucune liste partielle utilisée.");
  }
  private String owner()throws Exception{
    JSONArray items=array(yt("GET","channels?part=id,snippet&mine=true",null),"items");
    if(items.length()!=1)throw new IllegalStateException("Connectez une seule chaîne YouTube.");return items.getJSONObject(0).getString("id");
  }
  private JSONObject target(String resource,String selected,String channel)throws Exception{
    JSONArray items=array(yt("GET",resource+"?part=id,snippet,status,contentDetails&id="+enc(selected),null),"items");
    for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if(selected.equals(item.optString("id"))&&channel.equals(item.getJSONObject("snippet").optString("channelId")))return item;}
    throw new IllegalArgumentException("La cible YouTube n’appartient pas au compte connecté.");
  }
  static JSONObject metadata(JSONObject input)throws Exception{
    if(input==null)throw new IllegalArgumentException("Informations du live absentes.");
    String title=input.optString("title").trim(),description=input.optString("description"),category=input.optString("youtubeCategoryId"),game=input.optString("twitchGameId");JSONArray tags=array(input,"tags");
    if(title.isEmpty()||title.length()>100||description.length()>5000||(title+description).matches("(?s).*[<>].*")||!category.matches("[0-9]{1,6}")||!game.matches("[0-9]{0,30}")||tags.length()>10)throw new IllegalArgumentException("Titre, description ou catégories invalides.");
    for(int i=0;i<tags.length();i++)if(!tags.getString(i).matches("[\\p{L}\\p{N}]{1,25}"))throw new IllegalArgumentException("Tags invalides.");
    return new JSONObject().put("title",title).put("description",description).put("youtubeCategoryId",category).put("twitchGameId",game).put("tags",tags);
  }
  JSONObject execute(JSONObject input)throws Exception{
    String operation=input.optString("operation");
    if(operation.equals("twitch.metadata")){
      JSONObject user=tw("GET","users",null).getJSONArray("data").getJSONObject(0);String userId=user.getString("id");
      if(input.has("channelId")&&!userId.equals(input.optString("channelId")))throw new IllegalArgumentException("Le compte Twitch a changé.");
      if(input.has("metadata")){
        JSONObject m=metadata(input.getJSONObject("metadata"));JSONObject patch=new JSONObject().put("title",m.getString("title")).put("tags",m.getJSONArray("tags"));
        if(!m.optString("twitchGameId").isEmpty())patch.put("game_id",m.getString("twitchGameId"));
        tw("PATCH","channels?broadcaster_id="+enc(userId),patch);
      }
      JSONObject actual=tw("GET","channels?broadcaster_id="+enc(userId),null).getJSONArray("data").getJSONObject(0);
      if(!userId.equals(actual.optString("broadcaster_id")))throw new IllegalStateException("Chaîne Twitch non vérifiée.");
      if(input.has("metadata")){JSONObject m=metadata(input.getJSONObject("metadata"));if(!m.getString("title").equals(actual.optString("title"))||(!m.optString("twitchGameId").isEmpty()&&!m.getString("twitchGameId").equals(actual.optString("game_id")))||!sameTags(m.getJSONArray("tags"),array(actual,"tags")))throw new IllegalStateException("Twitch n’a pas confirmé toutes les informations.");}
      return new JSONObject().put("ok",true).put("channelId",userId).put("title",actual.optString("title")).put("twitchGameId",actual.optString("game_id")).put("gameName",actual.optString("game_name")).put("tags",array(actual,"tags"));
    }
    if(operation.equals("youtube.channels")){
      JSONArray items=array(yt("GET","channels?part=id,snippet&mine=true",null),"items"),safe=new JSONArray();
      for(int i=0;i<items.length();i++){JSONObject v=items.getJSONObject(i);safe.put(new JSONObject().put("id",v.getString("id")).put("title",v.getJSONObject("snippet").optString("title")));}return result(safe);
    }
    String channel=owner();
    if(input.has("channelId")&&!channel.equals(input.optString("channelId")))throw new IllegalArgumentException("Le compte YouTube a changé.");
    if(operation.equals("youtube.broadcasts")||operation.equals("youtube.streams")){
      boolean streams=operation.endsWith("streams");JSONArray items=list(streams?"liveStreams":"liveBroadcasts","part=id,snippet,status,contentDetails&mine=true"+(streams?"":"&broadcastType=all")),safe=new JSONArray();
      for(int i=0;i<items.length();i++){
        JSONObject v=items.getJSONObject(i),snippet=v.getJSONObject("snippet"),state=v.getJSONObject("status"),details=v.optJSONObject("contentDetails");
        String status=state.optString(streams?"streamStatus":"lifeCycleStatus");
        if(!channel.equals(snippet.optString("channelId"))||(streams&&(details==null||!details.optBoolean("isReusable")))||(!streams&&Set.of("complete","revoked").contains(status)))continue;
        safe.put(new JSONObject().put("id",v.getString("id")).put("title",snippet.optString("title")).put("channelId",channel).put("status",status).put("bound",details!=null&&!details.optString("boundStreamId").isEmpty()).put("scheduledStartTime",snippet.optString("scheduledStartTime")));
      }return result(safe);
    }
    if(operation.equals("youtube.create")){
      JSONObject m=metadata(input.getJSONObject("metadata"));String stream=id(input,"streamId"),privacy=input.optString("privacyStatus");
      if(!Set.of("private","unlisted","public").contains(privacy)||!(input.opt("madeForKids") instanceof Boolean))throw new IllegalArgumentException("Visibilité et public requis.");
      String date=input.getString("scheduledStartTime");if(Instant.parse(date).toEpochMilli()<System.currentTimeMillis()-60000)throw new IllegalArgumentException("Date de début passée.");
      JSONObject source=target("liveStreams",stream,channel);if(!source.getJSONObject("contentDetails").optBoolean("isReusable"))throw new IllegalArgumentException("Flux réutilisable requis.");
      JSONObject created=yt("POST","liveBroadcasts?part=id,snippet,status,contentDetails",new JSONObject()
        .put("snippet",new JSONObject().put("title",m.getString("title")).put("description",m.getString("description")).put("scheduledStartTime",date))
        .put("status",new JSONObject().put("privacyStatus",privacy).put("selfDeclaredMadeForKids",input.optBoolean("madeForKids")))
        .put("contentDetails",new JSONObject().put("enableAutoStart",false).put("enableAutoStop",false)));
      return new JSONObject().put("ok",true).put("broadcastId",id(created,"id")).put("channelId",channel);
    }
    String broadcast=id(input,"broadcastId");JSONObject target=target("liveBroadcasts",broadcast,channel);
    if(Set.of("complete","revoked").contains(target.getJSONObject("status").optString("lifeCycleStatus")))throw new IllegalArgumentException("Cette diffusion est terminée.");
    if(operation.equals("youtube.bind")){
      String stream=id(input,"streamId");target("liveStreams",stream,channel);
      yt("POST","liveBroadcasts/bind?part=id,contentDetails&id="+enc(broadcast)+"&streamId="+enc(stream),null);
      JSONObject observed=target("liveBroadcasts",broadcast,channel);
      if(!stream.equals(observed.getJSONObject("contentDetails").optString("boundStreamId")))throw new IllegalStateException("Association du flux non confirmée.");
      return new JSONObject().put("ok",true).put("broadcastId",broadcast);
    }
    if(!operation.equals("youtube.metadata"))throw new IllegalArgumentException("Opération cloud inconnue.");
    JSONObject video=video(broadcast,channel),snippet=video.getJSONObject("snippet");
    if(input.has("metadata")){
      JSONObject m=metadata(input.getJSONObject("metadata"));snippet.put("title",m.getString("title")).put("description",m.getString("description")).put("categoryId",m.getString("youtubeCategoryId")).put("tags",m.getJSONArray("tags"));
      yt("PUT","videos?part=snippet",new JSONObject().put("id",broadcast).put("snippet",snippet));snippet=video(broadcast,channel).getJSONObject("snippet");
      if(!m.getString("title").equals(snippet.optString("title"))||!m.getString("description").equals(snippet.optString("description"))||!m.getString("youtubeCategoryId").equals(snippet.optString("categoryId"))||!sameTags(m.getJSONArray("tags"),array(snippet,"tags")))throw new IllegalStateException("YouTube n’a pas confirmé toutes les informations.");
    }
    return new JSONObject().put("ok",true).put("channelId",channel).put("broadcastId",broadcast).put("title",snippet.optString("title")).put("description",snippet.optString("description")).put("youtubeCategoryId",snippet.optString("categoryId")).put("tags",array(snippet,"tags"));
  }
  private JSONObject video(String id,String channel)throws Exception{
    JSONArray items=array(yt("GET","videos?part=id,snippet&id="+enc(id),null),"items");for(int i=0;i<items.length();i++){JSONObject v=items.getJSONObject(i);if(id.equals(v.optString("id"))&&channel.equals(v.getJSONObject("snippet").optString("channelId")))return v;}throw new IllegalArgumentException("Vidéo absente de la chaîne connectée.");
  }
  private static boolean sameTags(JSONArray a,JSONArray b)throws Exception{Set<String> left=new HashSet<>(),right=new HashSet<>();for(int i=0;i<a.length();i++)left.add(a.getString(i));for(int i=0;i<b.length();i++)right.add(b.getString(i));return left.equals(right);}
}
