package com.rastaaslan.streamdashboard.remote;

import java.net.URI;

/** File selection grants one user-picked document, never a filesystem URL or
 * the application's private export provider. */
final class FileSelectionPolicy {
  static String mimeType(String[] accepted){
    if(accepted!=null)for(String types:accepted)if(types!=null)for(String type:types.split(","))if("application/json".equalsIgnoreCase(type.trim())||".json".equalsIgnoreCase(type.trim()))return "application/json";
    return "audio/*";
  }
  static boolean accepts(String value,String applicationId){
    if(value==null||value.length()>4096)return false;
    try{
      URI uri=new URI(value);
      return "content".equalsIgnoreCase(uri.getScheme())&&uri.getHost()!=null&&!uri.getHost().isEmpty()
        &&uri.getUserInfo()==null&&uri.getPort()==-1&&uri.getFragment()==null
        &&!uri.getHost().equalsIgnoreCase(applicationId+".fileprovider");
    }catch(Exception error){return false;}
  }
}
