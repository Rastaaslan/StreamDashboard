package com.rastaaslan.streamdashboard.remote;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Indexed encrypted receipts do not rewrite the OAuth preference file on
 * every chat message. Historical receipts migrate without a replay window. */
final class OperationReceiptStore extends SQLiteOpenHelper {
  private final SecureCredentialStore credentials;
  OperationReceiptStore(Context context, SecureCredentialStore credentials) {
    super(context,"operation-receipts.db",null,1);this.credentials=credentials;
  }
  public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE receipts (id TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)"); }
  public void onUpgrade(SQLiteDatabase db,int from,int to) { throw new IllegalStateException("Migration de journal non prise en charge"); }
  synchronized String get(String id) throws Exception {
    try(Cursor rows=getReadableDatabase().rawQuery("SELECT value FROM receipts WHERE id=?",new String[]{id})) {
      if(rows.moveToFirst())return credentials.decode(rows.getString(0));
    }
    String previous=credentials.get(id);
    if(!previous.isEmpty()){put(id,previous);credentials.clear(id);}
    return previous;
  }
  synchronized void put(String id,String value) throws Exception {
    ContentValues row=new ContentValues();row.put("id",id);row.put("value",credentials.encode(value));
    if(getWritableDatabase().insertWithOnConflict("receipts",null,row,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new java.io.IOException("Sauvegarde du reçu impossible");
  }
  synchronized void clear(String id) { getWritableDatabase().delete("receipts","id=?",new String[]{id});credentials.clear(id); }
  void migrate() throws Exception { for(String id:credentials.receiptKeys()){get(id);credentials.clear(id);} }
}
