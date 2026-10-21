package com.rastaaslan.streamdashboard.remote;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import java.util.*;

/** Platform pages never share the WebView that owns accounts, files or agent bridges. */
public final class ViewerActivity extends Activity {
  private final List<WebView> views=new ArrayList<>();
  private TextView status;
  private ViewerTargets targets;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    try{targets=new ViewerTargets(getIntent().getStringExtra("twitch"),getIntent().getStringExtra("youtube"),getIntent().getStringExtra("source"));}catch(Exception error){finish();return;}
    LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setBackgroundColor(Color.rgb(10,12,22));
    status=new TextView(this);status.setTextColor(Color.WHITE);status.setPadding(12,8,12,8);status.setText("Sessions web de cet Android, distinctes des comptes API. Connexion non vérifiable automatiquement ; ouvrez le navigateur si la plateforme limite le lecteur.");page.addView(status);
    LinearLayout tools=new LinearLayout(this);page.addView(tools);
    button(tools,"Retour",this::finish);button(tools,"Twitch ↗",()->external(targets.external("twitch")));button(tools,"YouTube ↗",()->external(targets.external("youtube")));
    LinearLayout login=new LinearLayout(this);page.addView(login);
    button(login,"Connexion Twitch",()->login("https://www.twitch.tv/login"));button(login,"Connexion YouTube",()->external("https://www.youtube.com/"));
    LinearLayout panels=new LinearLayout(this);panels.setOrientation(LinearLayout.VERTICAL);page.addView(panels,new LinearLayout.LayoutParams(-1,0,1));
    LinearLayout video=panel("Retour vidéo · "+targets.source,targets.video());panels.addView(video,new LinearLayout.LayoutParams(-1,0,1));
    LinearLayout chats=new LinearLayout(this);chats.setOrientation(getResources().getDisplayMetrics().widthPixels>getResources().getDisplayMetrics().heightPixels?LinearLayout.HORIZONTAL:LinearLayout.VERTICAL);panels.addView(chats,new LinearLayout.LayoutParams(-1,0,2));
    boolean horizontal=chats.getOrientation()==LinearLayout.HORIZONTAL;
    chats.addView(panel("Chat Twitch",targets.twitchChat()),new LinearLayout.LayoutParams(horizontal?0:-1,horizontal?-1:0,1));
    chats.addView(panel("Chat YouTube",targets.youtubeChat()),new LinearLayout.LayoutParams(horizontal?0:-1,horizontal?-1:0,1));
    button(login,"Afficher / masquer la vidéo",()->video.setVisibility(video.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE));
    setContentView(page);
  }
  private void button(LinearLayout holder,String title,Runnable action){Button button=new Button(this);button.setText(title);button.setTextSize(12);button.setOnClickListener(view->action.run());holder.addView(button,new LinearLayout.LayoutParams(0,-2,1));}
  private LinearLayout panel(String title,String url) {
    LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);TextView label=new TextView(this);label.setText(title);label.setTextColor(Color.WHITE);label.setPadding(12,4,8,4);panel.addView(label);
    if(url.isEmpty()){label.setText(title+" · choisissez une chaîne ou diffusion dans le tableau de bord.");return panel;}
    WebView view=createView();panel.addView(view,new LinearLayout.LayoutParams(-1,0,1));
    String html="<!doctype html><meta name='viewport' content='width=device-width,initial-scale=1'><meta name='referrer' content='strict-origin-when-cross-origin'><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#0a0c16}</style><iframe title='"+title+"' src='"+url.replace("&","&amp;")+"' allow='autoplay; encrypted-media; fullscreen; picture-in-picture' allowfullscreen></iframe>";
    view.loadDataWithBaseURL("https://appassets.androidplatform.net/viewer/",html,"text/html","UTF-8",null);return panel;
  }
  private WebView createView() {
    WebView view=new WebView(this);views.add(view);WebSettings settings=view.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);
    CookieManager.getInstance().setAcceptThirdPartyCookies(view,true);
    view.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView current,WebResourceRequest request){String url=request.getUrl().toString();if(ViewerTargets.embedded(url))return false;if(request.hasGesture())external(url);return true;}
      @Override public void onReceivedSslError(WebView current,SslErrorHandler handler,SslError error){handler.cancel();status.setText("Certificat de la plateforme refusé. Vérifiez l’heure de l’appareil ou ouvrez son navigateur externe.");}
      @Override public void onReceivedError(WebView current,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())status.setText("Lecteur temporairement indisponible. Les comptes API et les chats sur le tableau de bord restent indépendants.");}
      @Override public void onPageFinished(WebView current,String url){CookieManager.getInstance().flush();}
    });
    // No JavaScript interface or WebMessage listener is installed here.
    view.setWebChromeClient(new WebChromeClient());return view;
  }
  private void login(String url){WebView view=createView();android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(this).setTitle("Connexion web Twitch sur cet Android").setView(view).setPositiveButton("Revenir aux écrans",(d,w)->{for(WebView existing:views)if(existing!=view)existing.reload();}).setNegativeButton("Ouvrir le navigateur",(d,w)->external(url)).create();dialog.setOnDismissListener(d->{CookieManager.getInstance().flush();views.remove(view);view.destroy();});dialog.show();view.loadUrl(url);}
  private void external(String url){try{Uri uri=Uri.parse(url);if(!"https".equals(uri.getScheme())||!ExternalNavigationPolicy.accepts(url))return;startActivity(new Intent(Intent.ACTION_VIEW,uri));status.setText("Ouvert dans le navigateur. Sa connexion reste distincte de la session intégrée et du compte API.");}catch(Exception error){status.setText("Aucun navigateur disponible pour cette adresse.");}}
  @Override protected void onDestroy(){CookieManager.getInstance().flush();for(WebView view:new ArrayList<>(views)){view.stopLoading();view.destroy();}views.clear();super.onDestroy();}
}
